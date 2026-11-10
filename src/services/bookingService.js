// =============================================================================
// bookingService — Booking lifecycle orchestration
// -----------------------------------------------------------------------------
// This module owns ALL booking state transitions that should trigger customer
// notifications. The rule is: nothing else in the codebase calls
// `prisma.booking.update({ data: { status: ... } })` directly.
//
// Every route that changes a booking's status or paymentStatus calls one of:
//
//   transitionBookingStatus({ bookingId, newStatus, actor, reason?, lang? })
//   transitionBookingPayment({ bookingId, newPaymentStatus, actor, lang? })
//   notifyBookingCreated(booking, lang)
//
// The service:
//
// 1. Reads the current state BEFORE the update — so we know whether this
//    is a real transition (e.g. PENDING → CONFIRMED) or a no-op write.
// 2. Performs the database update atomically.
// 3. Fires the right transactional email IFF a real transition happened.
//    No-op writes (re-confirming an already-confirmed booking) don't send
//    duplicate emails.
// 4. Returns the formatted booking object so the route can shape its response.
//
// This is the ONE place where "what email goes with what state change" is
// decided. Adding a new endpoint that changes booking status just means
// calling the service — emails happen automatically. Forgetting is
// architecturally impossible.
//
// The service NEVER throws on email failure. The booking update is the source
// of truth; the email is a notification. We log email errors but propagate
// nothing — the booking is already in the right state, the customer just
// missed the email, and that's recoverable.
// =============================================================================

const prisma = require("../utils/prisma");
const { formatBooking } = require("../utils/helpers");
const emailService = require("./emailService");

// ---- Status-to-email mapping table -----------------------------------------
//
// Defines which email gets sent for each (previous, next) status pair.
// Edit this table to change behavior — DON'T add ad-hoc email sends in routes.
//
// Format:  STATUS_EMAIL_RULES[previousStatus][newStatus] = senderFnName
//
// Where senderFnName is a key in emailService (e.g. "sendBookingConfirmed").
// A missing entry means "no email for this transition."
//
// Worth noting:
// - PENDING → CONFIRMED sends "confirmed"
// - PENDING → REJECTED sends "rejected" (hotel said no)
// - Any → CANCELLED sends "cancelled" UNLESS already cancelled
// - We deliberately don't email on COMPLETED or NO_SHOW (admin/cron-only,
//   nothing the customer needs to act on)
//
const STATUS_EMAIL_RULES = {
  // Card bookings. PENDING_PAYMENT was added for SATIM after this table was
  // written and never got a row, so every paid card booking logged "no email
  // rule for PENDING_PAYMENT→CONFIRMED" and the customer never received the
  // voucher. A booking whose first card was declined (PAYMENT_FAILED) and
  // whose retry succeeded takes the same path.
  PENDING_PAYMENT: {
    CONFIRMED: "sendBookingConfirmed",
  },
  PAYMENT_FAILED: {
    CONFIRMED: "sendBookingConfirmed",
  },
  PENDING: {
    CONFIRMED: "sendBookingConfirmed",
    REJECTED: "sendBookingRejected",
    CANCELLED: "sendBookingCancelled",
  },
  ON_REQUEST: {
    // The hotel/agency accepted a Sur Demande request -> becomes a real
    // confirmed booking. Declined -> rejected. Guest can cancel while waiting.
    CONFIRMED: "sendBookingConfirmed",
    REJECTED: "sendBookingRejected",
    CANCELLED: "sendBookingCancelled",
  },
  CONFIRMED: {
    CANCELLED: "sendBookingCancelled",
    // CONFIRMED → COMPLETED is a quiet transition (cron-driven, no email)
    // CONFIRMED → NO_SHOW likewise (admin-driven, no email)
  },
};

const PAYMENT_EMAIL_RULES = {
  PENDING: { PAID: "sendBookingPaid" },
  FAILED:  { PAID: "sendBookingPaid" }, // retry succeeded
  // Note: REFUNDED transitions don't send a separate email — we cover refund
  // status in the cancellation email's body instead. Less inbox noise.
};

// Booking-include shape used by all transitions — keeps response payload
// consistent with what the routes used to return on their own.
const BOOKING_INCLUDE = {
  hotel: true,
  rooms: { include: { room: true } },
};

