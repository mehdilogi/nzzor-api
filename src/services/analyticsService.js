// =============================================================================
// Nzzor — Analytics Service
// =============================================================================
// All the writes for the analytics layer flow through here. Routes call into
// these functions; everything else (rate-limited middleware, fire-and-forget
// scheduling, the rollup cron) lives in /routes and /jobs respectively.
//
// The session bucketing rule is the trickiest part: a "session" groups
// pageviews from the same visitorId where each consecutive pair is ≤30
// minutes apart. On every incoming pageview we check whether the visitor
// has an open session (last pageview within 30 min) and either extend it or
// open a new one. This is cheap because we have an index on
// (visitorId, createdAt).
// =============================================================================

const crypto = require("crypto");
const prisma = require("../utils/prisma");
const { isBot, deviceFromUA } = require("./botService");
const { classifyReferrer, referrerHost } = require("./referrerService");

const SESSION_GAP_MS = 30 * 60 * 1000;            // 30 minutes
const PAGEVIEW_RETENTION_DAYS = 90;
const SESSION_RETENTION_DAYS = 90;

// IP_HASH_SALT is rotated periodically (manual via env update). Rotation
// breaks long-term unique-visitor counts across the rotation boundary but
// hardens the dataset against being used to identify a real person from
// just the hashed IP. For now we don't rotate; document this so a future
// version of us doesn't forget.
const IP_HASH_SALT = process.env.ANALYTICS_IP_HASH_SALT || "nzzor-default-salt-set-me-in-env";

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash("sha256").update(`${IP_HASH_SALT}:${ip}`).digest("hex").slice(0, 32);
}

/**
 * Process a beacon and write the pageview + session updates.
 * Designed to be fire-and-forget: never throws to the caller; logs and
 * continues on errors so a single bad pageview doesn't break the API.
 *
 * @param {object} payload
 * @param {string} payload.visitorId   Cookie UUID
 * @param {string|null} payload.userId If logged in
 * @param {string} payload.path        e.g. "/hotels/royal-maqam"
 * @param {string|null} payload.fullUrl Full URL with querystring
 * @param {string|null} payload.referrer document.referrer
 * @param {string|null} payload.lang   Browser language code
 * @param {boolean} payload.webdriver  navigator.webdriver
 * @param {object} headers             { ua, accept, acceptLang, ip, country }
 *                                     Filled by the route from req.headers.
 */
async function ingestPageview(payload, headers) {
  try {
    const {
      visitorId,
      userId = null,
      path,
      fullUrl = null,
      referrer = null,
      lang = null,
      webdriver = false,
    } = payload || {};

    const { ua = null, accept = null, acceptLang = null, ip = null, country = null } = headers || {};

    if (!visitorId || !path) return;  // Drop malformed beacons silently

    const bot = isBot({ ua, accept, acceptLang, webdriver });
    const deviceType = deviceFromUA(ua);
    const referrerSrc = classifyReferrer(referrer);
    const ipHash = hashIp(ip);

    // 1. Find or open a session for this visitor.
    const now = new Date();
    const cutoff = new Date(now.getTime() - SESSION_GAP_MS);

    // The "open" session is the visitor's most recent session whose endedAt
    // is within the 30-minute window. If found, we extend it; if not, we
    // open a new one.
    let session = await prisma.session.findFirst({
      where: {
        visitorId,
        endedAt: { gte: cutoff },
      },
      orderBy: { endedAt: "desc" },
    });

    if (session) {
      // Extend existing session
      session = await prisma.session.update({
        where: { id: session.id },
        data: {
          endedAt: now,
          exitPath: path,
          pageviewCount: { increment: 1 },
          // userId may have been null when session opened and now we know it
          ...(userId && !session.userId ? { userId } : {}),
        },
      });
    } else {
      // Open a new session
      session = await prisma.session.create({
        data: {
          visitorId,
          userId,
          startedAt: now,
          endedAt: now,
          pageviewCount: 1,
          entryPath: path,
          exitPath: path,
          country,
          referrerSrc,
          deviceType,
          isBot: bot,
        },
      });
    }

    // 2. Write the pageview row.
    await prisma.pageview.create({
      data: {
        visitorId,
        userId,
        path: path.slice(0, 500),                  // Defensive truncation
        fullUrl: fullUrl ? fullUrl.slice(0, 2000) : null,
        referrer: referrer ? referrer.slice(0, 2000) : null,
        referrerSrc,
        ua: ua ? ua.slice(0, 500) : null,
        deviceType,
        country,
        ipHash,
        lang,
        sessionId: session.id,
        isBot: bot,
      },
    });
  } catch (err) {
    // Never throw — analytics failures must not affect user-facing traffic.
    console.error("[analytics] ingestPageview error:", err.message);
  }
}

/**
 * Record a custom event (whatsapp_click, booking_cta_click, etc.).
 * Same fire-and-forget contract as ingestPageview.
 */
async function ingestEvent(payload, headers) {
  try {
    const {
      visitorId,
      userId = null,
      type,
      path,
      meta = null,
    } = payload || {};

    if (!visitorId || !type || !path) return;

    const { country = null } = headers || {};

    // Attach to the visitor's current open session if any
    const cutoff = new Date(Date.now() - SESSION_GAP_MS);
    const session = await prisma.session.findFirst({
      where: { visitorId, endedAt: { gte: cutoff } },
      orderBy: { endedAt: "desc" },
      select: { id: true },
    });

    await prisma.analyticsEvent.create({
      data: {
        visitorId,
        userId,
        sessionId: session ? session.id : null,
        type,                                       // Must match AnalyticsEventType enum
        path: path.slice(0, 500),
        meta: meta || undefined,
        country,
      },
    });
  } catch (err) {
    console.error("[analytics] ingestEvent error:", err.message);
  }
}

/**
 * Delete raw pageview rows and sessions older than the retention window.
 * Called by the daily rollup job after the day's aggregates have been
 * computed. DailyStats rows are kept forever.
 */
async function pruneOldRows() {
  const cutoff = new Date(Date.now() - PAGEVIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [pv, sess] = await Promise.all([
    prisma.pageview.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.session.deleteMany({ where: { endedAt: { lt: cutoff } } }),
  ]);
  return { pageviewsDeleted: pv.count, sessionsDeleted: sess.count };
}

module.exports = {
  ingestPageview,
  ingestEvent,
  pruneOldRows,
  hashIp,                       // Exported for tests / debug; not used by routes
  SESSION_GAP_MS,
};
