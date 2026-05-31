// =============================================================================
// availabilityService — Room inventory & double-booking prevention
// -----------------------------------------------------------------------------
// This is the ONE place that decides whether a room is available for a given
// date range. Nothing else should ever count overlapping bookings ad-hoc.
//
// Three exposed functions:
//
//   checkAvailability(roomReqs, checkIn, checkOut)
//     Read-only. Returns per-room availability info. Used by:
//       - The public GET /api/availability endpoint
//       - The pre-flight check in POST /api/bookings (fast error path)
//
//   assertAvailableInTransaction(tx, roomReqs, checkIn, checkOut)
//     Called INSIDE a Prisma transaction. Acquires row locks on the rooms
//     being booked (`SELECT ... FOR UPDATE`), re-counts committed units,
//     throws AvailabilityError if any room is full. This is the
//     race-condition guard — between two simultaneous bookings for the
//     last room, exactly one wins, the other gets a clean rejection.
//
//   getUnavailableDates(roomId, fromDate, toDate)
//     Read-only. Returns the dates within [fromDate, toDate] where the
//     room is at capacity. Used by the frontend date picker to gray out
//     unavailable nights.
//
// -----------------------------------------------------------------------------
// THE OVERLAP RULE
//
// Two date ranges [A_in, A_out) and [B_in, B_out) overlap iff:
//   A_in < B_out  AND  B_in < A_out      (strict less-than)
//
// Strict because checkOut is exclusive — you don't sleep there the night
// of checkout. A booking June 10-15 does NOT conflict with one June 15-20:
// they share day 15, but neither occupies the night of the 15th.
//
// Dates are stored as `@db.Date` (no time component) so there are no
// timezone shenanigans. Comparisons are date-exact.
//
// -----------------------------------------------------------------------------
// WHICH BOOKINGS BLOCK INVENTORY
//
// A booking counts against `Room.totalUnits` iff its status is in the
// BLOCKING_STATUSES set:
//
//   PENDING    — payment hasn't arrived yet, but the room is being held.
//                Expires after PENDING_TIMEOUT_MINUTES if no payment, freeing
//                the inventory (see jobs/expirePendingBookings.js).
//   CONFIRMED  — paid or confirmed by hotel.
//
// CANCELLED, REJECTED, EXPIRED, COMPLETED, NO_SHOW, REFUNDED — all free
// inventory. (COMPLETED frees because the stay is over; if you double-book
// a past room it's moot.)
// =============================================================================

const prisma = require("../utils/prisma");

const BLOCKING_STATUSES = ["PENDING", "CONFIRMED"];

// How long a PENDING booking holds inventory before the cron expires it.
// Booking.com uses ~15-20 min. We use 30 to be generous for slow Algerian
// connections and bank-transfer/WhatsApp-assisted flows where the customer
// genuinely needs time. The cron at jobs/expirePendingBookings.js sweeps
// these.
const PENDING_TIMEOUT_MINUTES = 30;

// =============================================================================
// Custom error type — lets routes distinguish "sold out" from generic errors
// =============================================================================

class AvailabilityError extends Error {
  constructor(message, conflicts) {
    super(message);
    this.name = "AvailabilityError";
    this.statusCode = 409; // Conflict
    this.code = "NOT_AVAILABLE";
    // `conflicts` is an array of { roomId, requested, unitsLeft, totalUnits }
    // so the route response can show which specific room is the problem.
    this.conflicts = conflicts;
  }
}

