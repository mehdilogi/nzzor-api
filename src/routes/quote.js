// =============================================================================
// routes/quote — Phase C1: POST /api/quote
// -----------------------------------------------------------------------------
// Public, read-only. Given a hotel, dates, and per-room occupancy, returns
// ranked priced options (room type × board) with Disponible/Sur Demande
// availability. Reserves nothing.
//
// Body:
//   {
//     hotelId?: string,        // either hotelId OR hotelSlug
//     hotelSlug?: string,
//     checkIn:  "YYYY-MM-DD",
//     checkOut: "YYYY-MM-DD",
//     occupancy: [{ adults: number, children?: number }, ...]  // one per room
//   }
// =============================================================================

const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { buildQuote } = require("../services/quoteService");
const { validateBookingDates } = require("../utils/dates");

const quoteSchema = z
  .object({
    hotelId: z.string().uuid().optional(),
    hotelSlug: z.string().min(1).optional(),
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    occupancy: z
      .array(
        z.object({
          adults: z.number().int().min(1).max(20),
          children: z.number().int().min(0).max(20).default(0),
        })
      )
      .min(1)
      .max(8),
  })
  .refine((d) => d.hotelId || d.hotelSlug, {
    message: "Either hotelId or hotelSlug is required",
  });

// POST /api/quote
router.post("/", async (req, res, next) => {
  try {
    const data = quoteSchema.parse(req.body);

    // Date sanity (Algiers-local, same util the booking flow uses).
    const dateError = validateBookingDates(data.checkIn, data.checkOut);
    if (dateError) {
      return res.status(400).json({ error: dateError.message, code: dateError.code });
    }

    const hotel = await prisma.hotel.findUnique({
      where: data.hotelId ? { id: data.hotelId } : { slug: data.hotelSlug },
      include: {
        rooms: {
          where: { isActive: true },
          include: { boardRates: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!hotel || !hotel.isActive) {
      return res.status(404).json({ error: "Hotel not found" });
    }

    const quote = await buildQuote(hotel, data.occupancy, data.checkIn, data.checkOut);

    res.json({
      data: {
        hotelId: hotel.id,
        hotelSlug: hotel.slug,
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        ...quote,
      },
    });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({
        error: "Validation failed",
        details: err.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
      });
    }
    next(err);
  }
});

module.exports = router;
