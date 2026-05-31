// =============================================================================
// availability routes — public read-only endpoints for room availability
// -----------------------------------------------------------------------------
// These are called by the frontend to:
//   - Show "X rooms left" / "Sold out" indicators on hotel pages
//   - Gray out fully-booked dates in the date picker
//   - Pre-flight check before sending a booking POST
//
// Both endpoints are public (no auth) — knowing whether a hotel is full is
// not sensitive info. Same as Booking.com's open availability API.
// =============================================================================

const router = require("express").Router();
const { z } = require("zod");
const {
  checkAvailability,
  getUnavailableDates,
} = require("../services/availabilityService");

// -----------------------------------------------------------------------------
// GET /api/availability?roomId=...&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD
// or   POST /api/availability/check  with { rooms: [...], checkIn, checkOut }
//
// Returns per-room availability info. The POST form supports checking
// multiple rooms in one call (used when a customer is reserving multiple
// room types in a single booking).
// -----------------------------------------------------------------------------

const checkSchema = z.object({
  rooms: z.array(z.object({
    roomId: z.string().uuid(),
    quantity: z.number().int().min(1).default(1),
  })).min(1),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.post("/check", async (req, res, next) => {
  try {
    const data = checkSchema.parse(req.body);

    if (new Date(data.checkOut) <= new Date(data.checkIn)) {
      return res.status(400).json({
        error: "checkOut must be after checkIn",
        code: "INVALID_DATES",
      });
    }

    const result = await checkAvailability(
      data.rooms,
      data.checkIn,
      data.checkOut
    );

    res.json({ data: result });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({
        error: "Validation failed",
        details: err.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }
    next(err);
  }
});

// -----------------------------------------------------------------------------
// GET /api/availability/dates?roomId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns the dates in [from, to) where this room is fully booked. The
// frontend date picker uses these to gray out unavailable nights.
//
// Hard limits on window size to prevent abuse (returning a year of dates
// for an unauthenticated client is wasteful).
// -----------------------------------------------------------------------------

router.get("/dates", async (req, res, next) => {
  try {
    const { roomId, from, to } = req.query;

    if (!roomId || !/^[0-9a-f-]{36}$/i.test(roomId)) {
      return res.status(400).json({ error: "roomId required (UUID)" });
    }
    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return res.status(400).json({ error: "from required (YYYY-MM-DD)" });
    }
    if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: "to required (YYYY-MM-DD)" });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const days = Math.round((toDate - fromDate) / (24 * 60 * 60 * 1000));
    if (days <= 0) {
      return res.status(400).json({ error: "to must be after from" });
    }
    if (days > 366) {
      return res.status(400).json({
        error: "Window too large (max 366 days)",
        code: "WINDOW_TOO_LARGE",
      });
    }

    const unavailable = await getUnavailableDates(roomId, fromDate, toDate);

    res.json({
      data: {
        roomId,
        from,
        to,
        unavailableDates: unavailable,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
