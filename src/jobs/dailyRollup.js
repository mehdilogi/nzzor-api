// =============================================================================
// Nzzor — Daily Analytics Rollup
// =============================================================================
// Runs once per day (03:00 Algiers time) and:
//   1. Computes the DailyStats row for "yesterday" — pageviews, sessions,
//      unique visitors, top paths/countries/sources/devices.
//   2. Backfills missing DailyStats rows for any prior day that's missing
//      (catches missed cron runs).
//   3. Prunes Pageview and Session rows older than 90 days, since the
//      aggregates have been stored.
//
// We schedule with node-cron. Railway doesn't have native cron for the
// hobby plan; node-cron in the API process is fine because the rollup is
// idempotent — if it runs twice on the same day, the upsert produces the
// same result, and if it doesn't run on day N, the next day's run will
// catch up. Worst case: a multi-day API outage leaves a gap that gets
// filled when the API comes back up.
//
// To wire this up, in src/server.js after app.listen:
//   if (process.env.NODE_ENV === "production") require("./jobs/dailyRollup").start();
//
// In dev, you can trigger a manual rollup via:
//   node -e "require('./src/jobs/dailyRollup').runOnce()"
// =============================================================================

const cron = require("node-cron");
const prisma = require("../utils/prisma");
const { pruneOldRows } = require("../services/analyticsService");

// 03:00 Algiers time = 02:00 UTC (Algeria is UTC+1, no DST)
const CRON_EXPR = "0 2 * * *";

/**
 * Compute aggregates for a single UTC day and upsert the DailyStats row.
 * `day` should be a Date at 00:00:00 UTC of the target day.
 */
async function rollupDay(day) {
  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setUTCHours(23, 59, 59, 999);

  const where = { createdAt: { gte: start, lte: end }, isBot: false };
  const sessionWhere = { startedAt: { gte: start, lte: end }, isBot: false };

  const [
    pageviews,
    sessions,
    uniqueVisitorsRaw,
    uniqueUsersRaw,
    bookingsCreated,
    bookingsConfirmed,
    topPaths,
    topCountries,
    topReferrerSrcs,
    topDevices,
  ] = await Promise.all([
    prisma.pageview.count({ where }),
    prisma.session.count({ where: sessionWhere }),
    prisma.pageview.findMany({ where, select: { visitorId: true }, distinct: ["visitorId"] }),
    prisma.pageview.findMany({
      where: { ...where, userId: { not: null } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.booking.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.booking.count({ where: { createdAt: { gte: start, lte: end }, status: "CONFIRMED" } }),
    prisma.pageview.groupBy({
      by: ["path"],
      where,
      _count: { _all: true },
      orderBy: { _count: { path: "desc" } },
      take: 10,
    }),
    prisma.session.groupBy({
      by: ["country"],
      where: sessionWhere,
      _count: { _all: true },
      orderBy: { _count: { country: "desc" } },
      take: 10,
    }),
    prisma.session.groupBy({
      by: ["referrerSrc"],
      where: sessionWhere,
      _count: { _all: true },
      orderBy: { _count: { referrerSrc: "desc" } },
      take: 10,
    }),
    prisma.session.groupBy({
      by: ["deviceType"],
      where: sessionWhere,
      _count: { _all: true },
      orderBy: { _count: { deviceType: "desc" } },
    }),
  ]);

  const uniqueVisitors = uniqueVisitorsRaw.length;
  const uniqueUsers = uniqueUsersRaw.length;
  const avgPageviewsPerSession = sessions > 0 ? pageviews / sessions : 0;

  await prisma.dailyStats.upsert({
    where: { date: start },
    create: {
      date: start,
      pageviews,
      sessions,
      uniqueVisitors,
      uniqueUsers,
      bookingsCreated,
      bookingsConfirmed,
      avgPageviewsPerSession,
      topPaths: topPaths.map((r) => ({ path: r.path, count: r._count._all })),
      topCountries: topCountries.map((r) => ({ country: r.country || "unknown", count: r._count._all })),
      topReferrerSrcs: topReferrerSrcs.map((r) => ({ src: r.referrerSrc || "direct", count: r._count._all })),
      topDevices: topDevices.map((r) => ({ device: r.deviceType || "unknown", count: r._count._all })),
    },
    update: {
      pageviews,
      sessions,
      uniqueVisitors,
      uniqueUsers,
      bookingsCreated,
      bookingsConfirmed,
      avgPageviewsPerSession,
      topPaths: topPaths.map((r) => ({ path: r.path, count: r._count._all })),
      topCountries: topCountries.map((r) => ({ country: r.country || "unknown", count: r._count._all })),
      topReferrerSrcs: topReferrerSrcs.map((r) => ({ src: r.referrerSrc || "direct", count: r._count._all })),
      topDevices: topDevices.map((r) => ({ device: r.deviceType || "unknown", count: r._count._all })),
    },
  });

  return { date: start.toISOString().slice(0, 10), pageviews, sessions, uniqueVisitors };
}

/**
 * Full nightly run: backfill any missing days from the last 7, then prune.
 * Idempotent.
 */
async function runOnce() {
  const startedAt = Date.now();
  console.log("[analytics] rollup starting...");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Look at the past 7 days, find which ones don't have a DailyStats row,
  // and roll those up. Today (still in progress) is excluded.
  const results = [];
  for (let i = 1; i <= 7; i++) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - i);
    const existing = await prisma.dailyStats.findUnique({ where: { date: day } });
    // Always recompute yesterday (i=1) to capture late-arriving data;
    // older days only recompute if missing.
    if (i === 1 || !existing) {
      try {
        const r = await rollupDay(day);
        results.push(r);
      } catch (err) {
        console.error(`[analytics] rollup error for ${day.toISOString().slice(0, 10)}:`, err.message);
      }
    }
  }

  let pruneResult = null;
  try {
    pruneResult = await pruneOldRows();
  } catch (err) {
    console.error("[analytics] prune error:", err.message);
  }

  const ms = Date.now() - startedAt;
  console.log(`[analytics] rollup done in ${ms}ms`, { rolled: results.length, pruned: pruneResult });
  return { results, pruned: pruneResult };
}

let scheduled = null;
function start() {
  if (scheduled) return;
  scheduled = cron.schedule(CRON_EXPR, () => {
    runOnce().catch((err) => console.error("[analytics] rollup top-level error:", err));
  }, { timezone: "UTC" });
  console.log("[analytics] daily rollup scheduled (02:00 UTC / 03:00 Algiers)");
}

module.exports = { start, runOnce, rollupDay };
