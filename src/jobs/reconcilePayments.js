// =============================================================================
// reconcilePayments — settles SATIM payments the browser never confirmed
// -----------------------------------------------------------------------------
// WHY THIS JOB EXISTS
//
// SATIM's spec is explicit: "Si aucune demande de confirmation n'est reçue par
// la passerelle de paiement, elle sera automatiquement annulée après un certain
// délai." Confirmation is not merely how we learn the result — it is how the
// payment is kept. An unacknowledged payment reverses.
//
// The return redirect is not a reliable trigger for it. A customer who pays and
// then closes the tab, loses signal on a mobile connection, or lands on a
// timed-out browser never hits /api/payments/satim/return. Without this sweep,
// they would be debited and we would never confirm — the worst possible
// outcome, and one that only shows up as an angry customer days later.
//
// So: every few minutes, take every payment attempt still awaiting an answer
// and ask SATIM directly. finalizePayment() is idempotent, so a race with the
// customer's own return request is harmless.
//
// WHY expirePendingBookings DOES NOT COVER THIS
//
// That job sweeps status = PENDING. Card bookings are created as
// PENDING_PAYMENT and are therefore invisible to it — deliberately. Expiring a
// booking on a 30-minute timer while the customer is still on SATIM's payment
// page entering an OTP would release their room and then take their money.
// Card bookings are only ever expired here, and only after SATIM has confirmed
// the order was not paid.
// =============================================================================

const prisma = require("../utils/prisma");
const satim = require("../services/satimService");
const { finalizePayment } = require("../services/paymentService");

// How long to leave an attempt alone before asking SATIM about it. Long enough
// that a customer typing a card number and waiting for an OTP is not disturbed.
const MIN_AGE_MINUTES = Number(process.env.SATIM_RECONCILE_MIN_AGE_MINUTES || 10);

// After this long with no successful payment, stop asking and release the room.
// Comfortably beyond any realistic 3-D Secure session.
const ABANDON_AFTER_MINUTES = Number(process.env.SATIM_ABANDON_AFTER_MINUTES || 120);

// Safety valve so one bad run cannot hammer SATIM.
const MAX_PER_RUN = Number(process.env.SATIM_RECONCILE_MAX_PER_RUN || 50);

// How long to hold a card booking whose order registration never succeeded.
// Shorter than ABANDON_AFTER_MINUTES because there is nothing to wait for:
// SATIM never issued an order id, so no payment can arrive against it. Matches
// the 30-minute hold window used for ordinary PENDING bookings.
const ORPHAN_AFTER_MINUTES = Number(process.env.SATIM_ORPHAN_AFTER_MINUTES || 30);

// ---------------------------------------------------------------------------
// Pass 2 — card bookings whose registration never got off the ground
// ---------------------------------------------------------------------------
// THE GAP THIS CLOSES
//
// When register.do fails — SATIM unreachable, credentials refused, merchant
// account disabled — routes/payments.js marks the Payment row FAILED but the
// BOOKING stays PENDING_PAYMENT, holding its room.
//
// Neither existing sweep can reach it:
//   expirePendingBookings  targets status = PENDING, so it skips PENDING_PAYMENT
//   reconcilePayments      requires a gatewayRef, and there isn't one
//
// So the room was held forever. In production that means one bad minute at the
// gateway silently removes inventory until somebody notices by hand.
//
// A booking is only expired here when it has NO live registered attempt — that
// is, no PENDING payment carrying a gatewayRef. If a real attempt is in flight,
// pass 1 owns it and this pass leaves it alone. Runs whether or not SATIM is
// configured, because an unconfigured gateway is precisely when these pile up.
async function expireOrphanedCardBookings() {
  const cutoff = new Date(Date.now() - ORPHAN_AFTER_MINUTES * 60 * 1000);

  const orphans = await prisma.booking.findMany({
    where: {
      status: "PENDING_PAYMENT",
      paymentStatus: { not: "PAID" },
      createdAt: { lt: cutoff },
      payments: {
        none: {
          status: "PENDING",
          isRefund: false,
          gatewayRef: { not: null },
        },
      },
    },
    select: { id: true, reference: true },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN,
  });

  if (orphans.length === 0) return { expired: 0 };

  let expired = 0;
  for (const b of orphans) {
    try {
      // Direct update rather than transitionBookingStatus: the customer never
      // reached a payment page, so there is nothing to notify them about and
      // an "expired" email would be the first they hear of a booking they
      // believe failed.
      await prisma.booking.update({
        where: { id: b.id },
        data: { status: "EXPIRED", paymentStatus: "FAILED" },
      });
      expired++;
    } catch (err) {
      console.error(`[reconcile] could not expire orphan ${b.reference}:`, err.message);
    }
  }

  console.log(
    `[reconcile] released ${expired} card booking(s) whose registration never succeeded`
  );
  return { expired };
}

