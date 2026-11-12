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

// Voucher PDF generator. Used to attach the booking voucher to confirmed
// and paid emails. Lazy-loaded inside renderAndSend so a missing font
// asset (or any voucher-service error) NEVER blocks the email itself —
// the email body has all the info; the PDF is convenience.
const { generateVoucherPdf } = require("./voucherService");

// Payment receipt PDF. Separate from the voucher: the voucher is a travel
// document, the receipt is a financial one. See services/receiptService.js.
const { generateReceiptPdf } = require("./receiptService");

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
async function renderAndSend({ variant, booking, subject, lang = "fr", attachVoucher = false }) {
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

    // Voucher PDF attachment. Generated only for variants where the customer
    // benefits from a downloadable artifact (confirmed, paid). Wrapped in
    // try/catch so a PDF rendering error NEVER blocks the email body — the
    // email body has all the info; the PDF is convenience.
    let attachments;
    if (attachVoucher) {
      try {
        const pdf = await generateVoucherPdf(booking, lang);
        attachments = [{
          filename: `nzzor-${booking.reference}.pdf`,
          content: pdf, // Buffer — Resend accepts Buffer directly
        }];
      } catch (voucherErr) {
        console.error(
          `[emailService] voucher generation failed for ${variant}/${booking.reference}:`,
          voucherErr.message
        );
        // Continue sending the email without the attachment.
      }
    }

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
      // Only include `attachments` when we actually have one — Resend's
      // SDK treats empty arrays the same as omitted, but cleaner not to
      // send the key at all when there's nothing to attach.
      ...(attachments ? { attachments } : {}),
    });

    if (result.error) {
      console.error(`[emailService] Resend error for ${variant}/${booking.reference}:`, result.error);
      return null;
    }

    console.log(
      `[emailService] sent ${variant} for ${booking.reference} → ${booking.guest.email}` +
      (attachments ? " (with voucher.pdf)" : "") +
      ` (id: ${result.data?.id})`
    );
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
    // Check-in and check-out are calendar dates stored at midnight UTC, so UTC
    // is the anchor that reproduces them — matching voucherService.formatDate.
    // Without this the runtime's own zone is used, which is right only because
    // Railway happens to run UTC: on any negative-offset zone, midnight UTC
    // formats as the previous day and every stay in every email shifts back
    // twenty-four hours. Not the one-hour offset SATIM reported on the receipt
    // — that was a timestamp, this is a date — but the same class of fault.
    timeZone: "UTC",
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
  // attachVoucher=true: once the booking is CONFIRMED the customer has
  // something tangible to bring to check-in.
  return renderAndSend({ variant: "confirmed", booking, subject, lang, attachVoucher: true });
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
  // attachVoucher=true: payment receipts are kept by customers for travel
  // reimbursement / employer expense claims — they want the PDF.
  return renderAndSend({ variant: "paid", booking, subject, lang, attachVoucher: true });
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