/**
 * Transition a booking's status, atomically, and fire the right email.
 *
 * Always returns the formatted booking. NEVER throws on email failure.
 * THROWS only on genuine database errors (booking not found, constraint
 * violation) — those should bubble up to the route's error handler.
 *
 * @param {Object} opts
 * @param {string} opts.bookingId   — Prisma booking ID (UUID)
 * @param {string} opts.newStatus   — target status
 * @param {string} opts.actor       — "admin" | "partner" | "customer" | "system"
 * @param {string} [opts.reason]    — cancellation reason (saved on the booking)
 * @param {string} [opts.lang]      — override language for the email (default: booking.lang)
 * @returns {Promise<Object>}       — formatted booking object
 */
async function transitionBookingStatus({ bookingId, newStatus, actor, reason, lang }) {
  // Read current state. We need this both to gate the email AND to verify
  // the booking actually exists before we attempt an update.
  const existing = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { status: true, lang: true },
  });
  if (!existing) {
    const err = new Error("Booking not found");
    err.statusCode = 404;
    throw err;
  }

  const previousStatus = existing.status;
  const effectiveLang = lang || existing.lang || "fr";

  // Build the update payload. Include status-specific timestamps so the
  // schema's confirmedAt / cancelledAt fields stay accurate.
  const data = { status: newStatus };
  if (newStatus === "CONFIRMED") data.confirmedAt = new Date();
  if (newStatus === "CANCELLED" || newStatus === "REJECTED") {
    data.cancelledAt = new Date();
    if (reason) data.cancellationReason = reason;
  }

  const booking = await prisma.booking.update({
    where: { id: bookingId },
    data,
    include: BOOKING_INCLUDE,
  });

  const formatted = formatBooking(booking, effectiveLang);

  // Decide if this transition triggers an email.
  const senderFnName = STATUS_EMAIL_RULES[previousStatus]?.[newStatus];
  if (senderFnName) {
    fireAndForget(senderFnName, formatted, effectiveLang, {
      bookingRef: booking.reference,
      transition: `${previousStatus}→${newStatus}`,
      actor,
    });
  } else if (previousStatus !== newStatus) {
    // Useful for ops visibility — we don't fail, but we log so it's clear
    // why no email went out for a particular transition.
    console.log(
      `[bookingService] no email rule for ${previousStatus}→${newStatus} ` +
      `(booking ${booking.reference}, actor=${actor})`
    );
  }

  // The hotel learns about every booking the moment it becomes CONFIRMED,
  // whatever the path (card payment, admin confirm, Sur Demande accepted).
  // Only on a real transition, so re-saving a confirmed booking never sends
  // the hotel a duplicate.
  if (newStatus === "CONFIRMED" && previousStatus !== "CONFIRMED") {
    fireAndForgetHotel(booking, `${previousStatus}→CONFIRMED`);
  }

  return formatted;
}

/**
 * Send the confirmation again: the customer's voucher email and the hotel
 * notification. For the admin's "Resend" button, when an email went missing
 * (wrong address, spam, the bug above). Confirmed bookings only. Awaited, so
 * the admin is told whether each one actually left.
 *
 * @returns {Promise<{ guest: string|null, hotel: string|null }>} Resend ids
 */
async function resendConfirmation(bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: BOOKING_INCLUDE,
  });
  if (!booking) {
    const err = new Error("Booking not found");
    err.statusCode = 404;
    throw err;
  }
  if (booking.status !== "CONFIRMED") {
    const err = new Error(`Only confirmed bookings can be resent (status is ${booking.status})`);
    err.statusCode = 400;
    throw err;
  }
  const lang = booking.lang || "fr";
  const formatted = formatBooking(booking, lang);
  const guest = await emailService.sendBookingConfirmed(formatted, lang).catch(() => null);
  const hotel = await emailService.sendHotelNotification(booking).catch(() => null);
  console.log(`[bookingService] resent confirmation for ${booking.reference}: guest=${guest ? "sent" : "failed"}, hotel=${hotel ? "sent" : "failed"}`);
  return { guest, hotel };
}

/**
 * Transition a booking's paymentStatus, atomically, and fire the right email.
 *
 * Same contract as transitionBookingStatus: never throws on email errors,
 * always returns formatted booking.
 *
 * @param {Object} opts
 * @param {string} opts.bookingId          — Prisma booking ID (UUID)
 * @param {string} opts.newPaymentStatus   — target paymentStatus
 * @param {string} opts.actor              — who initiated the change
 * @param {string} [opts.lang]             — override language
 * @returns {Promise<Object>}              — formatted booking object
 */
