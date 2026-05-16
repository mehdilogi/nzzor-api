const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { generateBookingRef, formatBooking } = require("../utils/helpers");
const { optionalAuth } = require("../middleware/auth");

const createBookingSchema = z.object({
  hotelId: z.string().uuid(),
  rooms: z.array(z.object({
    roomId: z.string().uuid(),
    quantity: z.number().int().min(1).default(1),
  })).min(1),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guest: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email(),
    phone: z.string().min(5).max(20),
  }),
  specialRequests: z.string().max(1000).optional(),
  paymentMethod: z.enum(["CIB", "EDDAHABIA", "CASH", "BANK_TRANSFER", "WHATSAPP_ASSISTED"]),
  lang: z.enum(["ar", "fr", "en"]).optional().default("fr"),
});

// POST /api/bookings
router.post("/", optionalAuth, async (req, res, next) => {
  try {
    const data = createBookingSchema.parse(req.body);

    const checkIn = new Date(data.checkIn);
    const checkOut = new Date(data.checkOut);
    const now = new Date();

    if (checkIn < new Date(now.toDateString())) {
      return res.status(400).json({ error: "Check-in date must be today or in the future" });
    }
    if (checkOut <= checkIn) {
      return res.status(400).json({ error: "Check-out must be after check-in" });
    }

    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    if (nights > 30) {
      return res.status(400).json({ error: "Maximum stay is 30 nights" });
    }

    const hotel = await prisma.hotel.findUnique({
      where: { id: data.hotelId },
      include: { rooms: { where: { isActive: true } } },
    });
    if (!hotel || !hotel.isActive) {
      return res.status(404).json({ error: "Hotel not found" });
    }

    let subtotal = 0;
    const bookingRooms = [];

    for (const roomReq of data.rooms) {
      const room = hotel.rooms.find(r => r.id === roomReq.roomId);
      if (!room) {
        return res.status(400).json({ error: `Room ${roomReq.roomId} not found` });
      }
      const pricePerNight = room.basePrice;
      subtotal += pricePerNight * nights * roomReq.quantity;
      bookingRooms.push({
        roomId: room.id,
        quantity: roomReq.quantity,
        pricePerNight,
      });
    }

    const total = subtotal;

    let reference;
    let attempts = 0;
    do {
      reference = generateBookingRef();
      const existing = await prisma.booking.findUnique({ where: { reference } });
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    // Cash/Bank transfer/WhatsApp = pending until payment; Card = auto-confirm on success (TODO)
    const autoConfirm = data.paymentMethod === "CASH";

    const booking = await prisma.booking.create({
      data: {
        reference,
        userId: req.user?.id || null,
        hotelId: data.hotelId,
        guestFirstName: data.guest.firstName,
        guestLastName: data.guest.lastName,
        guestEmail: data.guest.email,
        guestPhone: data.guest.phone,
        specialRequests: data.specialRequests,
        checkIn,
        checkOut,
        nights,
        subtotal,
        total,
        paymentMethod: data.paymentMethod,
        status: autoConfirm ? "CONFIRMED" : "PENDING",
        paymentStatus: "PENDING",
        confirmedAt: autoConfirm ? new Date() : null,
        source: "website",
        lang: data.lang,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        rooms: { create: bookingRooms },
      },
      include: {
        hotel: true,
        rooms: { include: { room: true } },
      },
    });

    res.status(201).json({
      data: formatBooking(booking, data.lang),
      message: "Booking created successfully",
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({
        error: "Validation failed",
        details: err.errors.map(e => ({ field: e.path.join("."), message: e.message })),
      });
    }
    next(err);
  }
});

// GET /api/bookings/:reference
router.get("/:reference", async (req, res, next) => {
  try {
    const lang = req.query.lang || "en";
    const booking = await prisma.booking.findUnique({
      where: { reference: req.params.reference.toUpperCase() },
      include: { hotel: true, rooms: { include: { room: true } } },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    res.json({ data: formatBooking(booking, lang) });
  } catch (err) { next(err); }
});

// PATCH /api/bookings/:reference/cancel
router.patch("/:reference/cancel", async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { reference: req.params.reference.toUpperCase() },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (!["PENDING", "CONFIRMED"].includes(booking.status)) {
      return res.status(400).json({ error: `Cannot cancel a booking with status: ${booking.status}` });
    }
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: req.body.reason || "Cancelled by guest",
      },
      include: { hotel: true, rooms: { include: { room: true } } },
    });
    res.json({
      data: formatBooking(updated, req.query.lang || "en"),
      message: "Booking cancelled successfully",
    });
  } catch (err) { next(err); }
});

module.exports = router;