// ---------------------------------------------------------------------------
// sendPaymentReceipt — email the receipt to an arbitrary address
// ---------------------------------------------------------------------------
// Required by SATIM's cahier de recette: "L'envoi du reçu de paiement par mail
// a une adresse tierce en format PDF."
//
// Note the recipient is NOT booking.guest.email — the whole point is that it
// can go to a third party (an employer, an accountant). The calling route is
// responsible for rate limiting and for confirming the payment is actually
// PAID before offering this.
//
// Unlike the booking emails this one is NOT fire-and-forget: the customer is
// watching a spinner and expects to be told whether it worked, so it returns a
// boolean rather than swallowing failures.
//
// @param {Object}  opts
// @param {string}  opts.to       destination address
// @param {Object}  opts.receipt  payload from the receipt endpoint
// @param {string}  opts.lang     "en" | "fr" | "ar"
// @returns {Promise<boolean>}
async function sendPaymentReceipt({ to, receipt, lang = "fr" }) {
  if (!resend) {
    console.log(`[emailService] (disabled) would send receipt for ${receipt.reference} to ${to}`);
    return false;
  }

  const isRtl = lang === "ar";
  const subject =
    lang === "en"
      ? `Payment receipt — Nzzor ${receipt.reference}`
      : lang === "ar"
      ? `إيصال الدفع — نزور ${receipt.reference}`
      : `Reçu de paiement — Nzzor ${receipt.reference}`;

  const L = {
    en: { intro: "Your payment receipt is attached as a PDF.", ref: "Booking reference", amount: "Amount paid", help: "Payment problem? Call SATIM free on 3020." },
    fr: { intro: "Votre reçu de paiement est joint au format PDF.", ref: "Référence de réservation", amount: "Montant payé", help: "Problème de paiement ? Appelez gratuitement la SATIM au 3020." },
    ar: { intro: "إيصال الدفع الخاص بك مرفق بصيغة PDF.", ref: "رقم الحجز", amount: "المبلغ المدفوع", help: "مشكلة في الدفع؟ اتصل مجاناً بساتيم على 3020." },
  }[lang] || null;
  const copy = L || { intro: "Votre reçu de paiement est joint au format PDF.", ref: "Référence", amount: "Montant payé", help: "" };

  try {
    let attachments;
    try {
      const pdf = await generateReceiptPdf(receipt, lang);
      attachments = [{ filename: `nzzor-receipt-${receipt.reference}.pdf`, content: pdf }];
    } catch (pdfErr) {
      // The PDF *is* the deliverable here, unlike the voucher on a booking
      // email. Without it there is nothing worth sending, so fail honestly
      // rather than delivering an empty-handed message.
      console.error(`[emailService] receipt PDF failed for ${receipt.reference}:`, pdfErr.message);
      return false;
    }

    const html = `<!doctype html><html dir="${isRtl ? "rtl" : "ltr"}"><body style="margin:0;padding:32px;background:#FAF8F4;font-family:Arial,Helvetica,sans-serif;color:#16161A">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px">
<div style="font-size:18px;font-weight:bold;margin-bottom:4px">Nzzor</div>
<div style="font-size:12px;color:#6B6B75;margin-bottom:20px">Allouni Travel Agency</div>
<p style="font-size:14px;line-height:1.6;margin:0 0 18px">${copy.intro}</p>
<div style="border:1px dashed #E5E2DC;border-radius:10px;padding:12px 16px;margin-bottom:18px">
<div style="font-size:11px;color:#6B6B75;text-transform:uppercase;letter-spacing:.06em">${copy.ref}</div>
<div style="font-size:17px;font-weight:bold;letter-spacing:.04em">${receipt.reference}</div>
</div>
<div style="font-size:14px;margin-bottom:18px"><strong>${copy.amount}:</strong> ${receipt.amount} ${receipt.currency || "DZD"}</div>
<div style="font-size:12px;color:#6B6B75;border-top:1px solid #E5E2DC;padding-top:14px">${copy.help}</div>
</div></body></html>`;

    const result = await resend.emails.send({
      from: fromAddress,
      to: [to],
      subject,
      html,
      text: `${copy.intro}\n${copy.ref}: ${receipt.reference}\n${copy.amount}: ${receipt.amount} ${receipt.currency || "DZD"}\n${copy.help}`,
      tags: [{ name: "category", value: "payment_receipt" }, { name: "lang", value: lang }],
      replyTo: "bookings@nzzor.com",
      attachments,
    });

    if (result.error) {
      console.error(`[emailService] Resend error for receipt/${receipt.reference}:`, result.error);
      return false;
    }
    console.log(`[emailService] sent receipt for ${receipt.reference} → ${to} (id: ${result.data?.id})`);
    return true;
  } catch (err) {
    console.error(`[emailService] failed to send receipt for ${receipt.reference}:`, err);
    return false;
  }
}

