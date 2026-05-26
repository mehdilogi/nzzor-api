// =============================================================================
// Nzzor API — Account Routes
// Endpoints for logged-in customers to manage their own bookings.
//
// Booking ownership rule:
//   A booking belongs to the user if booking.userId == req.user.id OR
//   booking.guestEmail == req.user.email (case-insensitive). The email
//   match is what lets pre-account guest bookings show up under "my
//   bookings" once the user creates an account with the same address.
// =============================================================================

const router = require("express").Router();
const prisma = require("../utils/prisma");
const { requireAuth } = require("../middleware/auth");
const { formatBooking } = require("../utils/helpers");
const bookingService = require("../services/bookingService");

router.use(requireAuth);

function ownershipWhere(user) {
  return {
    OR: [
      { userId: user.id },
      { guestEmail: { equals: user.email, mode: "insensitive" } },
    ],
  };
}

// GET /api/account/bookings — my bookings (most recent first)
router.get("/bookings", async (req, res, next) => {
  try {
    const lang = req.query.lang || "en";
    const bookings = await prisma.booking.findMany({
      where: ownershipWhere(req.user),
      include: {
        hotel: { select: { id: true, slug: true, nameEn: true, nameFr: true, nameAr: true, city: true, cityEn: true, cityFr: true, cityAr: true } },
        rooms: { include: { room: { select: { id: true, typeEn: true, typeFr: true, typeAr: true, capacity: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ data: bookings.map((b) => formatBooking(b, lang)) });
  } catch (err) { next(err); }
});

// GET /api/account/bookings/:id — single booking detail
router.get("/bookings/:id", async (req, res, next) => {
  try {
    const lang = req.query.lang || "en";
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: { hotel: true, rooms: { include: { room: true } } },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    // ownership check: matches userId OR same email
    const isOwner =
      booking.userId === req.user.id ||
      (booking.guestEmail || "").toLowerCase() === req.user.email.toLowerCase();
    if (!isOwner) return res.status(403).json({ error: "Not your booking" });
    res.json({ data: formatBooking(booking, lang) });
  } catch (err) { next(err); }
});

// =============================================================================
// POST /api/account/bookings/:id/cancel
// -----------------------------------------------------------------------------
// Customer self-cancellation. Eligibility rules:
//   1. The booking must belong to the requesting user (userId match OR
//      same email — same ownership rule used by the read endpoints above).
//   2. The booking must be in a cancellable state (PENDING or CONFIRMED).
//   3. Check-in must be more than 48 hours away from "now."
//
// If any of these fail we return a structured error code the frontend
// can switch on for a clear message + optional support-contact link.
//
// We deliberately do NOT process refunds here. Cancellation flips the
// status to CANCELLED via the bookingService (which fires the existing
// "cancelled" email to the customer). If the booking was already PAID,
// the admin handles the refund manually — this is the right call for
// launch given we don't have SATIM automated-refund flow yet.
// =============================================================================
const CANCELLATION_WINDOW_MS = 48 * 60 * 60 * 1000;

router.post("/bookings/:id/cancel", async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, userId: true, guestEmail: true, status: true,
        checkIn: true, reference: true,
      },
    });
    if (!booking) {
      return res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
    }

    // Ownership check — same rule as the read endpoints.
    const isOwner =
      booking.userId === req.user.id ||
      (booking.guestEmail || "").toLowerCase() === req.user.email.toLowerCase();
    if (!isOwner) {
      return res.status(403).json({ error: "Not your booking", code: "NOT_OWNER" });
    }

    // Already-terminal states can't be cancelled by the customer.
    if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
      return res.status(409).json({
        error: `Cannot cancel a booking that is already ${booking.status}.`,
        code: "NOT_CANCELLABLE",
        status: booking.status,
      });
    }

    // 48-hour window check. We compute the absolute moment of check-in
    // and compare against now; if check-in is less than 48h away the
    // customer must contact support to cancel.
    const checkInMs = new Date(booking.checkIn).getTime();
    const nowMs = Date.now();
    const hoursUntilCheckIn = (checkInMs - nowMs) / (1000 * 60 * 60);
    if (checkInMs - nowMs < CANCELLATION_WINDOW_MS) {
      return res.status(409).json({
        error: "Bookings within 48 hours of check-in must be cancelled with the support team.",
        code: "WITHIN_CANCELLATION_WINDOW",
        hoursUntilCheckIn: Math.max(0, Math.round(hoursUntilCheckIn * 10) / 10),
      });
    }

    // All checks passed — transition via the bookingService so the
    // email and the cancelledAt timestamp are handled centrally.
    const formatted = await bookingService.transitionBookingStatus({
      bookingId: booking.id,
      newStatus: "CANCELLED",
      actor: "customer",
      reason: (req.body && req.body.reason) || "Cancelled by customer via self-service",
      lang: req.query.lang || req.user.preferredLang || "fr",
    });

    res.json({ data: formatted, message: "Booking cancelled." });
  } catch (err) { next(err); }
});

module.exports = router;
