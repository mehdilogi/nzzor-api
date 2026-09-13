"use client";

import { useState } from "react";

// =============================================================================
// PaymentReceipt — the return page SATIM grades
// -----------------------------------------------------------------------------
// The cahier de recette requires an accepted payment to display all of:
//   respCode_desc, orderId, orderNumber, approvalCode, transaction date/time,
//   amount with currency, payment method (CIB/Edahabia), and SATIM's green
//   number 3020.
// It must also be printable, downloadable as PDF, and emailable to a third
// party address.
//
// Print and PDF are the same action here: the print stylesheet strips the
// page furniture and every browser's print dialogue offers "Save as PDF". A
// server-rendered PDF would be a second code path producing a second document
// that could drift from what the customer sees on screen; one document that
// prints correctly is both simpler and harder to get wrong.
//
// Nothing on this page contacts SATIM. The payment is already settled by the
// time anyone reads it — see the note in routes/payments.js.
// =============================================================================

const INK = "#16161A";
const CREAM = "#FAF8F4";
const RED = "#E63946";
const TEAL = "#1B8A5A";
const AMBER = "#B4801A";
const GRAY = "#6B6B75";
const LINE = "#E5E2DC";

const S = {
  en: {
    paid_title: "Payment confirmed",
    paid_sub: "Your booking is confirmed. A confirmation email and voucher are on their way.",
    failed_title: "Payment not completed",
    rejected: "Your transaction was rejected",
    failed_sub: "Your card was not charged. You can try again with a different card.",
    pending_title: "Confirming your payment",
    pending_sub: "We haven't had a final answer from the bank yet. This usually resolves within a few minutes, and we'll email you as soon as it does.",
    unknown_title: "We couldn't identify this payment",
    unknown_sub: "If you were charged, contact us with your booking reference and we'll sort it out.",
    receipt: "Payment receipt",
    reference: "Booking reference",
    order_id: "Transaction ID",
    order_number: "Order number",
    approval: "Authorization code",
    datetime: "Date and time",
    amount: "Amount paid",
    method: "Payment method",
    card: "Card",
    guest: "Guest",
    stay: "Stay",
    nights: "nights",
    print: "Print",
    download: "Download PDF",
    email: "Email receipt",
    email_to: "Send to this address",
    send: "Send",
    cancel: "Cancel",
    sent: "Receipt sent.",
    send_failed: "We couldn't send the receipt. Please try again.",
    helpline: "Payment problem? Call SATIM free on 3020",
    view_booking: "View my booking",
    try_again: "Try again",
    browse: "Browse hotels",
    refresh: "Check again",
    dir: "ltr",
  },
  fr: {
    paid_title: "Paiement confirmé",
    paid_sub: "Votre réservation est confirmée. Un e-mail de confirmation et votre bon sont en route.",
    failed_title: "Paiement non abouti",
    rejected: "Votre transaction a été rejetée",
    failed_sub: "Votre carte n'a pas été débitée. Vous pouvez réessayer avec une autre carte.",
    pending_title: "Confirmation en cours",
    pending_sub: "Nous n'avons pas encore de réponse définitive de la banque. Cela se résout généralement en quelques minutes, et nous vous enverrons un e-mail dès que ce sera fait.",
    unknown_title: "Paiement introuvable",
    unknown_sub: "Si vous avez été débité, contactez-nous avec votre référence de réservation.",
    receipt: "Reçu de paiement",
    reference: "Référence de réservation",
    order_id: "Identifiant de transaction",
    order_number: "Numéro de commande",
    approval: "Numéro d'autorisation",
    datetime: "Date et heure",
    amount: "Montant payé",
    method: "Mode de paiement",
    card: "Carte",
    guest: "Client",
    stay: "Séjour",
    nights: "nuits",
    print: "Imprimer",
    download: "Télécharger PDF",
    email: "Envoyer par email",
    email_to: "Envoyer à cette adresse",
    send: "Envoyer",
    cancel: "Annuler",
    sent: "Reçu envoyé.",
    send_failed: "Impossible d'envoyer le reçu. Veuillez réessayer.",
    helpline: "Problème de paiement ? Appelez gratuitement la SATIM au 3020",
    view_booking: "Voir ma réservation",
    try_again: "Réessayer",
    browse: "Voir les hôtels",
    refresh: "Vérifier à nouveau",
    dir: "ltr",
  },
  ar: {
    paid_title: "تم تأكيد الدفع",
    paid_sub: "تم تأكيد حجزك. سيصلك بريد التأكيد والقسيمة قريباً.",
    failed_title: "لم يكتمل الدفع",
    rejected: "تم رفض معاملتك",
    failed_sub: "لم يتم خصم أي مبلغ من بطاقتك. يمكنك المحاولة مرة أخرى ببطاقة أخرى.",
    pending_title: "جارٍ تأكيد الدفع",
    pending_sub: "لم نتلقَّ رداً نهائياً من البنك بعد. عادةً ما يتم ذلك خلال دقائق، وسنرسل لك بريداً إلكترونياً فور اكتماله.",
    unknown_title: "تعذّر التعرف على هذه العملية",
    unknown_sub: "إذا تم خصم المبلغ، يرجى التواصل معنا مع رقم الحجز.",
    receipt: "إيصال الدفع",
    reference: "رقم الحجز",
    order_id: "معرّف المعاملة",
    order_number: "رقم الطلب",
    approval: "رمز التفويض",
    datetime: "التاريخ والوقت",
    amount: "المبلغ المدفوع",
    method: "طريقة الدفع",
    card: "البطاقة",
    guest: "النزيل",
    stay: "الإقامة",
    nights: "ليالٍ",
    print: "طباعة",
    download: "تحميل PDF",
    email: "إرسال بالبريد",
    email_to: "أرسل إلى هذا العنوان",
    send: "إرسال",
    cancel: "إلغاء",
    sent: "تم إرسال الإيصال.",
    send_failed: "تعذّر إرسال الإيصال. يرجى المحاولة مرة أخرى.",
    helpline: "مشكلة في الدفع؟ اتصل مجاناً بساتيم على 3020",
    view_booking: "عرض حجزي",
    try_again: "إعادة المحاولة",
    browse: "تصفح الفنادق",
    refresh: "تحقق مرة أخرى",
    dir: "rtl",
  },
};

