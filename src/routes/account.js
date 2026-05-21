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

module.exports = router;
