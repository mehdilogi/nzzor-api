// =============================================================================
// Admin → Groups (GET /api/admin/groups, PATCH /api/admin/groups/:id)
// =============================================================================

const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

router.use(requireAuth, requireAdmin);

const STATUSES = ["NEW", "QUOTED", "WON", "LOST"];

router.get("/", async (req, res, next) => {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : undefined;
    const [rows, counts] = await Promise.all([
      prisma.groupRequest.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
      prisma.groupRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const c of counts) byStatus[c.status] = c._count._all;
    const won = await prisma.groupRequest.aggregate({
      where: { status: "WON" },
      _sum: { quoteAmount: true },
    });
    res.json({ data: rows, counts: byStatus, wonTotal: won._sum.quoteAmount || 0 });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  status: z.enum(["NEW", "QUOTED", "WON", "LOST"]).optional(),
  quoteAmount: z.coerce.number().int().min(0).max(1e10).nullable().optional(),
  adminNotes: z.string().max(5000).nullable().optional(),
});

router.patch("/:id", async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: "Validation failed" });
    const row = await prisma.groupRequest.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ data: row });
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

// =============================================================================
// Group → booking
// -----------------------------------------------------------------------------
// GET  /api/admin/groups/hotels?q=      hotels + active rooms, for the form
// POST /api/admin/groups/:id/booking    create the real booking
//
// The booking is a normal Booking row (source "group"), so everything that
// already works for bookings works for groups: the voucher to the customer,
// the hotel notification, Accounting, the admin Bookings list, availability.
//
// Payment:
//   BANK_TRANSFER  paid to the agency      → created CONFIRMED (voucher + hotel
//                                            email now); mark PAID in Bookings
//                                            once the transfer clears
//   CASH           paid at the hotel       → created CONFIRMED; hotel owes the
//                                            commission in Accounting
//   CIB            card online via /pay    → created PENDING_PAYMENT; confirms
//                                            itself (voucher + hotel) on payment
//
// Prices are the NEGOTIATED group prices per room per night, entered by the
// admin — never the public rate. The agency's cut can be fixed per booking
// (commissionAmount); otherwise the hotel's normal terms apply.
// =============================================================================
const { generateBookingRef, formatBooking } = require("../utils/helpers");
const bookingService = require("../services/bookingService");
const { assertAvailableInTransaction, AvailabilityError } = require("../services/availabilityService");

const WEB_BASE_URL = process.env.WEB_BASE_URL || "https://nzzor.com";
const AGENCY_EMAIL = process.env.AGENCY_EMAIL || "contact@nzzor.com";

router.get("/hotels", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const hotels = await prisma.hotel.findMany({
      where: {
        isActive: true,
        ...(q ? { OR: [
          { nameFr: { contains: q, mode: "insensitive" } },
          { nameEn: { contains: q, mode: "insensitive" } },
          { cityFr: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
        ] } : {}),
      },
      select: {
        id: true, nameFr: true, cityFr: true, city: true,
        commissionType: true, commissionRate: true, commissionFixed: true,
        rooms: {
          where: { isActive: true },
          select: { id: true, typeFr: true, basePrice: true, totalUnits: true },
          orderBy: { basePrice: "asc" },
        },
      },
      orderBy: { nameFr: "asc" },
      take: 40,
    });
    res.json({ data: hotels });
  } catch (err) {
    next(err);
  }
});

const convertSchema = z.object({
  hotelId: z.string().uuid(),
  rooms: z.array(z.object({
    roomId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(500),
    pricePerNight: z.coerce.number().int().min(0).max(10000000),
  })).min(1),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(["BANK_TRANSFER", "CASH", "CIB"]),
  guestEmail: z.string().trim().email().nullish().or(z.literal("")),
  commissionAmount: z.coerce.number().int().min(0).nullish(),
  specialRequests: z.string().max(1000).nullish(),
  // The agency confirmed the rooms with the hotel directly: book even if the
  // rooms entered on Nzzor are fewer than the group needs.
  force: z.boolean().optional().default(false),
});

