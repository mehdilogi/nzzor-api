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
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const adminHotelRoutes = require("./routes/adminHotels");
const partnerRoutes = require("./routes/partner");
const accountRoutes = require("./routes/account");
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
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminHotelRoutes);
app.use("/api/partner", partnerRoutes);
app.use("/api/account", accountRoutes);

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
      },
      auth: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        me: "GET /api/auth/me",
      },
      admin: {
        dashboard: "GET /api/admin/dashboard",
        bookings: "GET /api/admin/bookings",
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
});