async function transitionBookingPayment({ bookingId, newPaymentStatus, actor, lang }) {
  const existing = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { paymentStatus: true, lang: true },
  });
  if (!existing) {
    const err = new Error("Booking not found");
    err.statusCode = 404;
    throw err;
  }

  const previousPaymentStatus = existing.paymentStatus;
  const effectiveLang = lang || existing.lang || "fr";

  const data = { paymentStatus: newPaymentStatus };
  if (newPaymentStatus === "PAID") data.paidAt = new Date();

  const booking = await prisma.booking.update({
    where: { id: bookingId },
    data,
    include: BOOKING_INCLUDE,
  });

  const formatted = formatBooking(booking, effectiveLang);

  const senderFnName = PAYMENT_EMAIL_RULES[previousPaymentStatus]?.[newPaymentStatus];
  if (senderFnName) {
    fireAndForget(senderFnName, formatted, effectiveLang, {
      bookingRef: booking.reference,
      transition: `payment:${previousPaymentStatus}→${newPaymentStatus}`,
      actor,
    });
  } else {
    console.log(
      `[bookingService] no payment-email rule for ${previousPaymentStatus}→${newPaymentStatus} ` +
      `(booking ${booking.reference}, actor=${actor})`
    );
  }

  return formatted;
}

/**
 * Fire the "booking received" email after a new booking is created.
 *
 * This is structurally different from a state transition — it's an INSERT,
 * not an UPDATE — so it gets its own helper. The route still creates the
 * booking; this just handles "tell the customer it's in the queue."
 *
 * @param {Object} formattedBooking — already-formatted booking object
 * @param {string} lang             — language for the email
 */
function notifyBookingCreated(formattedBooking, lang) {
  fireAndForget("sendBookingCreated", formattedBooking, lang || "fr", {
    bookingRef: formattedBooking.reference,
    transition: "new:created",
    actor: "customer",
  });
}

/**
 * Fire the "request received" email for a new ON_REQUEST (Sur Demande)
 * booking. Distinct from notifyBookingCreated because the message is
 * different: the stay is NOT yet confirmed — the hotel/agency will review
 * and confirm or decline. Falls back to sendBookingCreated if the dedicated
 * sender isn't defined in emailService (so a missing template degrades
 * gracefully rather than sending nothing).
 *
 * @param {Object} formattedBooking — already-formatted booking object
 * @param {string} lang             — language for the email
 */
function notifyBookingRequested(formattedBooking, lang) {
  const senderName =
    typeof emailService.sendBookingRequested === "function"
      ? "sendBookingRequested"
      : "sendBookingCreated";
  fireAndForget(senderName, formattedBooking, lang || "fr", {
    bookingRef: formattedBooking.reference,
    transition: "new:on_request",
    actor: "customer",
  });
}

// ---- Internal: fire-and-forget email helper -------------------------------
//
// Wraps the email send in:
// - setImmediate so the HTTP response goes out before the send happens
// - try/catch so a thrown render error doesn't crash the process
// - structured logging that ties every send back to a booking + transition
//
// Returns nothing — the caller doesn't await this and shouldn't try to.
function fireAndForget(senderFnName, formattedBooking, lang, context) {
  setImmediate(async () => {
    try {
      const senderFn = emailService[senderFnName];
      if (typeof senderFn !== "function") {
        console.error(
          `[bookingService] no such email sender "${senderFnName}" ` +
          `(${context.bookingRef}, ${context.transition})`
        );
        return;
      }
      await senderFn(formattedBooking, lang);
    } catch (err) {
      console.error(
        `[bookingService] email send threw for ${context.bookingRef} ` +
        `(${context.transition}, actor=${context.actor}):`,
        err
      );
    }
  });
}

// Hotel notification, same fire-and-forget contract as the guest emails.
function fireAndForgetHotel(rawBooking, transition) {
  setImmediate(async () => {
    try {
      if (typeof emailService.sendHotelNotification !== "function") {
        console.error(`[bookingService] sendHotelNotification missing (${rawBooking.reference})`);
        return;
      }
      await emailService.sendHotelNotification(rawBooking);
    } catch (err) {
      console.error(`[bookingService] hotel notification threw for ${rawBooking.reference} (${transition}):`, err);
    }
  });
}

module.exports = {
  transitionBookingStatus,
  resendConfirmation,
  transitionBookingPayment,
  notifyBookingCreated,
  notifyBookingRequested,
};
