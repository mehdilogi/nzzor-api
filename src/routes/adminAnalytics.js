// =============================================================================
// Nzzor — Admin Analytics Routes
// =============================================================================
// Auth-gated endpoints that power the Analytics admin tab. All endpoints
// accept ?start=YYYY-MM-DD&end=YYYY-MM-DD (default: last 7 days).
//
// For ranges ≤ 7 days, queries hit the raw Pageview/Session tables (gives
// up-to-the-minute freshness).
// For ranges > 7 days, queries hit DailyStats (much faster, lower load on
// the hot tables).
//
// Mount in src/server.js:
//   app.use("/api/admin/analytics", require("./routes/adminAnalytics"));
//
// Auth is enforced inside this router (matches the convention of
// src/routes/admin.js), so no extra middleware is needed at the mount point.
// =============================================================================

const router = require("express").Router();
const prisma = require("../utils/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { referrerHost } = require("../services/referrerService");

router.use(requireAuth, requireAdmin);

// -----------------------------------------------------------------------------
// Date-range parsing — always returns inclusive UTC bounds.
// -----------------------------------------------------------------------------

function parseRange(req) {
  const today = new Date();
  const defaultStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const start = req.query.start ? new Date(`${req.query.start}T00:00:00.000Z`) : defaultStart;
  const end = req.query.end ? new Date(`${req.query.end}T23:59:59.999Z`) : today;

  // Clamp end to now; never query future.
  const clampedEnd = end > today ? today : end;
  return { start, end: clampedEnd };
}

function dayCount(start, end) {
  return Math.ceil((end - start) / (24 * 60 * 60 * 1000));
}

// -----------------------------------------------------------------------------
// GET /api/admin/analytics/overview
// -----------------------------------------------------------------------------
// Top-of-dashboard cards: sessions, unique visitors, pageviews, bookings,
// conversion rate. Also returns "previous period" counts for delta arrows.
// -----------------------------------------------------------------------------
router.get("/overview", async (req, res, next) => {
  try {
    const { start, end } = parseRange(req);
    const days = dayCount(start, end);
    const prevStart = new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
    const prevEnd = new Date(start.getTime() - 1);

    const [curr, prev] = await Promise.all([
      computeOverview(start, end),
      computeOverview(prevStart, prevEnd),
    ]);

    res.json({
      data: {
        range: { start, end, days },
        current: curr,
        previous: prev,
      },
    });
  } catch (err) { next(err); }
});

async function computeOverview(start, end) {
  // Filter out bot traffic from all human-facing numbers
  const where = { createdAt: { gte: start, lte: end }, isBot: false };
  const sessionWhere = { startedAt: { gte: start, lte: end }, isBot: false };

  const [pageviews, sessions, uniqueVisitorsRaw, bookings] = await Promise.all([
    prisma.pageview.count({ where }),
    prisma.session.count({ where: sessionWhere }),
    prisma.pageview.findMany({
      where,
      select: { visitorId: true },
      distinct: ["visitorId"],
    }),
    prisma.booking.count({ where: { createdAt: { gte: start, lte: end } } }),
  ]);

  const uniqueVisitors = uniqueVisitorsRaw.length;
  const avgPagesPerSession = sessions > 0 ? pageviews / sessions : 0;
  const conversionRate = sessions > 0 ? (bookings / sessions) * 100 : 0;

  return {
    pageviews,
    sessions,
    uniqueVisitors,
    bookings,
    avgPagesPerSession: Number(avgPagesPerSession.toFixed(2)),
    conversionRate: Number(conversionRate.toFixed(2)),
  };
}

// -----------------------------------------------------------------------------
// GET /api/admin/analytics/timeseries
// -----------------------------------------------------------------------------
// Daily buckets for the sessions-over-time chart. Returns one point per day
// in the range, with zero-filled gaps.
// -----------------------------------------------------------------------------
router.get("/timeseries", async (req, res, next) => {
  try {
    const { start, end } = parseRange(req);
    const days = dayCount(start, end);

    // For short ranges (≤14 days), aggregate live from the raw table.
    // For longer, read DailyStats.
    let points;
    if (days <= 14) {
      points = await timeseriesFromRaw(start, end);
    } else {
      points = await timeseriesFromDailyStats(start, end);
    }

    // Zero-fill missing dates so the chart x-axis is continuous.
    const byDate = new Map(points.map((p) => [p.date, p]));
    const filled = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      filled.push(byDate.get(key) || { date: key, pageviews: 0, sessions: 0, uniqueVisitors: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    res.json({ data: filled });
  } catch (err) { next(err); }
});

async function timeseriesFromRaw(start, end) {
  // Postgres-specific: group by date_trunc('day', createdAt). Prisma doesn't
  // have a date_trunc helper, so use raw SQL. Safe: no user input is
  // interpolated directly.
  const rows = await prisma.$queryRaw`
    SELECT
      to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
      count(*)::int AS pageviews,
      count(distinct "sessionId")::int AS sessions,
      count(distinct "visitorId")::int AS "uniqueVisitors"
    FROM analytics_pageviews
    WHERE "createdAt" >= ${start} AND "createdAt" <= ${end} AND "isBot" = false
    GROUP BY 1
    ORDER BY 1
  `;
  return rows;
}

async function timeseriesFromDailyStats(start, end) {
  const rows = await prisma.dailyStats.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    pageviews: r.pageviews,
    sessions: r.sessions,
    uniqueVisitors: r.uniqueVisitors,
  }));
}

