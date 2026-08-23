// =============================================================================
// satimService — SATIM-EPG (CIB WEB) payment gateway client
// -----------------------------------------------------------------------------
// Built against the SATIM-EPG spec published on the certification lab portal
// (TESTS DE CERTIFICATION -> Principale), slot 20/08/2026 - 14/09/2026.
//
// Three endpoints:
//   register.do                    -> create an order, get a hosted payment URL
//   public/acknowledgeTransaction  -> confirm the result of an order
//   refund.do                      -> refund a deposited order
//
// CRITICAL BEHAVIOURS ENCODED HERE
// --------------------------------
// 1. AMOUNTS ARE IN CENTIMES. SATIM: "the minimum amount is 50 DA, order amount
//    must be multiple by 100 — 5000 DA => amount=500000". Booking.total is an
//    Int in whole DZD, so we multiply by 100 exactly once, here, and nowhere
//    else. Never pass an already-multiplied amount into these functions.
//
// 2. orderNumber IS CAPPED AT 10 CHARACTERS (AN..10). Our booking reference
//    (NZR-XXXX-XXXX) is 13 and will NOT fit. We therefore generate a separate
//    short order number and carry the human reference in udf1, which SATIM
//    echoes back in the confirm response and shows in bank registers.
//
// 3. CONFIRMATION IS HOW YOU KEEP THE MONEY. From the spec: "Si aucune demande
//    de confirmation n'est reçue par la passerelle de paiement, elle sera
//    automatiquement annulée après un certain délai." A payment that is never
//    acknowledged is reversed. jobs/reconcilePayments.js exists for exactly
//    this reason — the browser redirect is not a reliable trigger.
//
// 4. SUCCESS IS A TWO-FIELD TEST. errorCode reports whether the *request*
//    worked; OrderStatus reports whether the *payment* worked. They are
//    independent and both must be checked. See isPaidResult().
//
// 5. SATIM'S OWN CASING IS INCONSISTENT. register.do returns lowercase
//    `errorCode`; acknowledgeTransaction.do returns capitalised `ErrorCode`.
//    Their register example sends language=en, their acknowledge example sends
//    language=EN. We normalise reads (pick() below) and send each endpoint the
//    casing from its own documented example. If certification rejects either,
//    SATIM_LANG_UPPERCASE flips it without a code change.
//
// 6. POST, NOT GET. The spec documents GET but explicitly recommends POST for
//    all API requests so credentials never land in URLs, proxy logs or browser
//    history. We only ever POST.
// =============================================================================

const BASE_URL = (process.env.SATIM_BASE_URL || "https://test2.satim.dz/payment/rest")
  .replace(/\/+$/, "");
const USERNAME = process.env.SATIM_USERNAME || "";
const PASSWORD = process.env.SATIM_PASSWORD || "";
const TERMINAL_ID = process.env.SATIM_TERMINAL_ID || "";
const CURRENCY_DZD = "012"; // ISO 4217 numeric, per spec
const TIMEOUT_MS = Number(process.env.SATIM_TIMEOUT_MS || 25000);

// See note 5. Default follows each endpoint's own documented example.
const LANG_UPPER = process.env.SATIM_LANG_UPPERCASE === "true";

class SatimError extends Error {
  constructor(message, { code = null, stage = null, raw = null } = {}) {
    super(message);
    this.name = "SatimError";
    this.code = code;
    this.stage = stage;
    this.raw = raw;
    this.status = 502; // upstream gateway problem, not the caller's fault
  }
}

function assertConfigured() {
  const missing = [];
  if (!USERNAME) missing.push("SATIM_USERNAME");
  if (!PASSWORD) missing.push("SATIM_PASSWORD");
  if (!TERMINAL_ID) missing.push("SATIM_TERMINAL_ID");
  if (missing.length) {
    throw new SatimError(
      `SATIM is not configured — missing env: ${missing.join(", ")}`,
      { code: "SATIM_NOT_CONFIGURED", stage: "config" }
    );
  }
}

// SATIM returns errorCode / ErrorCode, ErrorMessage / errorMessage etc.
// depending on the endpoint. Read whichever is present.
function pick(obj, ...names) {
  for (const n of names) {
    if (obj && obj[n] !== undefined && obj[n] !== null) return obj[n];
  }
  return undefined;
}

function normLang(lang) {
  const l = String(lang || "fr").slice(0, 2).toLowerCase();
  const ok = ["ar", "fr", "en"].includes(l) ? l : "fr";
  return LANG_UPPER ? ok.toUpperCase() : ok;
}