async function reconcilePayments() {
  // Pass 2 first, and unconditionally: these bookings hold inventory and need
  // no gateway call to resolve.
  let orphanResult = { expired: 0 };
  try {
    orphanResult = await expireOrphanedCardBookings();
  } catch (err) {
    console.error("[reconcile] orphan sweep failed:", err.message);
  }

  if (!satim.isConfigured()) {
    return { checked: 0, skipped: "not_configured", orphansExpired: orphanResult.expired };
  }

  const now = Date.now();
  const minAgeCutoff = new Date(now - MIN_AGE_MINUTES * 60 * 1000);
  const abandonCutoff = new Date(now - ABANDON_AFTER_MINUTES * 60 * 1000);

  const candidates = await prisma.payment.findMany({
    where: {
      status: "PENDING",
      isRefund: false,
      gatewayRef: { not: null }, // never registered = nothing to ask about
      createdAt: { lt: minAgeCutoff },
      booking: { paymentStatus: { not: "PAID" } },
    },
    select: { id: true, createdAt: true, booking: { select: { reference: true, lang: true } } },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN,
  });

  if (candidates.length === 0) return { checked: 0, orphansExpired: orphanResult.expired };

  let paid = 0;
  let failed = 0;
  let stillPending = 0;
  let abandoned = 0;
  let errored = 0;

  for (const c of candidates) {
    try {
      const result = await finalizePayment(c.id, c.booking?.lang || "fr");

      if (result.outcome === "paid") {
        paid++;
        // A payment recovered here is one the customer would otherwise have
        // lost. Log it loudly enough to notice a pattern.
        console.log(`[reconcile] recovered payment for ${result.reference}`);
      } else if (result.outcome === "failed") {
        failed++;
      } else {
        stillPending++;
        // Registered but never completed, and old enough to give up on.
        if (new Date(c.createdAt) < abandonCutoff) {
          await abandon(c.id);
          abandoned++;
        }
      }
    } catch (err) {
      errored++;
      console.error(`[reconcile] ${c.booking?.reference || c.id} failed:`, err.message);
    }
  }

  console.log(
    `[reconcile] checked ${candidates.length} — paid ${paid}, failed ${failed}, ` +
    `pending ${stillPending}, abandoned ${abandoned}` + (errored ? `, errors ${errored}` : "")
  );

  return {
    checked: candidates.length,
    paid, failed, stillPending, abandoned, errored,
    orphansExpired: orphanResult.expired,
  };
}

// Give up on an attempt SATIM still reports as registered-but-unpaid. The
// booking goes to EXPIRED, which releases the held inventory. We deliberately
// do NOT mark it PAYMENT_FAILED: nothing was declined, the customer simply
// never finished.
async function abandon(paymentId) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, bookingId: true, booking: { select: { reference: true, status: true, paymentStatus: true } } },
  });
  if (!payment || !payment.booking) return;
  if (payment.booking.paymentStatus === "PAID") return; // paid in the meantime

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "FAILED" },
  });
  await prisma.booking.update({
    where: { id: payment.bookingId },
    data: { status: "EXPIRED", paymentStatus: "FAILED" },
  });
  console.log(
    `[reconcile] abandoned ${payment.booking.reference} after ${ABANDON_AFTER_MINUTES}m — inventory released`
  );
}

module.exports = {
  reconcilePayments,
  expireOrphanedCardBookings,
  MIN_AGE_MINUTES,
  ABANDON_AFTER_MINUTES,
  ORPHAN_AFTER_MINUTES,
};