// =============================================================================
// Hotel notification — "you have a new confirmed booking"
// -----------------------------------------------------------------------------
// Sent to the hotel's contact email (Hotel.contactEmail) the moment a booking
// becomes CONFIRMED, with the agency copied so Allouni always sees what the
// hotel saw. French: it is the working language of Algerian hotel front desks.
//
// Takes the RAW Prisma booking (with hotel and rooms.room included), not the
// formatted one, because the hotel needs fields the customer view hides:
// guest phone, special requests, payment state.
//
// If the hotel has no contact email the agency still receives it, with a line
// saying the hotel was not reached, so nobody assumes the hotel knows.
// =============================================================================
const AGENCY_EMAIL = process.env.AGENCY_EMAIL || "contact@nzzor.com";

const BOARD_FR = {
  ROOM_ONLY: "Chambre seule",
  BREAKFAST: "Petit-déjeuner inclus",
  HALF_BOARD: "Demi-pension",
  FULL_BOARD: "Pension complète",
  ALL_INCLUSIVE: "Tout compris",
};
const PAY_FR = {
  PAID: "Payée en ligne (CIB / Edahabia via SATIM)",
  PENDING: "Non payée",
  FAILED: "Paiement échoué",
  REFUNDED: "Remboursée",
  PARTIALLY_REFUNDED: "Partiellement remboursée",
};

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function dzd(n) {
  return new Intl.NumberFormat("fr-FR").format(Number(n) || 0).replace(/ | /g, " ") + " DA";
}
function dateFr(d) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(d));
}