// ---------------------------------------------------------------------------
// Order number generation
// ---------------------------------------------------------------------------
// AN..10. base36 of the epoch is 8 characters and stays 8 until 2059; two
// random base36 characters bring it to exactly 10 and make collisions between
// two requests inside the same millisecond effectively impossible. The column
// is @unique as a hard backstop — a collision surfaces as P2002 at insert time,
// never as a silently reused order number.
//
// Uniqueness must be PER ATTEMPT, not per booking: SATIM error code 1 is
// "Order with given order number has already been processed", so a guest
// retrying a failed payment needs a fresh number. Each Payment row gets its own.
const B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function generateOrderNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  let salt = "";
  for (let i = 0; i < 2; i++) salt += B36[Math.floor(Math.random() * 36)];
  return (stamp + salt).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
async function post(path, params, stage) {
  const url = `${BASE_URL}${path}`;
  const body = new URLSearchParams(params).toString();

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Network-level failure. On Railway US-East this is also what an
    // Algerian geo-restriction or IP whitelist rejection looks like, so the
    // message deliberately names that possibility for whoever reads the log.
    throw new SatimError(
      `Could not reach SATIM (${stage}): ${err.message}. If this persists from ` +
      `production, check whether SATIM requires the server's egress IP to be ` +
      `whitelisted — Railway runs in US-East.`,
      { code: "SATIM_UNREACHABLE", stage }
    );
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SatimError(
      `SATIM returned a non-JSON response (${stage}, HTTP ${res.status})`,
      { code: "SATIM_BAD_RESPONSE", stage, raw: text.slice(0, 2000) }
    );
  }
  return { json, raw: text.slice(0, 8000) };
}

// Never let credentials reach a log line or a DB column.
function redact(obj) {
  const out = { ...obj };
  if (out.password) out.password = "***";
  if (out.userName) out.userName = "***";
  return out;
}

// ---------------------------------------------------------------------------
// register.do — create the order, get the hosted payment page URL
// ---------------------------------------------------------------------------
// amountDzd: whole dinars (Booking.total). Multiplied by 100 here, once.
async function registerOrder({
  orderNumber,
  amountDzd,
  returnUrl,
  failUrl,
  bookingRef,
  description,
  lang,
}) {
  assertConfigured();

  if (!Number.isInteger(amountDzd) || amountDzd < 50) {
    throw new SatimError(
      `Amount must be a whole number of dinars and at least 50 DA (got ${amountDzd})`,
      { code: "SATIM_AMOUNT_INVALID", stage: "register" }
    );
  }
  if (String(orderNumber).length > 10) {
    throw new SatimError(
      `orderNumber exceeds SATIM's 10-character limit: ${orderNumber}`,
      { code: "SATIM_ORDER_NUMBER_TOO_LONG", stage: "register" }
    );
  }

  const params = {
    userName: USERNAME,
    password: PASSWORD,
    orderNumber: String(orderNumber),
    amount: String(amountDzd * 100), // note 1
    currency: CURRENCY_DZD,
    returnUrl,
    failUrl,
    language: normLang(lang),
    // jsonParams is mandatory. force_terminal_id and udf1 are both mandatory
    // inside it. udf1 carries our human booking reference (note 2) so the
    // booking is traceable in SATIM's registers and in the confirm response.
    jsonParams: JSON.stringify({
      force_terminal_id: TERMINAL_ID,
      udf1: String(bookingRef || "").slice(0, 20),
    }),
  };
  if (description) params.description = String(description).slice(0, 512);

  const { json, raw } = await post("/register.do", params, "register");

  const errorCode = String(pick(json, "errorCode", "ErrorCode") ?? "");
  const errorMessage = pick(json, "errorMessage", "ErrorMessage") || null;
  const orderId = pick(json, "orderId", "OrderId") || null;
  const formUrl = pick(json, "formUrl", "FormUrl") || null;

  // Per spec: orderId and formUrl are absent when registration failed, and the
  // reason is in errorCode. Treat a missing formUrl as failure even if
  // errorCode looks clean — we must never redirect a customer to nowhere.
  if (errorCode !== "0" || !formUrl || !orderId) {
    throw new SatimError(
      errorMessage || `SATIM refused the order registration (errorCode ${errorCode})`,
      { code: `SATIM_REGISTER_${errorCode || "UNKNOWN"}`, stage: "register", raw }
    );
  }

  return {
    orderId,        // == mdOrder, needed for confirm and refund
    formUrl,        // redirect the customer to this EXACT string (see below)
    errorCode,
    raw,
    sent: redact(params),
  };
}