const OUTCOMES = {
  paid: { color: TEAL, glyph: "✓" },
  failed: { color: RED, glyph: "✕" },
  pending: { color: AMBER, glyph: "⋯" },
  unknown: { color: GRAY, glyph: "?" },
};

// Algeria is UTC+1 all year and has no daylight saving. Without an explicit
// timeZone, toLocaleString formats in the runtime's own zone — the browser's
// for the web page, and UTC for the Railway container that builds the PDF,
// which is why SATIM saw a receipt running exactly one hour behind. Pinning
// Africa/Algiers makes the stamp the merchant's local time everywhere, which
// is what a transaction on an Algerian merchant site has to show whether the
// customer opens it in Algiers, Paris or Montreal.
function fmtDateTime(value, lang) {
  if (!value) return "—";
  try {
    const locale = lang === "ar" ? "ar-DZ" : lang === "en" ? "en-GB" : "fr-DZ";
    return new Date(value).toLocaleString(locale, {
      timeZone: "Africa/Algiers",
      // 24-hour, forced. Left to the locale, fr-DZ and ar-DZ render a 12-hour
      // clock with AM/PM on some ICU builds and 24-hour on others, so the same
      // code produced different formats on Railway and locally. A payment
      // timestamp is not somewhere to accept that. Verified to give 00:10 at
      // midnight rather than the 24:10 that hour12 can yield in some locales.
      hour12: false,
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    // Last-resort branch, only reached if Intl throws. toISOString is UTC, so
    // shift by Algeria's fixed +1 before slicing.
    const d = new Date(new Date(value).getTime() + 60 * 60 * 1000);
    return d.toISOString().replace("T", " ").slice(0, 19);
  }
}

function fmtAmount(amount, lang) {
  if (amount === null || amount === undefined) return "—";
  try {
    const locale = lang === "ar" ? "ar-DZ" : lang === "en" ? "en-GB" : "fr-DZ";
    return new Intl.NumberFormat(locale).format(amount);
  } catch {
    return String(amount);
  }
}

export default function PaymentReceipt({ status, reference, message, rejectionCode, lang, receipt }) {
  const s = S[lang] || S.fr;
  const outcome = OUTCOMES[status] || OUTCOMES.unknown;

  const [emailOpen, setEmailOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [sendState, setSendState] = useState(null); // null | "sending" | "sent" | "error"

  const title =
    status === "failed" && rejectionCode === "TRANSACTION_REJECTED"
      ? s.rejected
      : s[`${status}_title`] || s.unknown_title;

  // SATIM's rule: show respCode_desc; when that is empty, actionCodeDescription.
  // The API already resolved that fallback and sent the winner as `message`.
  const subtitle =
    status === "failed"
      ? message || s.failed_sub
      : s[`${status}_sub`] || s.unknown_sub;

  const showReceipt = status === "paid" && receipt;

  async function sendEmail() {
    if (!address || !/.+@.+\..+/.test(address)) return;
    setSendState("sending");
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${base}/api/payments/satim/receipt/${reference}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: address, lang }),
      });
      setSendState(res.ok ? "sent" : "error");
    } catch {
      setSendState("error");
    }
  }

  const row = (label, value) => (
    <div className="rcpt-row">
      <span className="rcpt-k">{label}</span>
      <span className="rcpt-v">{value || "—"}</span>
    </div>
  );

  return (
    <main dir={s.dir} className="rcpt-page">
      <div className="rcpt-wrap">
        <div className="rcpt-card">
          <div className="rcpt-badge" style={{ background: outcome.color }}>
            {outcome.glyph}
          </div>

          <h1 className="display rcpt-title">{title}</h1>
          <p className="rcpt-sub">{subtitle}</p>

          {reference && (
            <div className="rcpt-ref">
              <div className="rcpt-ref-k">{s.reference}</div>
              <div className="rcpt-ref-v">{reference}</div>
            </div>
          )}

          {showReceipt && (
            <div className="rcpt-block">
              <div className="rcpt-block-title">{s.receipt}</div>

              {receipt.respCodeDesc && (
                <div className="rcpt-desc">{receipt.respCodeDesc}</div>
              )}

              {row(s.order_id, receipt.orderId)}
              {row(s.order_number, receipt.orderNumber)}
              {row(s.approval, receipt.approvalCode)}
              {row(s.datetime, fmtDateTime(receipt.transactionAt, lang))}
              {row(
                s.amount,
                <strong>{fmtAmount(receipt.amount, lang)} {receipt.currency || "DZD"}</strong>
              )}
              {row(s.method, receipt.method)}
              {/* The masked card number is deliberately NOT shown.
                  SATIM's certification review (13/09/2026): "Veuillez retirer
                  le numéro de carte." It is still returned by the receipt
                  endpoint and still stored on the Payment row for support and
                  dispute handling — it is only withheld from display, here and
                  in the PDF. */}
              {receipt.guestName && row(s.guest, receipt.guestName)}
              {receipt.hotelName && row(s.stay, `${receipt.hotelName} · ${receipt.nights} ${s.nights}`)}

              <div className="rcpt-actions no-print">
                <button onClick={() => window.print()}>{s.print}</button>
                {/* Real server-generated PDF rather than a browser print. The
                    file the customer keeps is then byte-identical to the one
                    we email, and does not depend on their print settings. */}
                <a
                  className="rcpt-btn"
                  href={`${process.env.NEXT_PUBLIC_API_URL || ""}/api/payments/satim/receipt/${reference}/pdf?lang=${lang}`}
                >
                  {s.download}
                </a>
                <button onClick={() => { setEmailOpen((v) => !v); setSendState(null); }}>
                  {s.email}
                </button>
              </div>

              {emailOpen && (
                <div className="rcpt-email no-print">
                  <label htmlFor="rcpt-email-to">{s.email_to}</label>
                  <div className="rcpt-email-line">
                    <input
                      id="rcpt-email-to"
                      type="email"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="nom@exemple.com"
                      dir="ltr"
                    />
                    <button onClick={sendEmail} disabled={sendState === "sending"}>
                      {sendState === "sending" ? "…" : s.send}
                    </button>
                  </div>
                  {sendState === "sent" && <div className="rcpt-ok">{s.sent}</div>}
                  {sendState === "error" && <div className="rcpt-err">{s.send_failed}</div>}
                </div>
              )}
            </div>
          )}

          {/* SATIM's green number. Required on BOTH the accepted and the
              rejected return page — it is a separate graded line item. */}
          <div className="rcpt-help">{s.helpline}</div>

          <div className="rcpt-cta no-print">
            {status === "failed" && <a className="primary" href="/hotels">{s.try_again}</a>}
            {status === "pending" && reference && (
              <a className="primary" href={`/booking/result?ref=${reference}&status=pending&lang=${lang}`}>
                {s.refresh}
              </a>
            )}
            <a className="quiet" href="/hotels">{s.browse}</a>
          </div>
        </div>
      </div>

      {/* One styled-jsx block, and it is `global` on purpose: the server page
          wraps Nav and Footer in .no-print, and a scoped block cannot reach
          elements it did not render. Every other selector here is namespaced
          with .rcpt- so nothing else escapes this page. */}
      <style jsx global>{`
        .rcpt-page {
          min-height: 60vh;
          background: ${CREAM};
          padding: 64px 20px 88px;
          display: flex;
          justify-content: center;
        }
        .rcpt-wrap { width: 100%; max-width: 560px; }
        .rcpt-card {
          background: #fff;
          border-radius: 20px;
          padding: 44px 34px 34px;
          text-align: center;
          box-shadow: 0 1px 3px rgba(22,22,26,.06), 0 12px 32px rgba(22,22,26,.05);
        }
        .rcpt-badge {
          width: 72px; height: 72px; border-radius: 50%;
          color: #fff; font-size: 32px; line-height: 72px; font-weight: 600;
          margin: 0 auto 22px;
        }
        .rcpt-title { font-size: 27px; font-weight: 600; color: ${INK}; margin: 0 0 10px; }
        .rcpt-sub { color: ${GRAY}; font-size: 14.5px; line-height: 1.6; margin: 0 0 26px; }

        .rcpt-ref {
          border: 1px dashed ${LINE}; border-radius: 12px;
          padding: 14px 18px; margin-bottom: 24px;
        }
        .rcpt-ref-k {
          font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
          color: ${GRAY}; margin-bottom: 5px;
        }
        .rcpt-ref-v { font-size: 19px; font-weight: 700; color: ${INK}; letter-spacing: .04em; }

        .rcpt-block {
          border-top: 1px solid ${LINE};
          margin-top: 4px; padding-top: 22px; text-align: start;
        }
        .rcpt-block-title {
          font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
          color: ${GRAY}; font-weight: 700; margin-bottom: 14px;
        }
        .rcpt-desc {
          background: ${CREAM}; border-radius: 10px; padding: 10px 13px;
          font-size: 13.5px; color: ${INK}; margin-bottom: 14px; font-weight: 600;
        }
        .rcpt-row {
          display: flex; justify-content: space-between; gap: 16px;
          padding: 8px 0; border-bottom: 1px solid ${CREAM};
          font-size: 13.5px;
        }
        .rcpt-k { color: ${GRAY}; flex-shrink: 0; }
        .rcpt-v {
          color: ${INK}; font-weight: 600; text-align: end;
          word-break: break-all; direction: ltr;
        }

        .rcpt-actions { display: flex; gap: 8px; margin-top: 20px; flex-wrap: wrap; }
        .rcpt-actions button,
        .rcpt-actions .rcpt-btn {
          flex: 1 1 auto; min-width: 108px;
          text-align: center; text-decoration: none; display: inline-block;
          padding: 10px 14px; border-radius: 10px;
          border: 1px solid ${LINE}; background: #fff; color: ${INK};
          font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
          transition: background .12s;
        }
        .rcpt-actions button:hover,
        .rcpt-actions .rcpt-btn:hover { background: ${CREAM}; }

        .rcpt-email { margin-top: 14px; text-align: start; }
        .rcpt-email label { font-size: 12px; color: ${GRAY}; display: block; margin-bottom: 6px; }
        .rcpt-email-line { display: flex; gap: 8px; }
        .rcpt-email input {
          flex: 1 1 auto; min-width: 0;
          padding: 10px 12px; border: 1px solid ${LINE}; border-radius: 10px;
          font-size: 13.5px; font-family: inherit; color: ${INK};
        }
        .rcpt-email button {
          padding: 10px 18px; border-radius: 10px; border: none;
          background: ${INK}; color: #fff; font-weight: 700; font-size: 13px;
          cursor: pointer; font-family: inherit;
        }
        .rcpt-email button:disabled { opacity: .5; cursor: default; }
        .rcpt-ok { color: ${TEAL}; font-size: 13px; margin-top: 8px; font-weight: 600; }
        .rcpt-err { color: ${RED}; font-size: 13px; margin-top: 8px; font-weight: 600; }

        .rcpt-help {
          margin-top: 22px; padding-top: 16px; border-top: 1px solid ${LINE};
          font-size: 12.5px; color: ${GRAY};
        }

        .rcpt-cta { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
        .rcpt-cta .primary {
          background: ${INK}; color: #fff; padding: 13px 24px; border-radius: 980px;
          font-weight: 700; font-size: 14px; text-decoration: none;
        }
        .rcpt-cta .quiet { color: ${GRAY}; font-size: 14px; text-decoration: none; padding: 8px 0; }

        /* Print / Save-as-PDF. Strips interface furniture so the sheet is the
           receipt and nothing else. Nav and Footer are hidden by the global
           rule in the page wrapper. */
        @media print {
          .rcpt-page { background: #fff; padding: 0; }
          .rcpt-card { box-shadow: none; border-radius: 0; padding: 0; }
          .no-print { display: none !important; }
        }
      `}</style>
    </main>
  );
}