// =============================================================================
// Internal: count committed units for a room over a date range
// =============================================================================
//
// Counts the sum of BookingRoom.quantity for bookings that:
//   - reference the given room
//   - have a status in BLOCKING_STATUSES
//   - overlap the given date range (strict less-than rule above)
//
// Uses Prisma's standard query. If `client` is a transaction (tx), the
// query runs inside it; otherwise uses the global prisma client.
//
// Returns: integer count of committed units.
//
async function countCommittedUnits(client, roomId, checkIn, checkOut) {
  const result = await client.bookingRoom.aggregate({
    _sum: { quantity: true },
    where: {
      roomId,
      booking: {
        status: { in: BLOCKING_STATUSES },
        // Overlap: existing booking starts before our checkout AND
        // ends after our checkin.
        checkIn:  { lt: checkOut },
        checkOut: { gt: checkIn },
      },
    },
  });
  return result._sum.quantity || 0;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Read-only availability check for one or more rooms over a date range.
 *
 * @param {Array<{roomId: string, quantity?: number}>} roomReqs
 * @param {string|Date} checkIn  — YYYY-MM-DD or Date
 * @param {string|Date} checkOut — YYYY-MM-DD or Date
 * @returns {Promise<{
 *   available: boolean,
 *   rooms: Array<{
 *     roomId: string,
 *     totalUnits: number,
 *     unitsCommitted: number,
 *     unitsLeft: number,
 *     requested: number,
 *     available: boolean,
 *   }>,
 * }>}
 *
 * Does NOT throw on unavailability — just reports. Callers decide what to do.
 * Used both by the booking flow (pre-flight check) and the public
 * GET /api/availability endpoint.
 */
async function checkAvailability(roomReqs, checkIn, checkOut) {
  const ci = new Date(checkIn);
  const co = new Date(checkOut);

  // Fetch the rooms in one query to get totalUnits for each.
  const roomIds = roomReqs.map((r) => r.roomId);
  const rooms = await prisma.room.findMany({
    where: { id: { in: roomIds } },
    select: { id: true, totalUnits: true, isActive: true },
  });
  const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]));

  const results = [];
  for (const req of roomReqs) {
    const room = roomById[req.roomId];
    if (!room) {
      results.push({
        roomId: req.roomId,
        totalUnits: 0,
        unitsCommitted: 0,
        unitsLeft: 0,
        requested: req.quantity || 1,
        available: false,
        error: "ROOM_NOT_FOUND",
      });
      continue;
    }
    if (!room.isActive) {
      results.push({
        roomId: req.roomId,
        totalUnits: room.totalUnits,
        unitsCommitted: 0,
        unitsLeft: 0,
        requested: req.quantity || 1,
        available: false,
        error: "ROOM_INACTIVE",
      });
      continue;
    }
    const committed = await countCommittedUnits(prisma, req.roomId, ci, co);
    const left = Math.max(0, room.totalUnits - committed);
    const requested = req.quantity || 1;
    results.push({
      roomId: req.roomId,
      totalUnits: room.totalUnits,
      unitsCommitted: committed,
      unitsLeft: left,
      requested,
      available: left >= requested,
    });
  }

  return {
    available: results.every((r) => r.available),
    rooms: results,
  };
}

/**
 * Assert availability inside a transaction, with row locking.
 *
 * MUST be called inside a `prisma.$transaction(async (tx) => ...)` block,
 * with the `tx` passed as the first argument. The transaction's isolation
 * level should be the default (READ COMMITTED) — we don't need higher
 * isolation because the row lock serializes the check.
 *
 * How it prevents races:
 *   1. SELECT ... FOR UPDATE on the Room rows being booked. The first
 *      transaction to ask for these locks holds them until commit/rollback;
 *      a concurrent transaction wanting the same locks waits.
 *   2. Inside the lock, we count committed units (which now includes any
 *      booking the previous holder may have just committed).
 *   3. If full → throw AvailabilityError. The transaction rolls back,
 *      releases locks. The next waiting transaction proceeds with the
 *      updated count and gets a clean rejection if applicable.
 *
 * Caller pattern:
 *
 *   try {
 *     const booking = await prisma.$transaction(async (tx) => {
 *       await assertAvailableInTransaction(tx, roomReqs, checkIn, checkOut);
 *       return tx.booking.create({ ... });
 *     });
 *   } catch (err) {
 *     if (err instanceof AvailabilityError) { return res.status(409)... }
 *     throw err;
 *   }
 *
 * @param {PrismaClient} tx — the transaction client from $transaction
 * @param {Array<{roomId, quantity?}>} roomReqs
 * @param {Date} checkIn
 * @param {Date} checkOut
 * @throws {AvailabilityError} if any room is over capacity
 */