// ---------------------------------------------------------------------------
// acknowledgeTransaction.do — confirm the outcome, server to server
// ---------------------------------------------------------------------------
// NEVER decide "paid" from the browser redirect. The customer controls that
// request; only this call is authoritative. It is also what stops SATIM from
// auto-cancelling the payment (note 3).
async function confirmOrder({ orderId, lang }) {
  assertConfigured();
  if (!orderId) {
    throw new SatimError("confirmOrder called without an orderId", {
      code: "SATIM_MISSING_ORDER_ID",
      stage: "confirm",
    });
  }

  const params = {
    userName: USERNAME,
    password: PASSWORD,
    mdOrder: String(orderId),
    // Their acknowledge example sends uppercase; register sends lowercase.
    language: String(normLang(lang)).toUpperCase(),
  };

  const { json, raw } = await post(
    "/public/acknowledgeTransaction.do",
    params,
    "confirm"
  );

  const errorCode = String(pick(json, "ErrorCode", "errorCode") ?? "");
  const errorMessage = pick(json, "ErrorMessage", "errorMessage") || null;

  const rawStatus = pick(json, "OrderStatus", "orderStatus");
  const orderStatus = rawStatus === undefined ? null : Number(rawStatus);

  return {
    errorCode,
    errorMessage,
    orderStatus,
    // OrderStatus 1 = approved (one-phase) / preauth held, 2 = deposited.
    // Anything else (0 registered-unpaid, 3 reversed, 4 refunded,
    // 6 declined, -1 catch-all decline) is NOT money in the account.
    paid: isPaidResult(errorCode, orderStatus),
    orderNumber: pick(json, "OrderNumber", "orderNumber") || null,
    amount: pick(json, "Amount", "amount") ?? null, // centimes
    pan: pick(json, "Pan", "pan") || null,          // already masked by SATIM
    approvalCode: pick(json, "approvalCode", "authorizationResponseId") || null,
    actionCode: pick(json, "actionCode", "ActionCode") ?? null,
    actionCodeDescription:
      pick(json, "actionCodeDescription", "ActionCodeDescription") || null,
    udf1: json && json.params ? json.params.udf1 || null : null,
    respCode: json && json.params ? json.params.respCode || null : null,
    // SATIM's checklist names this field explicitly: the return page must show
    // respCode_desc, and fall back to actionCodeDescription when it is empty.
    respCodeDesc: json && json.params ? json.params.respCode_desc || null : null,
    raw,
  };
}

function isPaidResult(errorCode, orderStatus) {
  return String(errorCode) === "0" && (orderStatus === 1 || orderStatus === 2);
}

// A customer-safe sentence for a failed payment. SATIM's own
// actionCodeDescription is already localised to the language we sent, so we
// prefer it and fall back to something generic rather than leaking codes.
function describeFailure(result, fallback) {
  if (result && result.actionCodeDescription) return result.actionCodeDescription;
  if (result && result.errorMessage) return result.errorMessage;
  return fallback || "The payment was not completed.";
}

// ---------------------------------------------------------------------------
// refund.do
// ---------------------------------------------------------------------------
// Partial and repeated refunds are allowed up to the deposited total. Errors if
// the customer was never charged. amountDzd is whole dinars, multiplied here.
async function refundOrder({ orderId, amountDzd }) {
  assertConfigured();
  if (!orderId) {
    throw new SatimError("refundOrder called without an orderId", {
      code: "SATIM_MISSING_ORDER_ID",
      stage: "refund",
    });
  }
  if (!Number.isInteger(amountDzd) || amountDzd <= 0) {
    throw new SatimError(`Refund amount must be a positive whole number of dinars (got ${amountDzd})`, {
      code: "SATIM_AMOUNT_INVALID",
      stage: "refund",
    });
  }

  const params = {
    userName: USERNAME,
    password: PASSWORD,
    orderId: String(orderId),
    amount: String(amountDzd * 100),
    currency: CURRENCY_DZD,
  };

  const { json, raw } = await post("/refund.do", params, "refund");
  const errorCode = String(pick(json, "errorCode", "ErrorCode") ?? "");
  const errorMessage = pick(json, "errorMessage", "ErrorMessage") || null;

  if (errorCode !== "0") {
    throw new SatimError(errorMessage || `SATIM refused the refund (errorCode ${errorCode})`, {
      code: `SATIM_REFUND_${errorCode || "UNKNOWN"}`,
      stage: "refund",
      raw,
    });
  }
  return { errorCode, errorMessage, raw };
}

function isConfigured() {
  return Boolean(USERNAME && PASSWORD && TERMINAL_ID);
}

module.exports = {
  registerOrder,
  confirmOrder,
  refundOrder,
  generateOrderNumber,
  isPaidResult,
  describeFailure,
  isConfigured,
  SatimError,
  CURRENCY_DZD,
  BASE_URL,
};
