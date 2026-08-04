// =============================================================================
// Nzzor API Server
// Operated by Allouni Travel Agency
// =============================================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const hotelRoutes = require("./routes/hotels");
const bookingRoutes = require("./routes/bookings");
const availabilityRoutes = require("./routes/availability");
const quoteRoutes = require("./routes/quote");
const voucherRoutes = require("./routes/vouchers");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const adminHotelRoutes = require("./routes/adminHotels");
const partnerRoutes = require("./routes/partner");
const accountRoutes = require("./routes/account");
const analyticsRoutes = require("./routes/analytics");
const adminAnalyticsRoutes = require("./routes/adminAnalytics");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 3001;

// =============================================================================
// TRUST PROXY — required now that api.nzzor.com is proxied through Cloudflare
// =============================================================================
// Request path in production:
//   browser -> Cloudflare edge (orange cloud) -> Railway router -> this process
//
// Without this, req.ip is the *socket* address, i.e. a Cloudflare edge IP.
// Consequences that were live before this change:
//   1. The rate limiter keyed every visitor to a handful of Cloudflare edge
//      IPs, so the 200-req/15min budget was shared across ALL users on that
//      edge node rather than being per-user. A few concurrent browsers
//      exhausted it and everyone else got 429.
//   2. Analytics IP hashes all collapsed to one value (every "unique visitor"
//      looked like the same machine).
//   3. bookings.js persisted the Cloudflare IP into Booking.ipAddress.
//
// We enable trust proxy so Express parses X-Forwarded-For, and additionally
// prefer Cloudflare's CF-Connecting-IP, which Cloudflare OVERWRITES on every
// request (a client cannot forge it through the CF edge).
app.set("trust proxy", true);

// NOTE ON SPOOFING: Cloudflare's published edge IP ranges are not verified
// here. A caller who reaches Railway directly (663ftvea.up.railway.app,
// bypassing Cloudflare) could forge CF-Connecting-IP and dodge rate limiting.
// Impact is limited to rate-limit evasion and skewed analytics — no auth or
// data path trusts this value. To close it later: enable Cloudflare
// Authenticated Origin Pulls, or set a secret header at Cloudflare and reject
// origin requests that lack it.
function resolveClientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();

  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    // Leftmost entry is the originating client.
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || "unknown";
}

// Expose the real client IP as req.clientIp, and shadow Express's req.ip
// getter on the request instance so existing code keeps working untouched:
// bookings.js (ipAddress: req.ip), the analytics IP-hashing middleware, and
// both rate limiters pick this up with no edits to those files.
app.use((req, res, next) => {
  const ip = resolveClientIp(req);
  req.clientIp = ip;
  try {
    Object.defineProperty(req, "ip", {
      value: ip,
      configurable: true,
      enumerable: true,
    });
  } catch (_) {
    // If the property can't be redefined on this Express version, req.clientIp
    // is still correct and nothing else breaks.
  }
  next();
});

app.use(helmet());

// CORS_ORIGINS is a comma-separated list set in Railway. Trim each entry and
// drop trailing slashes: a stray space ("https://nzzor.com, https://www...")
// or a trailing "/" makes the comparison against the browser's Origin header
// fail, which surfaces in the UI as a generic "couldn't complete" error with
// no useful detail.
const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Strip invisible Unicode characters (LRM, RLM, ZWSP, BOM, etc.) from all
// incoming JSON strings. Prevents the "two visually-identical Arabic city
// names that Postgres treats as different rows" bug that bit us with Setif.
// See src/middleware/cleanText.js for the full list of stripped code points.
const { cleanTextMiddleware } = require("./middleware/cleanText");
app.use(cleanTextMiddleware);

// -----------------------------------------------------------------------------
// Rate limiting
// -----------------------------------------------------------------------------
// Ceilings are raised because Algerian mobile carriers (Djezzy, Ooredoo,
// Mobilis) put large numbers of subscribers behind CGNAT — many real users
// legitimately share one public IPv4. The old per-IP limits assumed one IP per
// user and would throttle genuine traffic even with correct IP detection.
//
// Every 429 now returns an identifiable JSON body and logs a line. If the
// checkout error banner shows this again, the response says exactly which
// limiter fired instead of leaving you to guess.
function limitHandler(name) {
  return (req, res) => {
    const resetTime = req.rateLimit && req.rateLimit.resetTime;
    const retryAfterSec = resetTime
      ? Math.ceil((resetTime.getTime() - Date.now()) / 1000)
      : 900;
    console.warn(
      `[ratelimit] ${name} tripped ip=${req.clientIp} path=${req.originalUrl} ` +
      `cf-ray=${req.headers["cf-ray"] || "-"} country=${req.headers["cf-ipcountry"] || "-"}`
    );
    res.status(429).json({
      error: "Too many requests, please try again in a few minutes",
      code: "RATE_LIMITED",
      limiter: name,
      retryAfterSeconds: Math.max(1, retryAfterSec),
    });
  };
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler("global"),
  // The analytics beacon is hit on every page view (potentially many times
  // per minute per user during normal browsing). It has its own dedicated
  // rate limit inside routes/analytics.js (200/min per IP, much more
  // permissive than the global limit). Excluding it here prevents the
  // beacon from cannibalising the user's regular API budget.
  // /api/health is excluded so uptime checks can never be throttled.
  skip: (req) =>
    req.path.startsWith("/api/analytics") || req.path === "/api/health",
});
app.use("/api/", limiter);