router.post("/:id/booking", async (req, res, next) => {
  try {
    const parsed = convertSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parsed.error.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
      });
    }
    const d = parsed.data;

    const group = await prisma.groupRequest.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ error: "Group request not found" });
    if (group.bookingId) {
      return res.status(409).json({ error: `Already booked as ${group.bookingRef}`, code: "ALREADY_BOOKED" });
    }

    const checkIn = new Date(`${d.checkIn}T00:00:00.000Z`);
    const checkOut = new Date(`${d.checkOut}T00:00:00.000Z`);
    const nights = Math.round((checkOut - checkIn) / 86400000);
    if (nights < 1) return res.status(400).json({ error: "Check-out must be after check-in" });

    const hotel = await prisma.hotel.findUnique({
      where: { id: d.hotelId },
      include: { rooms: { where: { isActive: true } } },
    });
    if (!hotel) return res.status(404).json({ error: "Hotel not found" });
    for (const r of d.rooms) {
      if (!hotel.rooms.find((x) => x.id === r.roomId)) {
        return res.status(400).json({ error: "A selected room does not belong to this hotel" });
      }
    }

    const subtotal = d.rooms.reduce((a, r) => a + r.pricePerNight * r.quantity * nights, 0);
    if (d.commissionAmount != null && d.commissionAmount > subtotal) {
      return res.status(400).json({ error: "Commission cannot exceed the total" });
    }

    const parts = String(group.contactName || "").trim().split(/\s+/);
    const firstName = parts.shift() || "Groupe";
    const lastName = parts.join(" ") || group.organization || group.reference;
    const isCard = d.paymentMethod === "CIB";
    const roomSpec = d.rooms.map((r) => ({ roomId: r.roomId, quantity: r.quantity }));

    let booking;
    try {
      booking = await prisma.$transaction(async (tx) => {
        if (!d.force) await assertAvailableInTransaction(tx, roomSpec, checkIn, checkOut);

        let reference;
        for (let i = 0; i < 10; i++) {
          reference = generateBookingRef();
          if (!(await tx.booking.findUnique({ where: { reference } }))) break;
        }

        const groupNote = [
          `Groupe ${group.reference} · ${group.people} pers.${group.organization ? " · " + group.organization : ""}`,
          d.specialRequests || null,
        ].filter(Boolean).join(" — ");

        return tx.booking.create({
          data: {
            reference,
            hotelId: hotel.id,
            guestFirstName: firstName,
            guestLastName: lastName,
            guestEmail: d.guestEmail || group.email || AGENCY_EMAIL,
            guestPhone: String(group.phone).slice(0, 30),
            specialRequests: groupNote.slice(0, 1000),
            checkIn,
            checkOut,
            nights,
            subtotal,
            total: subtotal,
            paymentMethod: d.paymentMethod,
            // Created PENDING and confirmed through bookingService right after,
            // so the voucher and hotel emails follow the one standard path.
            status: isCard ? "PENDING_PAYMENT" : "PENDING",
            paymentStatus: "PENDING",
            source: "group",
            lang: group.lang || "fr",
            ...(d.commissionAmount != null
              ? { commissionAmount: d.commissionAmount, commissionRate: null, commissionBasis: `Groupe ${group.reference}` }
              : {}),
            rooms: {
              create: d.rooms.map((r) => ({
                roomId: r.roomId,
                quantity: r.quantity,
                pricePerNight: r.pricePerNight,
                board: null,
              })),
            },
          },
        });
      });
    } catch (txErr) {
      if (txErr instanceof AvailabilityError) {
        return res.status(409).json({
          error: "Not enough rooms on Nzzor for these dates. If the hotel confirmed the rooms directly, tick “Confirmed with the hotel” and create again.",
          code: txErr.code,
          conflicts: txErr.conflicts,
        });
      }
      throw txErr;
    }

    let formatted;
    if (!isCard) {
      formatted = await bookingService.transitionBookingStatus({
        bookingId: booking.id,
        newStatus: "CONFIRMED",
        actor: "admin",
        reason: `Group ${group.reference}`,
      });
    }

    await prisma.groupRequest.update({
      where: { id: group.id },
      data: {
        bookingId: booking.id,
        bookingRef: booking.reference,
        status: "WON",
        ...(group.quoteAmount == null ? { quoteAmount: subtotal } : {}),
      },
    });

    console.log(`[groups] ${group.reference} → booking ${booking.reference} (${d.paymentMethod}, ${subtotal} DA${d.force ? ", forced" : ""})`);

    res.status(201).json({
      data: {
        reference: booking.reference,
        bookingId: booking.id,
        total: subtotal,
        status: isCard ? "PENDING_PAYMENT" : "CONFIRMED",
        payUrl: isCard ? `${WEB_BASE_URL}/pay/${booking.reference}?lang=${group.lang || "fr"}` : null,
        booking: formatted || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
