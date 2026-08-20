// =============================================================================
// /api/payments — SATIM-EPG (CIB WEB) hosted-redirect payment flow
// -----------------------------------------------------------------------------
// The eight steps in SATIM's spec map onto this file as follows:
//
//   1. Customer places the order on our site        -> POST /api/bookings
//   2. We register the order with SATIM             -> POST /satim/initiate
//   3. SATIM returns orderId + formUrl              -> stored on Payment
//   4. We redirect the customer to formUrl          -> frontend does this
//   5. Customer enters their CIB card details       -> on SATIM's domain
//   6. SATIM redirects to our returnUrl / failUrl   -> GET /satim/return|fail
//   7. We ask SATIM for the real result             -> finalizePayment()
//   8. We show the customer the outcome             -> redirect to the web app
//
// Two design decisions worth understanding before changing anything here.
//
// A. THE RETURN URL CARRIES OUR OWN PAYMENT ID.
//    We register returnUrl as ".../satim/return?p=<paymentId>". The spec does
//    not document which query parameters SATIM appends on the redirect, so we
//    do not depend on any of them: we look the payment up by our own id and
//    read the gateway reference from our database. Whatever SATIM adds is a
//    bonus, not a requirement. `orderId` from the query is accepted only as a
//    fallback when `p` is missing.
//
// B. THE BROWSER NEVER DECIDES WHETHER A PAYMENT SUCCEEDED.
//    Landing on /satim/return proves only that a browser was redirected. The
//    customer can edit that URL. Money is confirmed exclusively by the
//    server-to-server acknowledgeTransaction call in finalizePayment(), and
//    the amount SATIM reports is checked against the amount we registered.
// =============================================================================

const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../utils/prisma");
const satim = require("../services/satimService");
const { finalizePayment } = require("../services/paymentService");

const API_BASE_URL = (process.env.API_BASE_URL || "https://api.nzzor.com").replace(/\/+$/, "");
const WEB_BASE_URL = (process.env.WEB_BASE_URL || "https://nzzor.com").replace(/\/+$/, "");

// Payment methods that go through the SATIM hosted page. Both CIB and
// Edahabia produce an identical register.do call — the spec has no card-type
// parameter, the gateway decides acceptance when the card is entered. Keeping
// them as separate values preserves what the customer told us they intended,
// which is worth having in analytics and in support conversations.
const CARD_METHODS = ["CIB", "EDDAHABIA"];

const initiateSchema = z.object({
  reference: z.string().min(4).max(32),
  lang: z.enum(["ar", "fr", "en"]).optional().default("fr"),
});

