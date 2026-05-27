// =============================================================================
// Nzzor — Public Analytics Beacon Routes
// =============================================================================
// Two endpoints, both unauthenticated and accepting POST from any origin.
// They return 204 No Content immediately and process the beacon
// asynchronously via setImmediate (matching the email-service pattern).
//
// Mount in src/server.js:
//   const analyticsRoutes = require("./routes/analytics");
//   app.use("/api/analytics", analyticsRoutes);
//
// CORS already allows the web origin from server.js; no extra config needed.
// =============================================================================

const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { v4: uuid } = require("uuid");
const { ingestPageview, ingestEvent } = require("../services/analyticsService");

// Rate limit. Generous because real users sometimes navigate fast (a 5-page
// browsing session in 30 seconds is normal); we mostly want to block scripts
// abusing the endpoint. 200/min per IP catches abuse without burning legit
// users.
const beaconLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  // Don't 429 the user — just drop. Analytics being lossy under attack is
  // acceptable; user-facing surfaces would never call this endpoint anyway.
  skip: (req) => req.method === "OPTIONS",
});

// Visitor cookie management. The cookie is 1st-party, 2-year lifetime,
// SameSite=Lax (so it travels on top-level nav), not HttpOnly (so the
// client beacon can still read it if it ever needs to). On the very first
// beacon for a visitor (no cookie present and no visitorId in body), we
// mint one server-side and set it on the response.
const VISITOR_COOKIE = "nzr_vid";
const VISITOR_COOKIE_MAXAGE = 60 * 60 * 24 * 365 * 2;  // 2 years in seconds

function readOrMintVisitorId(req, res) {
  // Try body first (the client can read its own cookie and pass it through),
  // then cookie header. If neither, mint a new one and set the cookie.
  const fromBody = req.body && typeof req.body.visitorId === "string" && req.body.visitorId.length > 8
    ? req.body.visitorId
    : null;

  const fromCookie = parseCookie(req.headers.cookie, VISITOR_COOKIE);

  const id = fromBody || fromCookie || uuid();

  // Always re-set the cookie on the response. This refreshes the expiry
  // each visit (a common pattern; some sites prefer a fixed expiry — we
  // use rolling because for analytics longevity of visitor recognition
  // matters more than a fixed timeline).
  if (!fromCookie || fromCookie !== id) {
    res.setHeader(
      "Set-Cookie",
      `${VISITOR_COOKIE}=${id}; Max-Age=${VISITOR_COOKIE_MAXAGE}; Path=/; SameSite=Lax`
    );
  }
  return id;
}

function parseCookie(header, name) {
  if (!header) return null;
  const m = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? m[1] : null;
}

// Headers we want to capture, normalized. Cloudflare adds CF-IPCountry when
// the API is behind it; if absent (direct access), country falls back to null.
function captureHeaders(req) {
  return {
    ua: req.headers["user-agent"] || null,
    accept: req.headers["accept"] || null,
    acceptLang: req.headers["accept-language"] || null,
    ip: req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
    country: req.headers["cf-ipcountry"] || null,
  };
}

// -----------------------------------------------------------------------------
// POST /api/analytics/beacon
// -----------------------------------------------------------------------------
// Body: { path, fullUrl?, referrer?, lang?, webdriver?, userId?, visitorId? }
// Response: 204 No Content (always, even if the payload was invalid — we
// don't want to give a bot meaningful feedback).
// -----------------------------------------------------------------------------

const pageviewSchema = z.object({
  path: z.string().min(1).max(500),
  fullUrl: z.string().max(2000).nullish(),
  referrer: z.string().max(2000).nullish(),
  lang: z.string().max(10).nullish(),
  webdriver: z.boolean().nullish(),
  userId: z.string().uuid().nullish(),
  visitorId: z.string().min(8).max(64).nullish(),
});

router.post("/beacon", beaconLimiter, (req, res) => {
  // Set the cookie + decide the visitor id synchronously (before we end
  // the response), then schedule the DB write.
  const visitorId = readOrMintVisitorId(req, res);
  const parsed = pageviewSchema.safeParse(req.body || {});

  // Respond immediately regardless of parse outcome.
  res.status(204).end();

  if (!parsed.success) return;

  const headers = captureHeaders(req);
  setImmediate(() => {
    ingestPageview({ ...parsed.data, visitorId }, headers);
  });
});

// -----------------------------------------------------------------------------
// POST /api/analytics/event
// -----------------------------------------------------------------------------
// Body: { type, path, meta?, userId?, visitorId? }
// type must be one of the AnalyticsEventType enum values.
// -----------------------------------------------------------------------------

const eventSchema = z.object({
  type: z.enum([
    "WHATSAPP_CLICK",
    "BOOKING_CTA_CLICK",
    "HOTEL_VIEW",
    "SIGNUP",
    "LOGIN",
    "BOOKING_STARTED",
    "BOOKING_COMPLETED",
    "SEARCH",
  ]),
  path: z.string().min(1).max(500),
  meta: z.record(z.any()).nullish(),
  userId: z.string().uuid().nullish(),
  visitorId: z.string().min(8).max(64).nullish(),
});

router.post("/event", beaconLimiter, (req, res) => {
  const visitorId = readOrMintVisitorId(req, res);
  const parsed = eventSchema.safeParse(req.body || {});

  res.status(204).end();

  if (!parsed.success) return;

  const headers = captureHeaders(req);
  setImmediate(() => {
    ingestEvent({ ...parsed.data, visitorId }, headers);
  });
});

module.exports = router;