// -----------------------------------------------------------------------------
// GET /api/admin/analytics/sources
// -----------------------------------------------------------------------------
// Traffic source breakdown: { src, sessions, percentage }
// -----------------------------------------------------------------------------
router.get("/sources", async (req, res, next) => {
  try {
    const { start, end } = parseRange(req);

    const rows = await prisma.session.groupBy({
      by: ["referrerSrc"],
      where: { startedAt: { gte: start, lte: end }, isBot: false },
      _count: { _all: true },
      orderBy: { _count: { referrerSrc: "desc" } },
    });

    const total = rows.reduce((a, r) => a + r._count._all, 0);
    const data = rows.map((r) => ({
      src: r.referrerSrc || "direct",
      sessions: r._count._all,
      percentage: total > 0 ? Number(((r._count._all / total) * 100).toFixed(1)) : 0,
    }));

    res.json({ data, total });
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// GET /api/admin/analytics/geo
// -----------------------------------------------------------------------------
// Sessions by country. Country comes from CF-IPCountry (ISO 3166-1 alpha-2).
// -----------------------------------------------------------------------------
router.get("/geo", async (req, res, next) => {
  try {
    const { start, end } = parseRange(req);

    const rows = await prisma.session.groupBy({
      by: ["country"],
      where: { startedAt: { gte: start, lte: end }, isBot: false },
      _count: { _all: true },
      orderBy: { _count: { country: "desc" } },
      take: 50,
    });

    const total = rows.reduce((a, r) => a + r._count._all, 0);
    const data = rows.map((r) => ({
      country: r.country || "unknown",
      sessions: r._count._all,
      percentage: total > 0 ? Number(((r._count._all / total) * 100).toFixed(1)) : 0,
    }));

    res.json({ data, total });
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// GET /api/admin/analytics/pages
// -----------------------------------------------------------------------------
// Top pages by pageview count.
// -----------------------------------------------------------------------------
router.get("/pages", async (req, res, next) => {
  try {
    const { start, end } = parseRange(req);

    const rows = await prisma.pageview.groupBy({
      by: ["path"],
      where: { createdAt: { gte: start, lte: end }, isBot: false },
      _count: { _all: true },
      orderBy: { _count: { path: "desc" } },
      take: 25,
    });

    res.json({
      data: rows.map((r) => ({
        path: r.path,
        pageviews: r._count._all,
      })),
    });
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// GET /api/admin/analytics/events
// -----------------------------------------------------------------------------
// Custom event counts grouped by type. Optional ?type= filter to see one
// event's full meta history (last 100 rows).
// -----------------------------------------------------------------------------
router.get("/events", async (req, res, next) => {
  try {
    const { start, end } = parseRange(req);
    const type = req.query.type;

    if (type) {
      // Detail view — last 100 events of one type with meta
      const rows = await prisma.analyticsEvent.findMany({
        where: { type, createdAt: { gte: start, lte: end } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, type: true, path: true, meta: true, country: true, createdAt: true },
      });
      return res.json({ data: rows, mode: "detail", type });
    }

    // Summary view — counts per type
    const rows = await prisma.analyticsEvent.groupBy({
      by: ["type"],
      where: { createdAt: { gte: start, lte: end } },
      _count: { _all: true },
      orderBy: { _count: { type: "desc" } },
    });

    res.json({
      data: rows.map((r) => ({ type: r.type, count: r._count._all })),
      mode: "summary",
    });
  } catch (err) { next(err); }
});

module.exports = router;
