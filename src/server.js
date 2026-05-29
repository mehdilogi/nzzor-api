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

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"],
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests, please try again later" },
  // The analytics beacon is hit on every page view (potentially many times
  // per minute per user during normal browsing). It has its own dedicated
  // rate limit inside routes/analytics.js (200/min per IP, much more
  // permissive than the global 200/15min). Excluding it here prevents the
  // beacon from cannibalising the user's regular API budget.
  skip: (req) => req.path.startsWith("/api/analytics"),
});
app.use("/api/", limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many auth attempts, please try again later" },
});
app.use("/api/auth/", authLimiter);

app.use("/api/hotels", hotelRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/bookings", voucherRoutes); // voucher PDF download (GET /:reference/voucher.pdf)
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
  }
});