async function sendHotelNotification(raw) {
  const hotelEmail = raw.hotel && raw.hotel.contactEmail ? raw.hotel.contactEmail.trim() : "";
  const to = hotelEmail ? [hotelEmail] : [AGENCY_EMAIL];
  const cc = hotelEmail ? [AGENCY_EMAIL] : undefined;
  const hotelName = (raw.hotel && (raw.hotel.nameFr || raw.hotel.nameEn)) || "";

  if (!resend) {
    console.log(`[emailService] (disabled) would send hotel notification for ${raw.reference} to ${to.join(", ")}`);
    return null;
  }

  const roomsRows = (raw.rooms || []).map((br) => {
    const name = (br.room && (br.room.typeFr || br.room.typeEn)) || "Chambre";
    const board = BOARD_FR[br.board || "ROOM_ONLY"] || br.board || "";
    return `<tr><td style="padding:6px 0">${esc(br.quantity)} × ${esc(name)}</td><td style="padding:6px 0;text-align:right;color:#555">${esc(board)} · ${esc(dzd(br.pricePerNight))} / nuit</td></tr>`;
  }).join("");

  const row = (label, value) =>
    `<tr><td style="padding:7px 0;color:#777;width:170px">${esc(label)}</td><td style="padding:7px 0;font-weight:600">${value}</td></tr>`;

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f3ef;font-family:Arial,Helvetica,sans-serif;color:#16161a">
<div style="max-width:600px;margin:0 auto;padding:28px 16px">
  <div style="background:#fff;border-radius:14px;padding:28px">
    <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#E63946">Nouvelle réservation confirmée</div>
    <h1 style="font-size:24px;margin:10px 0 4px">${esc(raw.reference)}</h1>
    <div style="color:#555;margin-bottom:20px">${esc(hotelName)}</div>
    ${hotelEmail ? "" : `<div style="background:#fdecee;color:#a3202c;padding:12px 14px;border-radius:8px;margin-bottom:18px;font-size:14px"><b>Cet hôtel n'a pas d'adresse e-mail dans l'admin.</b> Il n'a pas reçu ce message : prévenez-le par téléphone ou WhatsApp.</div>`}
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${row("Client", esc(`${raw.guestFirstName || ""} ${raw.guestLastName || ""}`.trim()))}
      ${row("Téléphone", esc(raw.guestPhone))}
      ${row("E-mail", esc(raw.guestEmail))}
      ${row("Arrivée", esc(dateFr(raw.checkIn)))}
      ${row("Départ", esc(dateFr(raw.checkOut)))}
      ${row("Nuits", esc(raw.nights))}
    </table>
    <div style="border-top:1px solid #eee;margin:16px 0"></div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${roomsRows}</table>
    <div style="border-top:1px solid #eee;margin:16px 0"></div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${row("Total", esc(dzd(raw.total)))}
      ${row("Paiement", esc(PAY_FR[raw.paymentStatus] || raw.paymentStatus || ""))}
      ${raw.specialRequests ? row("Demandes du client", esc(raw.specialRequests)) : ""}
    </table>
    <p style="font-size:13px;color:#777;line-height:1.6;margin:22px 0 0">Merci de préparer la chambre pour l'arrivée du client. Pour toute question, répondez à cet e-mail ou contactez Allouni Travel Agency au 0770 08 08 30.</p>
  </div>
  <div style="text-align:center;font-size:12px;color:#999;margin-top:14px">Nzzor · Allouni Travel Agency · Sétif</div>
</div></body></html>`;

  const text = [
    `Nouvelle réservation confirmée — ${raw.reference}`,
    hotelName,
    hotelEmail ? "" : "ATTENTION : cet hôtel n'a pas d'e-mail dans l'admin, il n'a pas reçu ce message.",
    `Client : ${raw.guestFirstName || ""} ${raw.guestLastName || ""} · ${raw.guestPhone || ""} · ${raw.guestEmail || ""}`,
    `Arrivée : ${dateFr(raw.checkIn)} · Départ : ${dateFr(raw.checkOut)} · ${raw.nights} nuit(s)`,
    ...(raw.rooms || []).map((br) => `${br.quantity} × ${(br.room && (br.room.typeFr || br.room.typeEn)) || "Chambre"} — ${BOARD_FR[br.board || "ROOM_ONLY"] || ""}`),
    `Total : ${dzd(raw.total)} · ${PAY_FR[raw.paymentStatus] || raw.paymentStatus || ""}`,
    raw.specialRequests ? `Demandes : ${raw.specialRequests}` : "",
  ].filter(Boolean).join("\n");

  try {
    const result = await resend.emails.send({
      from: fromAddress,
      to,
      ...(cc ? { cc } : {}),
      subject: `Nouvelle réservation ${raw.reference} · ${hotelName} · ${dateFr(raw.checkIn)}`,
      html,
      text,
      replyTo: "bookings@nzzor.com",
      tags: [{ name: "category", value: "hotel_notification" }],
    });
    if (result.error) {
      console.error(`[emailService] Resend error for hotel notification ${raw.reference}:`, result.error);
      return null;
    }
    console.log(`[emailService] sent hotel notification for ${raw.reference} → ${to.join(", ")}${cc ? " (cc " + cc.join(", ") + ")" : ""} (id: ${result.data?.id})`);
    return result.data?.id || null;
  } catch (err) {
    console.error(`[emailService] failed to send hotel notification for ${raw.reference}:`, err);
    return null;
  }
}

// =============================================================================
// Payment recovery — "your payment didn't go through, finish it here"
// -----------------------------------------------------------------------------
// Sent once, on a booking's first failed card attempt (see paymentService).
// Most failures are not refusals: the customer did not have the card at hand,
// the SMS code did not arrive, the session timed out. A link that reopens the
// SAME booking recovers them without a call.
// =============================================================================
const RECOVERY_COPY = {
  fr: {
    subject: (ref) => `Finalisez votre réservation · ${ref}`,
    preheader: "Votre paiement n'a pas abouti. Aucun montant n'a été débité.",
    hello: (n) => `Bonjour${n ? " " + n : ""},`,
    body: "Le paiement de votre réservation n'a pas abouti et aucun montant n'a été débité de votre carte. Votre réservation est enregistrée : vous pouvez finaliser le paiement en un clic, avec la même carte ou une autre.",
    hotel: "Hôtel", arrival: "Arrivée", departure: "Départ", nights: "Nuits", total: "Total", ref: "Référence",
    button: "Finaliser mon paiement",
    hold: "La chambre n'est garantie qu'une fois le paiement validé.",
    tip: "Paiement bloqué ? Votre carte CIB ou EDAHABIA doit être activée pour le paiement en ligne (auprès de votre banque ou d'Algérie Poste), et gardez votre téléphone à portée de main pour le code SMS.",
    help: "Besoin d'aide ? Répondez à cet e-mail ou appelez-nous au 0770 08 08 30.",
    signature: "L'équipe Nzzor",
  },
  en: {
    subject: (ref) => `Complete your booking · ${ref}`,
    preheader: "Your payment did not go through. Your card was not charged.",
    hello: (n) => `Hello${n ? " " + n : ""},`,
    body: "The payment for your booking did not go through and your card was not charged. Your booking is saved: you can complete the payment in one click, with the same card or another one.",
    hotel: "Hotel", arrival: "Check-in", departure: "Check-out", nights: "Nights", total: "Total", ref: "Reference",
    button: "Complete my payment",
    hold: "The room is only guaranteed once the payment goes through.",
    tip: "Payment blocked? Your CIB or EDAHABIA card must be enabled for online payment (at your bank or Algérie Poste), and keep your phone nearby for the SMS code.",
    help: "Need help? Reply to this email or call us on 0770 08 08 30.",
    signature: "The Nzzor team",
  },
  ar: {
    subject: (ref) => `أكملوا حجزكم · ${ref}`,
    preheader: "لم تكتمل عملية الدفع، ولم يُقتطع أي مبلغ من بطاقتكم.",
    hello: (n) => `مرحباً${n ? " " + n : ""}،`,
    body: "لم تكتمل عملية الدفع الخاصة بحجزكم، ولم يُقتطع أي مبلغ من بطاقتكم. حجزكم مسجّل لدينا، ويمكنكم إتمام الدفع بنقرة واحدة، بنفس البطاقة أو ببطاقة أخرى.",
    hotel: "الفندق", arrival: "الوصول", departure: "المغادرة", nights: "الليالي", total: "المبلغ الإجمالي", ref: "رقم الحجز",
    button: "إتمام الدفع",
    hold: "لا تُضمن الغرفة إلا بعد تأكيد الدفع.",
    tip: "تعذّر الدفع؟ يجب أن تكون بطاقة CIB أو الذهبية مفعّلة للدفع عبر الإنترنت (لدى بنككم أو بريد الجزائر)، واحتفظوا بهاتفكم بالقرب منكم لاستلام رمز SMS.",
    help: "تحتاجون مساعدة؟ ردّوا على هذا البريد أو اتصلوا بنا على 0770 08 08 30.",
    signature: "فريق نزور",
  },
};

async function sendPaymentRecovery(b, lang = "fr") {
  const L = RECOVERY_COPY[lang] ? lang : "fr";
  const c = RECOVERY_COPY[L];
  const rtl = L === "ar";
  const to = b.guestEmail;
  if (!resend) {
    console.log(`[emailService] (disabled) would send payment recovery for ${b.reference} to ${to}`);
    return null;
  }
  const h = b.hotel || {};
  const hotelName = (L === "ar" && h.nameAr) || (L === "en" && h.nameEn) || h.nameFr || h.nameEn || h.nameAr || "";
  const url = `${webBaseUrl}/pay/${encodeURIComponent(b.reference)}?lang=${L}`;
  const date = (d) => formatDate(d, L);
  const amount = `${new Intl.NumberFormat("fr-FR").format(Number(b.total) || 0).replace(/[\u202f\u00a0]/g, " ")} ${L === "ar" ? "دج" : "DA"}`;
  const align = rtl ? "right" : "left";
  const row = (k, v) =>
    `<tr><td style="padding:7px 0;color:#77777f;text-align:${align}">${esc(k)}</td><td style="padding:7px 0;font-weight:700;text-align:${rtl ? "left" : "right"}">${v}</td></tr>`;

  const html = `<!doctype html><html lang="${L}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(c.subject(b.reference))}</title></head>
<body style="margin:0;padding:0;background:#FAF8F4;font-family:'Helvetica Neue',Arial,Tahoma,sans-serif;color:#16161A">
<span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${esc(c.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FAF8F4"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" dir="${rtl ? "rtl" : "ltr"}" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #ececec;text-align:${align}">
<tr><td style="padding:28px 36px 14px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">
<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#E63946;vertical-align:middle;margin-${rtl ? "left" : "right"}:10px"></span>Nzzor</td></tr>
<tr><td style="padding:28px 36px 6px">
<p style="margin:0 0 14px;font-size:16px;font-weight:600">${esc(c.hello(b.guestFirstName))}</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.75;color:#3a3a40">${esc(c.body)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px;border-top:1px solid #f0f0f0;border-bottom:1px solid #f0f0f0;margin-bottom:24px">
${row(c.ref, `<span dir="ltr">${esc(b.reference)}</span>`)}
${hotelName ? row(c.hotel, esc(hotelName)) : ""}
${row(c.arrival, esc(date(b.checkIn)))}
${row(c.departure, esc(date(b.checkOut)))}
${row(c.nights, esc(b.nights))}
${row(c.total, esc(amount))}
</table>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="${rtl ? "right" : "left"}"><tr><td style="border-radius:980px;background:#16161A">
<a href="${url}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:980px">${esc(c.button)}</a>
</td></tr></table>
<div style="clear:both"></div>
<p style="margin:18px 0 0;font-size:13px;color:#B4801A;font-weight:600">${esc(c.hold)}</p>
<p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:#77777f">${esc(c.tip)}</p>
<p style="margin:12px 0 0;font-size:13px;line-height:1.7;color:#77777f">${esc(c.help).replace("0770 08 08 30", '<span dir="ltr" style="unicode-bidi:embed;white-space:nowrap">0770 08 08 30</span>')}</p>
</td></tr>
<tr><td style="padding:22px 36px 28px;color:#8a8a90;font-size:12.5px">— ${esc(c.signature)}</td></tr>
</table>
<p style="margin:16px 0 0;font-size:11.5px;color:#a3a3a8">nzzor.com · Allouni Travel Agency</p>
</td></tr></table></body></html>`;

  const text = [
    c.hello(b.guestFirstName), "", c.body, "",
    `${c.ref}: ${b.reference}`,
    hotelName ? `${c.hotel}: ${hotelName}` : "",
    `${c.arrival}: ${date(b.checkIn)}`,
    `${c.departure}: ${date(b.checkOut)}`,
    `${c.total}: ${amount}`, "",
    `${c.button}: ${url}`, "", c.hold, c.tip, c.help, "", `— ${c.signature}`,
  ].filter((l) => l !== null).join("\n");

  try {
    const result = await resend.emails.send({
      from: fromAddress,
      to: [to],
      bcc: [AGENCY_EMAIL],
      subject: c.subject(b.reference),
      html,
      text,
      replyTo: "bookings@nzzor.com",
      tags: [{ name: "category", value: "payment_recovery" }, { name: "lang", value: L }],
    });
    if (result.error) {
      console.error(`[emailService] Resend error for recovery ${b.reference}:`, result.error);
      return null;
    }
    console.log(`[emailService] sent payment recovery for ${b.reference} → ${to} (id: ${result.data?.id})`);
    return result.data?.id || null;
  } catch (err) {
    console.error(`[emailService] failed to send recovery for ${b.reference}:`, err);
    return null;
  }
}

module.exports = {
  sendPaymentRecovery,
  sendHotelNotification,
  sendPaymentReceipt,
  sendBookingCreated,
  sendBookingConfirmed,
  sendBookingPaid,
  sendBookingRejected,
  sendBookingCancelled,
  sendPasswordResetEmail,
};