// Auth was 20 per 15 minutes. Keyed to a shared Cloudflare edge IP, that
// ceiling was reachable within seconds of ordinary traffic.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler("auth"),
});
app.use("/api/auth/", authLimiter);

app.use("/api/hotels", hotelRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/bookings", voucherRoutes); // voucher PDF download (GET /:reference/voucher.pdf)
app.use("/api/availability", availabilityRoutes);
app.use("/api/quote", quoteRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminHotelRoutes);
app.use("/api/partner", partnerRoutes);
app.use("/api/account", accountRoutes);
// Analytics — public beacon (no auth) + admin dashboard endpoints (auth is
// enforced inside the admin analytics router via router.use(requireAuth,
// requireAdmin), matching the existing /api/admin convention).
app.use("/api/analytics", analyticsRoutes);
app.use("/api/admin/analytics", adminAnalyticsRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Nzzor API",
    operator: "Allouni Travel Agency",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    // Proxy diagnostics. Open https://api.nzzor.com/api/health from the
    // Algerian phone that hit the error: client.ip must be that phone's
    // carrier IP, NOT a Cloudflare address (104.x / 172.67.x). If it still
    // shows a Cloudflare IP, trust proxy is not taking effect.
    client: {
      ip: req.clientIp,
      viaCloudflare: Boolean(req.headers["cf-ray"]),
      country: req.headers["cf-ipcountry"] || null,
      cfRay: req.headers["cf-ray"] || null,
      forwardedFor: req.headers["x-forwarded-for"] || null,
    },
    corsOrigins,
  });
});

app.get("/api", (req, res) => {
  res.json({
    name: "Nzzor API",
    operator: "Allouni Travel Agency",
    description: "Algeria's Travel Infrastructure API",
    version: "1.0.0",
    endpoints: {
      health: "GET /api/health",
      hotels: {
        list: "GET /api/hotels",
        detail: "GET /api/hotels/:slug",
        cities: "GET /api/hotels/meta/cities",
      },
      bookings: {
        create: "POST /api/bookings",
        get: "GET /api/bookings/:reference",
        cancel: "PATCH /api/bookings/:reference/cancel",
        voucher: "GET /api/bookings/:reference/voucher.pdf",
      },
      availability: {
        check: "POST /api/availability/check",
        dates: "GET /api/availability/dates",
      },
      auth: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        me: "GET /api/auth/me",
      },
      admin: {
        dashboard: "GET /api/admin/dashboard",
        bookings: "GET /api/admin/bookings",
        analytics: "GET /api/admin/analytics/overview",
      },
      analytics: {
        beacon: "POST /api/analytics/beacon",
        event: "POST /api/analytics/event",
      },
    },
  });
});

app.use("*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`
  🇩🇿 ===========================================
     Nzzor API
     by Allouni Travel Agency
     Running on http://localhost:${PORT}
     API docs: http://localhost:${PORT}/api
     trust proxy: NZZOR_TRUST_PROXY_ACTIVE (Cloudflare -> Railway)
     CORS origins: ${corsOrigins.join(" | ")}
  ===========================================
  `);

  // Schedule the nightly analytics rollup. Runs at 02:00 UTC (03:00
  // Algiers). Aggregates yesterday's pageviews into DailyStats, backfills
  // any missing days from the last 7, and prunes raw rows older than 90
  // days. The job is idempotent — multiple runs in the same day produce
  // identical results, so it's safe even if the server restarts during
  // execution. Disabled in development to avoid surprising local devs;
  // manually triggerable via:
  //   node -e "require('./src/jobs/dailyRollup').runOnce()"
  if (process.env.NODE_ENV === "production") {
    require("./jobs/dailyRollup").start();

    // Sweep abandoned PENDING bookings every 5 minutes. Without this,
    // ghosted carts hold inventory forever — real customers would see
    // "sold out" on rooms that nobody actually paid for. Matches the
    // 30-minute hold window defined in availabilityService. Manually
    // triggerable via:
    //   node -e "require('./src/jobs/expirePendingBookings').expirePendingBookings()"
    const cron = require("node-cron");
    const { expirePendingBookings } = require("./jobs/expirePendingBookings");
    cron.schedule("*/5 * * * *", async () => {
      try {
        await expirePendingBookings();
      } catch (err) {
        console.error("[expirePending] cron run failed:", err.message);
      }
    });
    console.log("[cron] scheduled expirePendingBookings every 5 minutes");
  }
});
