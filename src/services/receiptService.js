// =============================================================================
// receiptService — payment receipt PDF
// -----------------------------------------------------------------------------
// SATIM's cahier de recette requires the merchant to allow the payment receipt
// to be printed, downloaded as PDF, and emailed to a third-party address. This
// builds that PDF.
//
// WHY THIS IS SEPARATE FROM voucherService
//
// The voucher is a travel document: hotel, dates, room, guest. The receipt is a
// financial document: what was charged, by which card, under which
// authorization code. They are shown to different people for different reasons
// and are graded separately by SATIM. Merging them would mean a customer who
// wants proof of payment for an expense claim has to hand over their itinerary
// too.
//
// FONTS
//
// Deliberately uses PDFKit's built-in Helvetica rather than the Noto Sans files
// voucherService loads. A receipt must never fail to generate because a font
// asset is missing from a deploy — this is the document a customer reaches for
// when they are worried about money.
//
// Arabic therefore renders in French, matching the existing voucher behaviour:
// Helvetica has no Arabic glyphs, and bolting on a shaping pipeline here would
// reintroduce exactly the fragility this file avoids. The receipt data itself
// (codes, amounts, dates) is script-neutral.
// =============================================================================

const PDFDocument = require("pdfkit");

const INK = "#16161A";
const RED = "#E63946";
const GRAY = "#6B6B75";
const LINE = "#E5E2DC";

const COPY = {
  en: {
    title: "Payment receipt",
    operator: "Operated by Allouni Travel Agency",
    reference: "Booking reference",
    order_id: "Transaction ID (SATIM)",
    order_number: "Order number",
    approval: "Authorization code",
    datetime: "Date and time",
    amount: "Amount paid",
    method: "Payment method",
    card: "Card",
    guest: "Guest",
    hotel: "Hotel",
    stay: "Stay",
    nights: "nights",
    status: "Status",
    paid: "PAID",
    helpline: "Payment problem? Call SATIM free on 3020.",
    footer: "This receipt was issued electronically and requires no signature.",
  },
  fr: {
    title: "Reçu de paiement",
    operator: "Exploité par Allouni Travel Agency",
    reference: "Référence de réservation",
    order_id: "Identifiant de transaction (SATIM)",
    order_number: "Numéro de commande",
    approval: "Numéro d'autorisation",
    datetime: "Date et heure",
    amount: "Montant payé",
    method: "Mode de paiement",
    card: "Carte",
    guest: "Client",
    hotel: "Hôtel",
    stay: "Séjour",
    nights: "nuits",
    status: "Statut",
    paid: "PAYÉ",
    helpline: "Problème de paiement ? Appelez gratuitement la SATIM au 3020.",
    footer: "Ce reçu a été émis électroniquement et ne nécessite aucune signature.",
  },
};

function copyFor(lang) {
  // Arabic falls back to French — see the FONTS note above.
  return lang === "en" ? COPY.en : COPY.fr;
}

function fmtDate(value, lang) {
  if (!value) return "-";
  const locale = lang === "en" ? "en-GB" : "fr-DZ";
  try {
    return new Date(value).toLocaleString(locale, {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return new Date(value).toISOString().replace("T", " ").slice(0, 19);
  }
}

function fmtAmount(amount, lang) {
  if (amount === null || amount === undefined) return "-";
  const locale = lang === "en" ? "en-GB" : "fr-DZ";
  try {
    return new Intl.NumberFormat(locale).format(amount);
  } catch {
    return String(amount);
  }
}

/**
 * @param {Object} r  receipt payload from GET /api/payments/satim/receipt/:ref
 * @param {string} lang  "en" | "fr" | "ar"  (ar renders as fr)
 * @returns {Promise<Buffer>}
 */
function generateReceiptPdf(r, lang = "fr") {
  const c = copyFor(lang);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 56 });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const width = right - left;

      // ---- header ---------------------------------------------------------
      doc.circle(left + 7, doc.y + 7, 7).fill(RED);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(17)
        .text("Nzzor", left + 22, doc.y - 4);
      doc.font("Helvetica").fontSize(8.5).fillColor(GRAY)
        .text(c.operator, left + 22, doc.y + 1);

      doc.moveDown(2);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(21).text(c.title, left);
      doc.moveDown(0.4);

      // Paid stamp
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#1B8A5A")
        .text(`${c.status}: ${c.paid}`, left);

      doc.moveDown(0.8);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(LINE).lineWidth(1).stroke();
      doc.moveDown(1);

      // ---- respCode_desc, when SATIM sent one -----------------------------
      if (r.respCodeDesc) {
        doc.font("Helvetica-Bold").fontSize(11).fillColor(INK)
          .text(String(r.respCodeDesc), left, doc.y, { width });
        doc.moveDown(0.9);
      }

      // ---- field table ----------------------------------------------------
      const rows = [
        [c.reference, r.reference],
        [c.order_id, r.orderId],
        [c.order_number, r.orderNumber],
        [c.approval, r.approvalCode],
        [c.datetime, fmtDate(r.transactionAt, lang)],
        [c.method, r.method],
        [c.card, r.pan],
        [c.guest, r.guestName],
        [c.hotel, r.hotelName],
        [c.stay, r.nights ? `${r.nights} ${c.nights}` : null],
      ].filter(([, v]) => v !== null && v !== undefined && v !== "");

      const labelW = 190;
      for (const [k, v] of rows) {
        const y = doc.y;
        doc.font("Helvetica").fontSize(10).fillColor(GRAY).text(k, left, y, { width: labelW });
        doc.font("Helvetica-Bold").fontSize(10).fillColor(INK)
          .text(String(v), left + labelW, y, { width: width - labelW });
        doc.moveDown(0.35);
        doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#F2F0EC").lineWidth(0.5).stroke();
        doc.moveDown(0.45);
      }

      // ---- amount, given its own weight -----------------------------------
      doc.moveDown(0.6);
      const boxTop = doc.y;
      doc.rect(left, boxTop, width, 52).fillAndStroke("#FAF8F4", LINE);
      doc.fillColor(GRAY).font("Helvetica").fontSize(10)
        .text(c.amount, left + 16, boxTop + 12);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(20)
        .text(`${fmtAmount(r.amount, lang)} ${r.currency || "DZD"}`, left + 16, boxTop + 25);
      doc.y = boxTop + 52;

      // ---- footer ---------------------------------------------------------
      doc.moveDown(1.6);
      doc.font("Helvetica").fontSize(9).fillColor(GRAY)
        .text(c.helpline, left, doc.y, { width });
      doc.moveDown(0.4);
      doc.fontSize(8).fillColor("#9A9AA3")
        .text(c.footer, left, doc.y, { width });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateReceiptPdf };
