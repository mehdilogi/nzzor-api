// =============================================================================
// emailService — Resend wrapper
// -----------------------------------------------------------------------------
// Sends transactional emails for booking lifecycle events. Three entry points:
//
//   sendBookingCreated(booking)    — fires right after booking creation
//   sendBookingConfirmed(booking)  — fires when admin flips status to CONFIRMED
//   sendBookingPaid(booking)       — fires when admin marks payment received
//
// Design decisions worth knowing:
//
// 1. Fire-and-forget. None of these methods throw to the caller. If Resend
//    fails (rate limit, network blip, invalid key, malformed template) we log
//    it and return null. The booking itself is already persisted in Postgres
//    — losing the email is annoying, NOT catastrophic. Don't let email
//    flakiness fail a paying customer's booking.
//
// 2. Graceful degradation when RESEND_API_KEY is missing. In dev environments
//    where the env isn't set up yet, we log "would have sent X to Y" instead
//    of crashing. The booking flow still works end-to-end without email.
//
// 3. Single client. We instantiate Resend once at module load — connection
//    pooling and any internal caching is preserved across requests.
//
// 4. Tags on every send. Resend's tag system lets us slice deliverability in
//    their dashboard. Every email is tagged with `category` and `lang` so we
//    can see at a glance "what % of FR booking-confirmations landed in inbox
//    last week."
// =============================================================================

const { Resend } = require("resend");
const { render } = require("@react-email/render");
const React = require("react");

const BookingEmail = require("./emails/BookingEmail");

// ---- One-time client init --------------------------------------------------
const apiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.EMAIL_FROM || "Nzzor <bookings@nzzor.com>";
const webBaseUrl = process.env.WEB_BASE_URL || "https://nzzor.com";

let resend = null;
if (apiKey) {
  resend = new Resend(apiKey);
} else {
  // We don't throw — we want the API to boot even if email isn't configured
  // yet. Booking creation still works; emails just won't be sent.
  console.warn("[emailService] RESEND_API_KEY not set — email sending disabled");
}

/**
 * Internal helper: render the React Email template to HTML, then send via Resend.
 * Returns the Resend message ID on success, null on failure or when disabled.
 *
 * @param {Object} opts
 * @param {string} opts.variant      — "created" | "confirmed" | "paid"
 * @param {Object} opts.booking      — formatted booking (from formatBooking helper)
 * @param {string} opts.subject      — subject line (already localized)
 * @param {string} opts.lang         — "en" | "fr" | "ar"
 * @returns {Promise<string|null>}
 */
async function renderAndSend({ variant, booking, subject, lang = "fr" }) {
  if (!resend) {
    console.log(`[emailService] (disabled) would send "${variant}" email for ${booking.reference} to ${booking.guest.email}`);
    return null;
  }

  try {
    // Render the React Email component to HTML.
    // We pass plain React.createElement output to the render() function.
    const html = await render(
      React.createElement(BookingEmail, {
        variant,
        booking,
        lang,
        webBaseUrl,
      })
    );

    // Plain-text fallback for clients that don't render HTML. Resend can
    // auto-derive this, but giving it explicitly produces cleaner results.
    const text = buildPlainTextFallback({ variant, booking, lang });

    const result = await resend.emails.send({
      from: fromAddress,
      to: [booking.guest.email],
      subject,
      html,
      text,
      tags: [
        { name: "category", value: `booking_${variant}` },
        { name: "lang", value: lang },
      ],
      // Set Reply-To explicitly so customers can reply to bookings@ even if
      // the From address ever changes.
      replyTo: "bookings@nzzor.com",
    });

    if (result.error) {
      console.error(`[emailService] Resend error for ${variant}/${booking.reference}:`, result.error);
      return null;
    }

    console.log(`[emailService] sent ${variant} for ${booking.reference} → ${booking.guest.email} (id: ${result.data?.id})`);
    return result.data?.id || null;
  } catch (err) {
    // Catch-all — never let an email error propagate to the HTTP response.
    console.error(`[emailService] failed to send ${variant} for ${booking.reference}:`, err);
    return null;
  }
}

/**
 * Plain-text fallback. Some email clients (older Outlook, screen readers,
 * deliverability scanners) prefer text. Mirrors the HTML's information without
 * the visual flourish.
 */