// ---------------------------------------------------------------------------
// POST /api/payments/satim/initiate
// ---------------------------------------------------------------------------
router.post("/satim/initiate", async (req, res, next) => {
  try {
    const data = initiateSchema.parse(req.body);

    const booking = await prisma.booking.findUnique({
      where: { reference: data.reference.toUpperCase() },
      select: {
        id: true,
        reference: true,
        total: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        lang: true,
      },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (booking.paymentStatus === "PAID") {
      return res.status(409).json({
        error: "This booking has already been paid",
        code: "ALREADY_PAID",
      });
    }
    if (!CARD_METHODS.includes(booking.paymentMethod)) {
      return res.status(400).json({
        error: `Booking ${booking.reference} is not a card payment`,
        code: "NOT_A_CARD_BOOKING",
      });
    }
    // PENDING is accepted alongside PENDING_PAYMENT so that bookings created
    // before this feature shipped can still be paid.
    if (!["PENDING_PAYMENT", "PENDING"].includes(booking.status)) {
      return res.status(409).json({
        error: `Cannot start a payment for a booking with status ${booking.status}`,
        code: "BOOKING_NOT_PAYABLE",
      });
    }

    const lang = data.lang || booking.lang || "fr";

    // A fresh Payment row per attempt. SATIM error code 1 is "order with this
    // number has already been processed", so a retry after a declined card
    // must use a new orderNumber — never reuse the previous row.
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amount: booking.total,
        method: booking.paymentMethod,
        status: "PENDING",
        orderNumber: satim.generateOrderNumber(),
      },
    });

    let registered;
    try {
      registered = await satim.registerOrder({
        orderNumber: payment.orderNumber,
        amountDzd: booking.total,
        bookingRef: booking.reference,
        description: `Nzzor ${booking.reference}`,
        lang,
        returnUrl: `${API_BASE_URL}/api/payments/satim/return?p=${payment.id}`,
        failUrl: `${API_BASE_URL}/api/payments/satim/fail?p=${payment.id}`,
      });
    } catch (err) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          gatewayResponse: JSON.stringify({
            stage: "register",
            code: err.code || null,
            message: err.message,
            raw: err.raw || null,
          }).slice(0, 8000),
        },
      }).catch(() => {});
      throw err;
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        gatewayRef: registered.orderId,
        formUrl: registered.formUrl,
        gatewayResponse: registered.raw,
      },
    });

    // Redirect to the EXACT formUrl SATIM returned. Do not rebuild it: their
    // own documentation shows the payment page on a different host
    // (test.satim.dz) from the API host (test2.satim.dz), so any URL we
    // construct ourselves would be guesswork.
    res.json({
      data: {
        formUrl: registered.formUrl,
        paymentId: payment.id,
        reference: booking.reference,
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

// ---------------------------------------------------------------------------
// Redirect helpers
// ---------------------------------------------------------------------------
function webRedirect(res, { reference, status, message, lang }) {
  const params = new URLSearchParams();
  if (reference) params.set("ref", reference);
  params.set("status", status);
  if (message) params.set("msg", String(message).slice(0, 300));
  if (lang) params.set("lang", lang);
  return res.redirect(302, `${WEB_BASE_URL}/booking/result?${params.toString()}`);
}

async function resolvePaymentId(req) {
  if (req.query.p) return String(req.query.p);
  // Fallback: SATIM may append its own order identifier instead.
  const orderId = req.query.orderId || req.query.mdOrder;
  if (!orderId) return null;
  const payment = await prisma.payment.findUnique({
    where: { gatewayRef: String(orderId) },
    select: { id: true },
  });
  return payment ? payment.id : null;
}

// ---------------------------------------------------------------------------
// GET /api/payments/satim/return — customer comes back after a payment attempt
// ---------------------------------------------------------------------------
router.get("/satim/return", async (req, res) => {
  const lang = ["ar", "fr", "en"].includes(req.query.lang) ? req.query.lang : undefined;
  try {
    const paymentId = await resolvePaymentId(req);
    if (!paymentId) {
      return webRedirect(res, { status: "unknown", message: "Payment reference missing", lang });
    }
    const result = await finalizePayment(paymentId, lang);
    return webRedirect(res, {
      reference: result.reference,
      status: result.outcome,
      message: result.message,
      lang,
    });
  } catch (err) {
    // A broken confirm call must never leave the customer on a blank page.
    // The payment stays unsettled and the cron will retry it.
    console.error("[satim] return handler failed:", err.message);
    return webRedirect(res, {
      status: "pending",
      message: "We are still confirming your payment. You will receive an email shortly.",
      lang,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/payments/satim/fail — SATIM's declared failure redirect
// ---------------------------------------------------------------------------
// We still confirm server-side rather than trusting the redirect: this URL is
// as forgeable as the success one, in both directions.
router.get("/satim/fail", async (req, res) => {
  const lang = ["ar", "fr", "en"].includes(req.query.lang) ? req.query.lang : undefined;
  try {
    const paymentId = await resolvePaymentId(req);
    if (!paymentId) {
      return webRedirect(res, { status: "failed", message: "Payment was not completed", lang });
    }
    const result = await finalizePayment(paymentId, lang);
    return webRedirect(res, {
      reference: result.reference,
      status: result.outcome,
      message: result.message,
      lang,
    });
  } catch (err) {
    console.error("[satim] fail handler failed:", err.message);
    return webRedirect(res, { status: "failed", message: "Payment was not completed", lang });
  }
});

// ---------------------------------------------------------------------------
// GET /api/payments/satim/status/:reference — poll a booking's payment state
// ---------------------------------------------------------------------------
// Read-only, for the result page. Does not call SATIM.
router.get("/satim/status/:reference", async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { reference: req.params.reference.toUpperCase() },
      select: { reference: true, status: true, paymentStatus: true, total: true, currency: true },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    res.json({ data: booking });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.CARD_METHODS = CARD_METHODS;
