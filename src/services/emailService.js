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

// =============================================================================
// PASSWORD RESET EMAIL
// -----------------------------------------------------------------------------
// Not a booking email — different template, different audience (user, not
// guest), different urgency. Inlined HTML rather than reusing the booking
// React Email component because the booking template assumes booking data
// shape (reference, hotel, dates) we don't have here.
//
// Subject and body are trilingual via a small inline map. We don't pull
// from emailStrings.js because those keys are booking-shaped — the simpler
// inline map below stays maintainable for the 6 strings we need.
// =============================================================================

const RESET_COPY = {
  en: {
    subject: "Reset your Nzzor password",
    preheader: "We received a request to reset your password.",
    headline: (name) => `Hi ${name || "there"},`,
    body: "We received a request to reset your Nzzor password. Click the button below to choose a new one. This link expires in 1 hour.",
    button: "Set a new password",
    ignored: "If you didn't request this, you can safely ignore this email — your password won't change unless you click the link and choose a new one.",
    signature: "— The Nzzor team",
  },
  fr: {
    subject: "Réinitialisez votre mot de passe Nzzor",
    preheader: "Nous avons reçu une demande de réinitialisation de votre mot de passe.",
    headline: (name) => `Bonjour ${name || ""},`,
    body: "Nous avons reçu une demande de réinitialisation de votre mot de passe Nzzor. Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Ce lien expire dans 1 heure.",
    button: "Choisir un nouveau mot de passe",
    ignored: "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail en toute sécurité — votre mot de passe ne sera pas modifié.",
    signature: "— L'équipe Nzzor",
  },
  ar: {
    subject: "إعادة تعيين كلمة مرور Nzzor الخاصة بك",
    preheader: "تلقينا طلبًا لإعادة تعيين كلمة المرور الخاصة بك.",
    headline: (name) => `مرحبًا ${name || ""}،`,
    body: "تلقينا طلبًا لإعادة تعيين كلمة مرور Nzzor الخاصة بك. انقر على الزر أدناه لاختيار كلمة مرور جديدة. ينتهي هذا الرابط خلال ساعة واحدة.",
    button: "تعيين كلمة مرور جديدة",
    ignored: "إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة بأمان — لن تتغير كلمة المرور الخاصة بك.",
    signature: "— فريق Nzzor",
  },
};

/**
 * Send a password-reset email with a one-hour link.
 *
 * @param {Object} opts
 * @param {string} opts.to         — recipient email
 * @param {string} opts.firstName  — for the greeting; optional
 * @param {string} opts.rawToken   — the un-hashed token (only known here at issue time)
 * @param {string} opts.lang       — recipient's preferred language
 */
async function sendPasswordResetEmail({ to, firstName, rawToken, lang = "fr" }) {
  if (!resend) {
    console.log(`[emailService] (disabled) would send password reset to ${to}`);
    return null;
  }
  const copy = RESET_COPY[lang] || RESET_COPY.fr;
  const url = `${webBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const isRtl = lang === "ar";
  const html = renderResetHtml({ copy, url, firstName, isRtl });
  try {
    const result = await resend.emails.send({
      from: fromAddress,
      to,
      subject: copy.subject,
      html,
      text: `${copy.headline(firstName)}\n\n${copy.body}\n\n${copy.button}: ${url}\n\n${copy.ignored}\n\n${copy.signature}`,
      tags: [
        { name: "category", value: "password_reset" },
        { name: "lang", value: lang },
      ],
    });
    if (result.error) {
      console.error("[emailService] password reset send failed:", result.error);
      return null;
    }
    return result.data?.id || null;
  } catch (err) {
    console.error("[emailService] password reset threw:", err.message);
    return null;
  }
}

// Renders the password-reset email as a minimal HTML doc. Inline styles
// only — most email clients ignore <style> blocks. Width-locked at 560px
// with a max-width fallback for narrow mobile clients.
function renderResetHtml({ copy, url, firstName, isRtl }) {
  const dir = isRtl ? "rtl" : "ltr";
  return `<!doctype html>
<html lang="${isRtl ? "ar" : "en"}" dir="${dir}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>${copy.subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#FAF8F4;font-family:'Helvetica Neue',Arial,sans-serif;color:#16161A;">
    <span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${copy.preheader}</span>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#FAF8F4;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #ececec;">
            <tr>
              <td style="padding:32px 36px 16px;border-bottom:1px solid #f0f0f0;">
                <div style="font-size:13px;font-weight:700;color:#16161A;letter-spacing:0.08em;text-transform:uppercase;">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#E63946;margin-right:10px;vertical-align:middle;"></span>Nzzor
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 36px 8px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.5;font-weight:600;">${copy.headline(firstName)}</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#3a3a40;">${copy.body}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="border-radius:980px;background:#16161A;">
                      <a href="${url}" style="display:inline-block;padding:14px 28px;font-size:14.5px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:980px;">${copy.button}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:28px 0 0;font-size:12.5px;line-height:1.6;color:#8a8a90;">${copy.ignored}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 36px 32px;border-top:1px solid #f0f0f0;color:#8a8a90;font-size:12px;">
                ${copy.signature}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11.5px;color:#a3a3a8;">nzzor.com · Operated by Allouni Travel Agency</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

module.exports = {
  sendBookingCreated,
  sendBookingConfirmed,
  sendBookingPaid,
  sendBookingRejected,
  sendBookingCancelled,
  sendPasswordResetEmail,
};