function buildPlainTextFallback({ variant, booking, lang }) {
  const { t } = require("./emailStrings");

  const lines = [
    t(`variant.${variant}.heading`, lang),
    "",
    t(`variant.${variant}.lead`, lang).replace("{firstName}", booking.guest.firstName),
    "",
    `${t("ref.label", lang)}: ${booking.reference}`,
    "",
    `${t("details.title", lang)}`,
    "─".repeat(40),
  ];

  if (booking.hotel) {
    lines.push(`${t("details.hotel", lang)}: ${booking.hotel.name}${booking.hotel.city ? " · " + booking.hotel.city : ""}`);
  }
  lines.push(`${t("details.guest", lang)}: ${booking.guest.firstName} ${booking.guest.lastName}`);
  lines.push(`${t("details.checkin", lang)}: ${formatDate(booking.checkIn, lang)}`);
  lines.push(`${t("details.checkout", lang)}: ${formatDate(booking.checkOut, lang)}`);
  lines.push(`${t("details.nights", lang)}: ${booking.nights}`);
  lines.push(`${t("details.total", lang)}: ${booking.pricing.total} ${booking.pricing.currency}`);
  lines.push("");

  const note = t(`variant.${variant}.note`, lang);
  if (note) {
    lines.push(note);
    lines.push("");
  }

  lines.push(`${t("cta.view", lang)}: ${webBaseUrl}/bookings/${booking.reference}?lang=${lang}`);
  lines.push("");
  lines.push("──────────────");
  lines.push(t("footer.operator", lang));

  return lines.join("\n");
}

function formatDate(dateInput, lang) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";
  const locale = lang === "ar" ? "ar-DZ" : lang === "fr" ? "fr-FR" : "en-GB";
  return d.toLocaleDateString(locale, {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

// ---- Public API ------------------------------------------------------------

/**
 * Send the "booking received" email — fires immediately after a booking is
 * created. The customer hasn't been confirmed-with-hotel yet; this email sets
 * expectations: "we have it, our team confirms by noon tomorrow."
 *
 * @param {Object} booking — formatted booking object
 * @param {string} lang    — "en" | "fr" | "ar"
 * @returns {Promise<string|null>}
 */
async function sendBookingCreated(booking, lang = "fr") {
  const { t } = require("./emailStrings");
  const subject = `${t("variant.created.kicker", lang)} · ${booking.reference}`;
  return renderAndSend({ variant: "created", booking, subject, lang });
}

/**
 * Send the "booking confirmed" email — fires when the Allouni team flips the
 * booking status from PENDING → CONFIRMED, meaning they've talked to the
 * hotel and locked in the room.
 *
 * @param {Object} booking — formatted booking object
 * @param {string} lang    — "en" | "fr" | "ar"
 * @returns {Promise<string|null>}
 */
async function sendBookingConfirmed(booking, lang = "fr") {
  const { t } = require("./emailStrings");
  const subject = `${t("variant.confirmed.kicker", lang)} · ${booking.reference}`;
  return renderAndSend({ variant: "confirmed", booking, subject, lang });
}

/**
 * Send the "payment received" email — fires when the Allouni team marks
 * payment as received (cash on arrival counted, bank transfer cleared, CIB
 * charge captured, etc.).
 *
 * @param {Object} booking — formatted booking object
 * @param {string} lang    — "en" | "fr" | "ar"
 * @returns {Promise<string|null>}
 */
async function sendBookingPaid(booking, lang = "fr") {
  const { t } = require("./emailStrings");
  const subject = `${t("variant.paid.kicker", lang)} · ${booking.reference}`;
  return renderAndSend({ variant: "paid", booking, subject, lang });
}

/**
 * Send the "booking rejected" email — fires when the hotel partner refuses
 * to honor a booking (room no longer available, dates clash, etc.). Customer
 * didn't choose this, so tone is apologetic and refund-forward.
 *
 * @param {Object} booking — formatted booking object
 * @param {string} lang    — "en" | "fr" | "ar"
 * @returns {Promise<string|null>}
 */
async function sendBookingRejected(booking, lang = "fr") {
  const { t } = require("./emailStrings");
  const subject = `${t("variant.rejected.kicker", lang)} · ${booking.reference}`;
  return renderAndSend({ variant: "rejected", booking, subject, lang });
}

/**
 * Send the "booking cancelled" email — fires when a booking is cancelled by
 * the customer themselves, by admin, or by a system process. Neutral on who
 * initiated; covers refund-timing expectations.
 *
 * @param {Object} booking — formatted booking object
 * @param {string} lang    — "en" | "fr" | "ar"
 * @returns {Promise<string|null>}
 */
async function sendBookingCancelled(booking, lang = "fr") {
  const { t } = require("./emailStrings");
  const subject = `${t("variant.cancelled.kicker", lang)} · ${booking.reference}`;
  return renderAndSend({ variant: "cancelled", booking, subject, lang });
}

module.exports = {
  sendBookingCreated,
  sendBookingConfirmed,
  sendBookingPaid,
  sendBookingRejected,
  sendBookingCancelled,
};
