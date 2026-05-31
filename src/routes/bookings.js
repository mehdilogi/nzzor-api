const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { generateBookingRef, formatBooking } = require("../utils/helpers");
const { optionalAuth } = require("../middleware/auth");
const bookingService = require("../services/bookingService");
const {
  assertAvailableInTransaction,
  AvailabilityError,
} = require("../services/availabilityService");
const { validateBookingDates } = require("../utils/dates");

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
  // Optional "create an account while you book" flow. If both flags arrive,
  // we create a new user from the guest details before persisting the
  // booking — the booking gets attached via userId, the user gets a token
  // returned so they're signed in on the response.
  // If an account with this email already exists, we ignore createAccount
  // silently (we don't want to fail the booking, and we definitely don't
  // want to leak whether the email is registered).
  createAccount: z.boolean().optional().default(false),
  password: z.string().min(8).max(100).optional(),
  promoCode: z.string().optional(),
});

// POST /api/bookings
router.post("/", optionalAuth, async (req, res, next) => {
  try {
    const data = createBookingSchema.parse(req.body);

    // Validate date logic using ALGERIA local time as the reference. The
    // previous implementation used the server's UTC `new Date()`, which on
    // Railway US-East could disagree with Algiers by 8 hours and reject
    // legitimate same-day bookings made late in the Algeria evening.
    // The dates util returns a structured error code so the frontend can
    // localize the message — we forward both the code and a fallback message.
    const dateError = validateBookingDates(data.checkIn, data.checkOut);
    if (dateError) {
      return res.status(400).json({
        error: dateError.message,
        code: dateError.code,
      });
    }

    const checkIn = new Date(data.checkIn);
    const checkOut = new Date(data.checkOut);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));

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

    // -------- Optional: create-account-while-booking ----------------------
    // If the customer ticked "create an account" AND we're not already
    // signed in AND they gave a password, try to create the user now.
    //
    // We do this BEFORE creating the booking so the booking gets attached
    // via userId from the start. We never fail the booking if the user
    // create fails — if email is taken, schema validates, etc., we just
    // log and continue with userId=null. The customer will see their
    // booking appear under "my bookings" once they sign in/up later
    // (email-ownership rule).
    //
    // Security: we don't reveal whether the email was already registered
    // (would leak account existence). Either way, the booking succeeds and
    // the success response indicates whether an account was created.
    let createdUserId = null;
    let createdUserToken = null;
    if (
      data.createAccount &&
      data.password &&
      !req.user &&
      data.password.length >= 8
    ) {
      try {
        const existingUser = await prisma.user.findUnique({
          where: { email: data.guest.email },
        });
        if (!existingUser) {
          const passwordHash = await bcrypt.hash(data.password, 12);
          const newUser = await prisma.user.create({
            data: {
              email: data.guest.email,
              passwordHash,
              firstName: data.guest.firstName,
              lastName: data.guest.lastName,
              phone: data.guest.phone,
              preferredLang: data.lang,
            },
          });
          createdUserId = newUser.id;
          // Sign the user in immediately — the frontend uses this token
          // to populate AuthContext so the post-booking page already
          // shows them as logged in.
          if (process.env.JWT_SECRET) {
            createdUserToken = jwt.sign(
              { userId: newUser.id },
              process.env.JWT_SECRET,
              { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
            );
          }
        }
        // If user existed, we silently skip account creation. The booking
        // proceeds attached by email (ownership rule) and the user can
        // sign in normally to see it.
      } catch (acctErr) {
        // Log but don't fail the booking. A failed account creation
        // shouldn't cost the customer their reservation.
        console.error("[bookings] createAccount failed:", acctErr.message);
      }
    }

    // Cash/Bank transfer/WhatsApp = pending until payment; Card = auto-confirm on success (TODO)
    const autoConfirm = data.paymentMethod === "CASH";

    // -------- Atomic: reserve inventory, generate ref, insert booking ----
    // The transaction ensures NO race condition between two simultaneous
    // bookings for the last room. assertAvailableInTransaction takes a
    // row lock on the relevant Room rows; if another transaction has
    // already taken the inventory, this one sees the updated count and
    // throws AvailabilityError → 409 to the customer.
    //
    // Reference generation runs inside the transaction too — extremely
    // unlikely to collide (16 million combinations) but cheap insurance.
    //
    // Account creation is intentionally OUTSIDE this transaction: it
    // happens before, has its own error swallow, and a stale createdUserId
    // attached to a failed booking is harmless (the user can still sign in,
    // they just don't have the booking attached to their account).
    let booking;
    try {
      booking = await prisma.$transaction(async (tx) => {
        // Lock-and-check room inventory.
        await assertAvailableInTransaction(tx, data.rooms, checkIn, checkOut);

        // Generate a unique reference. Inside the transaction so concurrent
        // bookings can't collide on the reference unique constraint.
        let reference;
        let attempts = 0;
        do {
          reference = generateBookingRef();
          const existing = await tx.booking.findUnique({ where: { reference } });
          if (!existing) break;
          attempts++;
        } while (attempts < 10);

        return tx.booking.create({
          data: {
            reference,
            userId: req.user?.id || createdUserId || null,
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
      });
    } catch (txErr) {
      // Availability conflict — turn into a clean 409 with detail per room
      // so the frontend can highlight "this specific room is sold out".
      if (txErr instanceof AvailabilityError) {
        return res.status(409).json({
          error: txErr.message,
          code: txErr.code,
          conflicts: txErr.conflicts,
        });
      }
      throw txErr; // unrelated DB error — let the global handler take it
    }

    const formattedBooking = formatBooking(booking, data.lang);

    // Notify the customer asynchronously via the booking service. The service
    // owns the fire-and-forget pattern — if Resend is slow, down, or
    // misconfigured we DO NOT want to fail the booking. The booking is
    // already persisted, the customer needs their reference.
    bookingService.notifyBookingCreated(formattedBooking, data.lang);

    res.status(201).json({
      data: formattedBooking,
      // If we created an account as part of this booking, the frontend uses
      // this token to populate AuthContext so the user lands on the
      // confirmation page already signed in. accountCreated tells the UI
      // whether to show "your account is ready" vs just the booking.
      account: createdUserId ? {
        created: true,
        token: createdUserToken,
        userId: createdUserId,
      } : null,
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
      select: { id: true, status: true, lang: true },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (!["PENDING", "CONFIRMED"].includes(booking.status)) {
      return res.status(400).json({ error: `Cannot cancel a booking with status: ${booking.status}` });
    }

    // Hand off to the booking service. It handles the DB update, fires the
    // "cancelled" email, and gives us back a formatted response payload.
    const formatted = await bookingService.transitionBookingStatus({
      bookingId: booking.id,
      newStatus: "CANCELLED",
      actor: "customer",
      reason: req.body.reason || "Cancelled by guest",
      lang: req.query.lang || booking.lang || "en",
    });

    res.json({ data: formatted, message: "Booking cancelled successfully" });
  } catch (err) { next(err); }
});

module.exports = router;
