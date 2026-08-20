// =============================================================================
// paymentService — settles a SATIM payment attempt into a booking outcome
// -----------------------------------------------------------------------------
// finalizePayment() is the ONLY place a booking is marked paid. It is called
// from two directions:
//
//   routes/payments.js      when the customer is redirected back from SATIM
//   jobs/reconcilePayments  when the customer never came back
//
// It must therefore be idempotent. The customer can refresh the return page,
// and the cron can run while they are mid-refresh; neither may double-confirm,
// double-email or double-count revenue.
// =============================================================================

const prisma = require("../utils/prisma");
const satim = require("./satimService");
const bookingService = require("./bookingService");

async function finalizePayment(paymentId, lang) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      booking: {
        select: {
          id: true,
          reference: true,
          total: true,
          status: true,
          paymentStatus: true,
          lang: true,
        },
      },
    },
  });
  if (!payment || !payment.booking) {
    return { outcome: "unknown", reference: null, message: "Payment not found" };
  }

  const booking = payment.booking;
  const useLang = lang || booking.lang || "fr";

  // --- idempotency -------------------------------------------------------
  if (payment.status === "PAID" || booking.paymentStatus === "PAID") {
    return { outcome: "paid", reference: booking.reference, message: null };
  }
  if (!payment.gatewayRef) {
    return {
      outcome: "failed",
      reference: booking.reference,
      message: "This payment was never registered with the gateway.",
    };
  }

  const result = await satim.confirmOrder({ orderId: payment.gatewayRef, lang: useLang });

  // --- amount verification -----------------------------------------------
  // SATIM reports the amount in centimes. Compare it against what we
  // registered rather than trusting that the transaction is for our order.
  const expectedCentimes = payment.amount * 100;
  const reportedCentimes = result.amount === null ? null : Number(result.amount);
  if (result.paid && reportedCentimes !== null && reportedCentimes !== expectedCentimes) {
    console.error(
      `[satim] AMOUNT MISMATCH ${booking.reference}: registered ${expectedCentimes} centimes, ` +
      `SATIM reports ${reportedCentimes}. Payment ${payment.id} held for manual review.`
    );
    await prisma.payment
      .update({ where: { id: payment.id }, data: { gatewayResponse: result.raw } })
      .catch(() => {});
    return {
      outcome: "pending",
      reference: booking.reference,
      message: "This payment needs manual verification. Our team will contact you shortly.",
    };
  }

  // --- paid ---------------------------------------------------------------
  if (result.paid) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", confirmedAt: new Date(), gatewayResponse: result.raw },
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentStatus: "PAID", paidAt: new Date() },
    });

    // Reuse the existing status pipeline so the confirmation email and voucher
    // fire exactly as they do for any other confirmed booking.
    try {
      await bookingService.transitionBookingStatus({
        bookingId: booking.id,
        newStatus: "CONFIRMED",
        actor: "system",
        reason: `Payment confirmed by SATIM (order ${payment.gatewayRef})`,
        lang: useLang,
      });
    } catch (err) {
      // The money is real and recorded regardless. Never fail the customer's
      // return journey because an email could not be sent.
      console.error(
        `[satim] ${booking.reference} paid but status transition failed:`,
        err.message
      );
    }

    console.log(
      `[satim] ${booking.reference} PAID (order ${payment.gatewayRef}, OrderStatus ${result.orderStatus})`
    );
    return { outcome: "paid", reference: booking.reference, message: null };
  }

  // --- registered but not finished ---------------------------------------
  // OrderStatus 0 = "order registered, but not paid". The customer may still
  // be on the payment page. Not a failure yet; leave it for the cron.
  if (result.orderStatus === 0) {
    await prisma.payment
      .update({ where: { id: payment.id }, data: { gatewayResponse: result.raw } })
      .catch(() => {});
    return {
      outcome: "pending",
      reference: booking.reference,
      message: "Your payment has not been completed yet.",
    };
  }

  // --- declined / reversed / refunded ------------------------------------
  const message = satim.describeFailure(result, "The payment was declined.");
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "FAILED", gatewayResponse: result.raw },
  });
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "PAYMENT_FAILED", paymentStatus: "FAILED" },
  });

  console.log(
    `[satim] ${booking.reference} FAILED (order ${payment.gatewayRef}, ` +
    `OrderStatus ${result.orderStatus}, actionCode ${result.actionCode})`
  );
  return { outcome: "failed", reference: booking.reference, message };
}

module.exports = { finalizePayment };