async function assertAvailableInTransaction(tx, roomReqs, checkIn, checkOut) {
  // Step 1 — acquire row locks on the rooms being booked. We use Prisma's
  // $queryRaw because Prisma's findMany doesn't expose FOR UPDATE. The query
  // returns nothing useful; its purpose is the lock.
  //
  // Postgres only — uses SELECT FOR UPDATE with explicit table name. The
  // table is `rooms` per @@map in the schema. We use parameterized binding
  // for the room IDs to avoid SQL injection.
  const roomIds = roomReqs.map((r) => r.roomId);
  if (roomIds.length > 0) {
    // Build a parameterized IN clause: ($1, $2, $3, ...)
    const placeholders = roomIds.map((_, i) => `$${i + 1}`).join(", ");
    await tx.$queryRawUnsafe(
      `SELECT id FROM rooms WHERE id IN (${placeholders}) FOR UPDATE`,
      ...roomIds
    );
  }

  // Step 2 — re-fetch room info (totalUnits, isActive) inside the transaction,
  // then re-count committed units under the lock.
  const rooms = await tx.room.findMany({
    where: { id: { in: roomIds } },
    select: { id: true, totalUnits: true, isActive: true },
  });
  const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]));

  const conflicts = [];
  for (const req of roomReqs) {
    const room = roomById[req.roomId];
    if (!room) {
      conflicts.push({
        roomId: req.roomId,
        requested: req.quantity || 1,
        unitsLeft: 0,
        totalUnits: 0,
        reason: "ROOM_NOT_FOUND",
      });
      continue;
    }
    if (!room.isActive) {
      conflicts.push({
        roomId: req.roomId,
        requested: req.quantity || 1,
        unitsLeft: 0,
        totalUnits: room.totalUnits,
        reason: "ROOM_INACTIVE",
      });
      continue;
    }
    const committed = await countCommittedUnits(tx, req.roomId, checkIn, checkOut);
    const left = room.totalUnits - committed;
    const requested = req.quantity || 1;
    if (left < requested) {
      conflicts.push({
        roomId: req.roomId,
        requested,
        unitsLeft: Math.max(0, left),
        totalUnits: room.totalUnits,
        reason: "SOLD_OUT",
      });
    }
  }

  if (conflicts.length > 0) {
    throw new AvailabilityError(
      `One or more rooms are not available for the selected dates`,
      conflicts
    );
  }
}

/**
 * Get the set of dates within [fromDate, toDate] where the given room is
 * fully booked.
 *
 * Algorithm:
 *   - Pull every blocking booking for this room that overlaps the window.
 *   - For each date in the window, sum the quantity of bookings covering
 *     that date. If sum >= totalUnits, the date is unavailable.
 *
 * O(bookings × days) but both factors are tiny in practice (a single room
 * has at most ~30 active bookings; the window is typically 30-90 days).
 *
 * @param {string} roomId
 * @param {string|Date} fromDate
 * @param {string|Date} toDate
 * @returns {Promise<string[]>} — array of YYYY-MM-DD strings
 */
async function getUnavailableDates(roomId, fromDate, toDate) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { totalUnits: true, isActive: true },
  });
  if (!room || !room.isActive) {
    // Inactive room → every date in the window is "unavailable".
    return enumerateDates(new Date(fromDate), new Date(toDate));
  }

  const from = startOfDay(new Date(fromDate));
  const to   = startOfDay(new Date(toDate));

  const bookings = await prisma.bookingRoom.findMany({
    where: {
      roomId,
      booking: {
        status: { in: BLOCKING_STATUSES },
        // Pull bookings that overlap the window at all.
        checkIn:  { lt: to },
        checkOut: { gt: from },
      },
    },
    select: {
      quantity: true,
      booking: { select: { checkIn: true, checkOut: true } },
    },
  });

  // For each date in the window, accumulate committed units.
  const unavailable = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let d = from.getTime(); d < to.getTime(); d += dayMs) {
    const dayStart = new Date(d);
    const dayEnd = new Date(d + dayMs);
    let committed = 0;
    for (const br of bookings) {
      // booking covers this day iff checkIn < dayEnd AND checkOut > dayStart
      if (br.booking.checkIn < dayEnd && br.booking.checkOut > dayStart) {
        committed += br.quantity;
      }
    }
    if (committed >= room.totalUnits) {
      unavailable.push(formatDateISO(dayStart));
    }
  }

  return unavailable;
}

// =============================================================================
// Internal date helpers — work in UTC to match the @db.Date storage
// =============================================================================

function startOfDay(d) {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function formatDateISO(d) {
  return d.toISOString().slice(0, 10);
}

function enumerateDates(from, to) {
  const out = [];
  const start = startOfDay(from).getTime();
  const end = startOfDay(to).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let t = start; t < end; t += dayMs) {
    out.push(formatDateISO(new Date(t)));
  }
  return out;
}

module.exports = {
  checkAvailability,
  assertAvailableInTransaction,
  getUnavailableDates,
  AvailabilityError,
  PENDING_TIMEOUT_MINUTES,
  BLOCKING_STATUSES,
};
