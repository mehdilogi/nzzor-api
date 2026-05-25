// =============================================================================
// Nzzor API — Partner Routes
// Hotel-facing endpoints. A logged-in user with role HOTEL_MANAGER sees only
// the hotels they are linked to via HotelManager. Admins see any hotel.
// =============================================================================

const router = require("express").Router();
const prisma = require("../utils/prisma");
const { requireAuth, requirePartner } = require("../middleware/auth");
const { formatBooking } = require("../utils/helpers");
const bookingService = require("../services/bookingService");

router.use(requireAuth, requirePartner);

// ---- helper: which hotel IDs is this user allowed to see? -------------------
async function userHotelIds(user) {
  if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
    const all = await prisma.hotel.findMany({ select: { id: true } });
    return all.map((h) => h.id);
  }
  const links = await prisma.hotelManager.findMany({
    where: { userId: user.id },
    select: { hotelId: true },
  });
  return links.map((l) => l.hotelId);
}

// guard: ensure a hotelId belongs to this user
async function assertHotelAccess(user, hotelId) {
  if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") return true;
  const link = await prisma.hotelManager.findUnique({
    where: { userId_hotelId: { userId: user.id, hotelId } },
  });
  return !!link;
}

// ---- GET /api/partner/me  — info about the partner and their hotels ---------
router.get("/me", async (req, res, next) => {
  try {
    const hotelIds = await userHotelIds(req.user);
    const hotels = await prisma.hotel.findMany({
      where: { id: { in: hotelIds } },
      select: { id: true, slug: true, nameEn: true, nameFr: true, nameAr: true, city: true, isActive: true },
    });
    res.json({
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          role: req.user.role,
        },
        hotels,
      },
    });
  } catch (e) { next(e); }
});

// ---- GET /api/partner/bookings  — bookings for this partner's hotels --------
router.get("/bookings", async (req, res, next) => {
  try {
    const hotelIds = await userHotelIds(req.user);
    if (hotelIds.length === 0) return res.json({ data: [] });

    const { status, hotelId, lang = "en" } = req.query;
    const where = { hotelId: { in: hotelIds } };
    if (status) where.status = status;
    if (hotelId && hotelIds.includes(hotelId)) where.hotelId = hotelId;

    const bookings = await prisma.booking.findMany({
      where,
      orderBy: [
        // pending first (most urgent), then by recency
        { status: "asc" },
        { createdAt: "desc" },
      ],
      include: {
        hotel: { select: { id: true, slug: true, nameEn: true, nameFr: true, nameAr: true, city: true } },
        rooms: {
          include: {
            room: { select: { id: true, typeEn: true, typeFr: true, typeAr: true, capacity: true } },
          },
        },
      },
      take: 200,
    });
    res.json({ data: bookings.map((b) => formatBooking(b, lang)) });
  } catch (e) { next(e); }
});

// ---- GET /api/partner/bookings/:id  — single booking detail ----------------
router.get("/bookings/:id", async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: {
        hotel: true,
        rooms: { include: { room: true } },
      },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const allowed = await assertHotelAccess(req.user, booking.hotelId);
    if (!allowed) return res.status(403).json({ error: "Not your booking" });

    res.json({ data: formatBooking(booking, req.query.lang || "en") });
  } catch (e) { next(e); }
});

// ---- POST /api/partner/bookings/:id/confirm  --------------------------------
// hotel approves a pending booking
router.post("/bookings/:id/confirm", async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      select: { id: true, hotelId: true, status: true },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (!(await assertHotelAccess(req.user, booking.hotelId))) {
      return res.status(403).json({ error: "Not your booking" });
    }
    if (booking.status !== "PENDING") {
      return res.status(400).json({ error: `Cannot confirm a booking with status ${booking.status}` });
    }

    // Hand off to bookingService. It performs the DB update and fires the
    // "confirmed" email to the guest. Partner-side actions are tagged with
    // actor="partner" in logs for audit/debug visibility.
    const formatted = await bookingService.transitionBookingStatus({
      bookingId: booking.id,
      newStatus: "CONFIRMED",
      actor: "partner",
    });

    res.json({ data: { id: formatted.id, status: formatted.status } });
  } catch (e) {
    if (e.statusCode === 404) return res.status(404).json({ error: e.message });
    next(e);
  }
});

// ---- POST /api/partner/bookings/:id/reject  ---------------------------------
// hotel rejects a pending booking — triggers refund-needed flag + customer email
router.post("/bookings/:id/reject", async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      select: { id: true, hotelId: true, status: true, paymentStatus: true },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (!(await assertHotelAccess(req.user, booking.hotelId))) {
      return res.status(403).json({ error: "Not your booking" });
    }
    if (booking.status !== "PENDING") {
      return res.status(400).json({ error: `Cannot reject a booking with status ${booking.status}` });
    }

    // If payment was already taken, mark it for refund. We do this directly
    // here (not via the service) because no email goes out for the payment
    // status change — the rejection email already covers refund expectations
    // in its body, and we don't want to spam the customer with two emails.
    if (booking.paymentStatus === "PAID") {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { paymentStatus: "REFUNDED" },
      });
    }

    // Now transition status to REJECTED — service fires the "rejected" email.
    const formatted = await bookingService.transitionBookingStatus({
      bookingId: booking.id,
      newStatus: "REJECTED",
      actor: "partner",
      reason: reason || "Hotel rejected the booking",
    });

    res.json({ data: { id: formatted.id, status: formatted.status } });
  } catch (e) {
    if (e.statusCode === 404) return res.status(404).json({ error: e.message });
    next(e);
  }
});

// ---- AVAILABILITY ----------------------------------------------------------
// GET /api/partner/availability/:hotelId?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns the closed days in the requested window. Absence of a row = OPEN.
router.get("/availability/:hotelId", async (req, res, next) => {
  try {
    const { hotelId } = req.params;
    if (!(await assertHotelAccess(req.user, hotelId))) {
      return res.status(403).json({ error: "Not your hotel" });
    }
    const from = req.query.from ? new Date(req.query.from) : new Date();
    const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 90 * 86400000);

    const rows = await prisma.hotelAvailability.findMany({
      where: { hotelId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    });
    res.json({
      data: rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        isClosed: r.isClosed,
        note: r.note,
      })),
    });
  } catch (e) { next(e); }
});

// POST /api/partner/availability/:hotelId
// body: { dates: ["YYYY-MM-DD", ...], isClosed: true|false, note?: string }
// toggles whole-property availability for the given dates.
router.post("/availability/:hotelId", async (req, res, next) => {
  try {
    const { hotelId } = req.params;
    if (!(await assertHotelAccess(req.user, hotelId))) {
      return res.status(403).json({ error: "Not your hotel" });
    }
    const { dates, isClosed, note } = req.body || {};
    if (!Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: "dates[] is required" });
    }
    const parsed = dates
      .map((s) => new Date(s))
      .filter((d) => !isNaN(d.getTime()));

    const ops = parsed.map((date) => {
      if (isClosed === false) {
        // re-open day -> delete the row if any
        return prisma.hotelAvailability.deleteMany({
          where: { hotelId, date },
        });
      }
      // close day -> upsert
      return prisma.hotelAvailability.upsert({
        where: { hotelId_date: { hotelId, date } },
        update: { isClosed: true, note: note || null },
        create: { hotelId, date, isClosed: true, note: note || null },
      });
    });
    await prisma.$transaction(ops);
    res.json({ ok: true, count: parsed.length });
  } catch (e) { next(e); }
});

module.exports = router;
