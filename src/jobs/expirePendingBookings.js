// =============================================================================
// expirePendingBookings — Cron job that frees inventory held by abandoned carts
// -----------------------------------------------------------------------------
// Runs every 5 minutes (see registerCronJobs in server.js). Finds PENDING
// bookings older than PENDING_TIMEOUT_MINUTES (30) that have NOT been paid,
// and transitions them to EXPIRED.
//
// Why this matters:
//   PENDING bookings block inventory (see availabilityService). If a
//   customer abandons checkout — closes the tab, fails the payment, picks
//   bank transfer and ghosts — their room stays held forever without this
//   sweep. Real customers later trying to book those dates would be told
//   "sold out" when in fact nothing real has happened.
//
// What constitutes "abandoned":
//   - status = PENDING
//   - paymentStatus != PAID  (we don't expire bookings the customer actually paid;
//                              if status is still PENDING but they paid, that's
//                              a different bug — admin to investigate, not us)
//   - createdAt < now - 30 minutes
//
// Behavior:
//   - We transition via bookingService.transitionBookingStatus so the
//     existing email pipeline decides whether to notify. We DON'T add an
//     "expired" email yet — silent expiry is fine for v1 (the customer
//     abandoned, they don't expect a follow-up). Easy to wire later.
//   - Each booking transitions individually inside its own DB call. A
//     single failure doesn't stop the rest.
//   - We log a one-line summary per run for ops visibility.
// =============================================================================

const prisma = require("../utils/prisma");
const bookingService = require("../services/bookingService");
const { PENDING_TIMEOUT_MINUTES } = require("../services/availabilityService");

async function expirePendingBookings() {
  const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MINUTES * 60 * 1000);

  // Find candidates. We pull just the IDs; transitionBookingStatus does its
  // own read-then-update.
  const candidates = await prisma.booking.findMany({
    where: {
      status: "PENDING",
      paymentStatus: { not: "PAID" },
      createdAt: { lt: cutoff },
    },
    select: { id: true, reference: true },
  });

  if (candidates.length === 0) {
    // Don't spam logs when there's nothing to do.
    return { swept: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await bookingService.transitionBookingStatus({
        bookingId: c.id,
        newStatus: "EXPIRED",
        actor: "system",
        reason: `Auto-expired after ${PENDING_TIMEOUT_MINUTES} minutes without payment`,
      });
      succeeded++;
    } catch (err) {
      failed++;
      console.error(
        `[expirePending] failed for ${c.reference}:`,
        err.message
      );
    }
  }

  console.log(
    `[expirePending] swept ${succeeded}/${candidates.length} stale PENDING bookings` +
    (failed > 0 ? ` (${failed} failed)` : "")
  );

  return { swept: succeeded, failed };
}

module.exports = { expirePendingBookings };
