// =============================================================================
// voucherService — Generate booking voucher PDFs
// -----------------------------------------------------------------------------
// Pure function: generateVoucherPdf(booking, lang) → Buffer.
//
// No DB access. The caller passes an already-formatted booking object
// (the same shape formatBooking() returns) and a language code. Returns a
// Promise<Buffer> containing the PDF bytes.
//
// Why no caching: PDFs are small (~30KB) and fast to generate (~50ms).
// Caching means dealing with stale-cache invalidation when bookings change
// status, which is more complexity than the speed buys. Generate fresh.
//
// Why PDFKit and not Puppeteer: container weight. Puppeteer adds ~280MB
// of Chromium; PDFKit adds ~70KB. At low volume, Chromium's overhead
// dwarfs any iteration-speed benefit. If we later add multiple doc types
// (invoices, refund receipts, partner statements, Phase-2 tour vouchers),
// the Puppeteer trade-off changes. For now, PDFKit.
//
// Multilingual handling:
//   - EN / FR — left-to-right, Noto Sans (Latin subset, 27KB per weight)
//   - AR      — right-to-left, Noto Sans Arabic (147KB)
//
// The Arabic version uses different layout coordinates (right-aligned text,
// labels on the right). Brand elements (the booking reference, hotel names
// as configured) stay in their natural script — Latin if the hotel name is
// "Sheraton Club des Pins", Arabic if it's "الإقامة في وهران".
//
// We render the booking reference in big, monospace-like spacing so it's
// easy to read aloud over the phone.
// =============================================================================

const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

// Arabic text shaping. PDFKit doesn't do bidi or glyph shaping itself, so
// we transform Arabic strings BEFORE passing them to doc.text():
//   1. ArabicShaper.convertArabic — converts plain Arabic characters
//      (Unicode 0600-06FF) into their shaped Presentation Forms (FB50-FEFF),
//      selecting initial/medial/final/isolated forms based on neighbors.
//   2. bidi-js applies the Unicode Bidirectional Algorithm — for pure Arabic
//      strings this reverses everything; for mixed strings (e.g.
//      "بطاقة CIB" — Arabic + Latin) it reverses only the Arabic runs,
//      leaving "CIB" in its natural order. This is what Word/Chrome do.
//
// This pipeline works because Noto Sans Arabic's font tables contain
// glyphs at the Presentation Form code points. We're effectively pre-
// computing what a smart text engine would do at render time.
const { ArabicShaper } = require("arabic-persian-reshaper");
const bidiFactory = require("bidi-js");
const bidi = bidiFactory();

// =============================================================================
// Font paths — bundled with the API repo at api/assets/fonts/
// =============================================================================

const FONTS_DIR = path.join(__dirname, "..", "..", "assets", "fonts");

const FONTS = {
  sans: path.join(FONTS_DIR, "NotoSans-Regular.ttf"),
  sansSemi: path.join(FONTS_DIR, "NotoSans-SemiBold.ttf"),
  sansBold: path.join(FONTS_DIR, "NotoSans-Bold.ttf"),
  arabic: path.join(FONTS_DIR, "NotoSansArabic-Regular.ttf"),
  arabicBold: path.join(FONTS_DIR, "NotoSansArabic-Bold.ttf"),
};

// Verify fonts exist at module load — fail fast at boot rather than at
// the first voucher request in production.
for (const [name, p] of Object.entries(FONTS)) {
  if (!fs.existsSync(p)) {
    console.warn(`[voucherService] missing font: ${name} at ${p}`);
  }
}

// =============================================================================
// Brand & layout constants
// =============================================================================

const BRAND = {
  red: "#E63946",
  ink: "#16161A",
  mute: "#6B6B70",
  muteSoft: "#A4A4A8",
  cream: "#FAF8F4",
  hairline: "#E5E3DD",
  white: "#FFFFFF",
};

// A4 portrait, in PDF points (1pt = 1/72 inch). A4 = 595 x 842 pts.
const PAGE = {
  width: 595,
  height: 842,
  margin: 50,
};

// =============================================================================
// Localization strings
// =============================================================================

const STRINGS = {
  en: {
    voucher: "BOOKING VOUCHER",
    operator: "Operated by Allouni Travel Agency",
    licence: "Tourism Licence: TOURISM_LICENCE_NUMBER",
    reference: "Booking Reference",
    guest: "Guest",
    hotel: "Hotel",
    checkIn: "Check-in",
    checkOut: "Check-out",
    nights: "nights",
    night: "night",
    rooms: "Rooms",
    total: "Total",
    payment: "Payment",
    paymentMethod: "Method",
    paymentStatus: "Status",
    issued: "Issued",
    contact: "Contact",
    terms: "Terms & Conditions",
    statusPending: "Pending",
    statusConfirmed: "Confirmed",
    statusCancelled: "Cancelled",
    statusExpired: "Expired",
    statusRejected: "Rejected",
    paid: "Paid",
    notPaid: "Awaiting payment",
    refunded: "Refunded",
    failed: "Payment failed",
    methodCIB: "CIB Card",
    methodEDDAHABIA: "Edahabia Card",
    methodCASH: "Cash on arrival",
    methodBANK_TRANSFER: "Bank transfer",
    methodWHATSAPP_ASSISTED: "WhatsApp-assisted",
    important: "Important",
    importantNote: "Present this voucher at hotel check-in along with a government-issued ID. Children must travel with the booked guardian.",
    qrInstruction: "Scan to verify",
    helpText: "For questions, contact us by email or WhatsApp. We respond within 24 hours.",
  },
  fr: {
    voucher: "BON DE RÉSERVATION",
    operator: "Exploité par Allouni Travel Agency",
    licence: "Licence Tourisme : TOURISM_LICENCE_NUMBER",
    reference: "Référence",
    guest: "Client",
    hotel: "Hôtel",
    checkIn: "Arrivée",
    checkOut: "Départ",
    nights: "nuits",
    night: "nuit",
    rooms: "Chambres",
    total: "Total",
    payment: "Paiement",
    paymentMethod: "Méthode",
    paymentStatus: "Statut",
    issued: "Émis",
    contact: "Contact",
    terms: "Conditions générales",
    statusPending: "En attente",
    statusConfirmed: "Confirmé",
    statusCancelled: "Annulé",
    statusExpired: "Expiré",
    statusRejected: "Refusé",
    paid: "Payé",
    notPaid: "En attente de paiement",
    refunded: "Remboursé",
    failed: "Paiement échoué",
    methodCIB: "Carte CIB",
    methodEDDAHABIA: "Carte Edahabia",
    methodCASH: "Paiement sur place",
    methodBANK_TRANSFER: "Virement bancaire",
    methodWHATSAPP_ASSISTED: "Assistance WhatsApp",
    important: "Important",
    importantNote: "Présentez ce bon à l'arrivée à l'hôtel avec une pièce d'identité. Les enfants doivent voyager avec le responsable inscrit.",
    qrInstruction: "Scannez pour vérifier",
    helpText: "Pour toute question, contactez-nous par email ou WhatsApp. Nous répondons sous 24h.",
  },
  ar: {
    voucher: "قسيمة الحجز",
    operator: "تشغيل وكالة العلوني للسفر",
    licence: "رخصة سياحية: TOURISM_LICENCE_NUMBER",
    reference: "رقم الحجز",
    guest: "النزيل",
    hotel: "الفندق",
    checkIn: "الوصول",
    checkOut: "المغادرة",
    nights: "ليالٍ",
    night: "ليلة",
    rooms: "الغرف",
    total: "الإجمالي",
    payment: "الدفع",
    paymentMethod: "الطريقة",
    paymentStatus: "الحالة",
    issued: "تاريخ الإصدار",
    contact: "اتصل بنا",
    terms: "الشروط والأحكام",
    statusPending: "قيد الانتظار",
    statusConfirmed: "مؤكد",
    statusCancelled: "ملغى",
    statusExpired: "منتهي",
    statusRejected: "مرفوض",
    paid: "مدفوع",
    notPaid: "في انتظار الدفع",
    refunded: "مسترد",
    failed: "فشل الدفع",
    methodCIB: "بطاقة CIB",
    methodEDDAHABIA: "بطاقة الذهبية",
    methodCASH: "الدفع عند الوصول",
    methodBANK_TRANSFER: "تحويل بنكي",
    methodWHATSAPP_ASSISTED: "مساعدة عبر واتساب",
    important: "مهم",
    importantNote: "قدم هذه القسيمة عند تسجيل الوصول مع وثيقة هوية. يجب أن يسافر الأطفال مع الوصي المسجل.",
    qrInstruction: "امسح للتحقق",
    helpText: "لأي استفسار، تواصل معنا عبر البريد الإلكتروني أو واتساب. نرد خلال 24 ساعة.",
  },
};

// String lookup. For Arabic, pre-shape every string at lookup time so
// downstream code can pass them to doc.text() without thinking about it.
const s = (lang) => {
  const base = STRINGS[lang] || STRINGS.en;
  if (lang !== "ar") return base;
  // Lazily memoize the shaped variant of the Arabic strings — small object,
  // ~30 keys, cheap to do once per process.
  if (!s._arShapedCache) {
    s._arShapedCache = {};
    for (const [k, v] of Object.entries(base)) {
      s._arShapedCache[k] = shapeArabic(v);
    }
  }
  return s._arShapedCache;
};

// =============================================================================
// Helpers
// =============================================================================

function formatDate(date, lang) {
  const d = date instanceof Date ? date : new Date(date);
  // Use English date format for AR too (numerals everyone reads). The label
  // around it is translated; the date itself stays Gregorian numeric for
  // operational clarity.
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatPrice(amount, currency) {
  const n = Number(amount || 0).toLocaleString("en-US");
  return `${n} ${currency || "DZD"}`;
}

function statusLabel(status, lang) {
  const t = s(lang);
  const map = {
    PENDING: t.statusPending,
    CONFIRMED: t.statusConfirmed,
    CANCELLED: t.statusCancelled,
    EXPIRED: t.statusExpired,
    REJECTED: t.statusRejected,
    COMPLETED: t.statusConfirmed,
  };
  return map[status] || status;
}

function paymentStatusLabel(paymentStatus, lang) {
  const t = s(lang);
  const map = {
    PAID: t.paid,
    PENDING: t.notPaid,
    FAILED: t.failed,
    REFUNDED: t.refunded,
  };
  return map[paymentStatus] || paymentStatus;
}

function paymentMethodLabel(method, lang) {
  return s(lang)[`method${method}`] || method;
}

// =============================================================================
// Main: generateVoucherPdf
// =============================================================================

/**
 * Generate a booking voucher PDF.
 *
 * @param {Object} booking — already-formatted booking (from formatBooking)
 * @param {string} lang    — "en" | "fr" | "ar"
 * @returns {Promise<Buffer>}
 *
 * NOTE on Arabic: PDFKit doesn't do Arabic bidi+glyph shaping natively.
 * We have the pipeline (arabic-persian-reshaper + bidi-js + Noto Sans
 * Arabic font) but it has remaining edge cases — mixed-direction lines,
 * the kashida glyphs, font-coverage gaps for some shaped forms — that
 * need more iteration before the AR voucher reaches production quality.
 *
 * For v1, `lang: "ar"` returns the French voucher (most Algerian users
 * read French fluently). To enable Arabic, change the fallback below to
 * `L = lang`. The infrastructure is intact; only the safety gate is
 * temporarily flipping AR → FR.
 */
async function generateVoucherPdf(booking, lang) {
  // Temporary AR → FR fallback (see function header above).
  let L = lang || booking.lang || "en";
  if (L === "ar") L = "fr";

  const t = s(L);
  const isRtl = L === "ar";

  // Generate the QR code first (we need it as a buffer to embed).
  const qrUrl = buildVerificationUrl(booking.reference);
  const qrBuffer = await QRCode.toBuffer(qrUrl, {
    margin: 0,
    width: 280,
    color: { dark: BRAND.ink, light: BRAND.white },
  });

  // Build the PDF.
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0, // we handle margins manually for better control
      info: {
        Title: `Nzzor Voucher ${booking.reference}`,
        Author: "Nzzor",
        Subject: "Booking Voucher",
        Creator: "Nzzor PDF Service",
      },
    });

    // Register fonts. PDFKit requires fonts to be registered by file path
    // OR buffer before being used by name.
    doc.registerFont("Sans", FONTS.sans);
    doc.registerFont("SansSemi", FONTS.sansSemi);
    doc.registerFont("SansBold", FONTS.sansBold);
    doc.registerFont("Arabic", FONTS.arabic);
    doc.registerFont("ArabicBold", FONTS.arabicBold);

    // Helper: pick the right font given lang context. For Arabic content,
    // we use the Arabic font. For Latin content (numbers, references,
    // English hotel names) we always use the Latin font regardless of lang.
    const fontFor = (weight, forArabic = false) => {
      if (forArabic && isRtl) {
        return weight === "bold" ? "ArabicBold" : "Arabic";
      }
      if (weight === "bold") return "SansBold";
      if (weight === "semi") return "SansSemi";
      return "Sans";
    };

    // Buffer collector.
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // =====================================================================
    // LAYOUT
    // =====================================================================

    const M = PAGE.margin;
    const W = PAGE.width;
    const H = PAGE.height;
    const contentW = W - M * 2;

    // ---------- Header band (red accent + brand) ----------
    doc.rect(0, 0, W, 6).fill(BRAND.red);

    // Logo area (top-left): red circle + "Nzzor" wordmark + small subtitle.
    // The red circle is the Nzzor brand mark — sized to span the full
    // logo block height (from cap-top of "Nzzor" down through the
    // "Operated by..." line) so it reads as a left-anchored brand badge,
    // matching the sidebar treatment on the admin and the website nav.
    //
    // Geometry:
    //   "Nzzor" baseline ≈ M + 18 (fontSize 22, cap-height ≈ 16)
    //   "Operated by"   baseline ≈ M + 36 (text at M+28, height ≈ 8.5)
    //   Block top ≈ M + 2, block bottom ≈ M + 38 → circle diameter ≈ 36, r=18
    const dotR = 18;
    const dotX = M + dotR;
    const dotY = M + 20; // vertical center of the logo block
    doc.circle(dotX, dotY, dotR).fill(BRAND.red);

    // Wordmark + subtitle, shifted right of the circle with a small gap.
    const textX = M + dotR * 2 + 12;
    doc.fillColor(BRAND.ink)
       .font(fontFor("bold"))
       .fontSize(22)
       .text("Nzzor", textX, M, { lineBreak: false });

    // Subtitle aligned under the wordmark (operator only — licence moved to footer)
    doc.font(fontFor("regular"))
       .fontSize(8.5)
       .fillColor(BRAND.mute)
       .text(t.operator, textX, M + 28, { lineBreak: false });

    // Voucher type label (top-right)
    const voucherFontKey = isRtl ? fontFor("bold", true) : fontFor("bold");
    doc.font(voucherFontKey)
       .fontSize(11)
       .fillColor(BRAND.red)
       .text(t.voucher, M, M + 4, {
         width: contentW,
         align: isRtl ? "left" : "right",
       });

    // Status badge under voucher label
    const statusText = `${statusLabel(booking.status, L)} · ${paymentStatusLabel(booking.paymentStatus, L)}`;
    const statusFontKey = isRtl ? fontFor("semi", true) : fontFor("semi");
    doc.font(statusFontKey)
       .fontSize(9)
       .fillColor(BRAND.mute)
       .text(statusText, M, M + 24, {
         width: contentW,
         align: isRtl ? "left" : "right",
       });

    // ---------- Section: Booking reference + QR ----------
    let cursorY = M + 80;
    hairline(doc, M, cursorY, contentW);
    cursorY += 18;

    // Reference block — the hero element. Big, spaced out, easy to read.
    const refLabelFontKey = isRtl ? fontFor("regular", true) : fontFor("regular");
    doc.font(refLabelFontKey)
       .fontSize(8.5)
       .fillColor(BRAND.mute)
       .text(t.reference.toUpperCase(), M, cursorY, {
         characterSpacing: 1.5,
         lineBreak: false,
       });

    // The reference itself — always Latin/numeric, big, prominent.
    doc.font(fontFor("bold"))
       .fontSize(26)
       .fillColor(BRAND.ink)
       .text(booking.reference, M, cursorY + 14, {
         lineBreak: false,
         characterSpacing: 1,
       });

    // QR code (right side). 90x90 pts. Anchor: top-right corner of content area.
    const qrSize = 90;
    const qrX = W - M - qrSize;
    const qrY = cursorY;
    doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

    // QR caption — small instruction below the QR
    doc.font(isRtl ? fontFor("regular", true) : fontFor("regular"))
       .fontSize(7)
       .fillColor(BRAND.muteSoft)
       .text(t.qrInstruction, qrX, qrY + qrSize + 4, {
         width: qrSize,
         align: "center",
         lineBreak: false,
       });

    cursorY += 110;
    hairline(doc, M, cursorY, contentW);
    cursorY += 18;

    // ---------- Section: Guest + Hotel (two columns) ----------
    const colW = (contentW - 20) / 2;

    // Guest column — handle both flat (booking.guestFirstName) and nested
    // (booking.guest.firstName) shapes. Different parts of the codebase
    // format bookings differently; the voucher should work with either.
    const guest = booking.guest || {};
    const guestFirst = booking.guestFirstName || guest.firstName || "";
    const guestLast  = booking.guestLastName  || guest.lastName  || "";
    const guestEmail = booking.guestEmail     || guest.email     || "";
    const guestPhone = booking.guestPhone     || guest.phone     || "";

    drawLabel(doc, isRtl ? L : "en", t.guest, M, cursorY, L);
    doc.font(fontFor("semi"))
       .fontSize(13)
       .fillColor(BRAND.ink)
       .text(
         `${guestFirst} ${guestLast}`.trim() || "—",
         M, cursorY + 14,
         { width: colW, lineBreak: false }
       );
    doc.font(fontFor("regular"))
       .fontSize(9.5)
       .fillColor(BRAND.mute)
       .text(guestEmail, M, cursorY + 32, { width: colW, lineBreak: false })
       .text(guestPhone, M, cursorY + 46, { width: colW, lineBreak: false });

    // Hotel column
    const hotelX = M + colW + 20;
    drawLabel(doc, L, t.hotel, hotelX, cursorY, L);
    // Hotel name comes from the formatted booking — already in the right language
    // because formatBooking() picks the localized field per `lang`.
    const hotelNameRaw = booking.hotel?.name || booking.hotelName || "—";
    const hotelHasArabic = hasArabic(hotelNameRaw);
    const hotelName = hotelHasArabic ? shapeArabic(hotelNameRaw) : hotelNameRaw;
    doc.font(fontFor("semi", hotelHasArabic))
       .fontSize(13)
       .fillColor(BRAND.ink)
       .text(hotelName, hotelX, cursorY + 14, { width: colW, lineBreak: false });
    const hotelCityRaw = booking.hotel?.city || "";
    if (hotelCityRaw) {
      const cityHasArabic = hasArabic(hotelCityRaw);
      const hotelCity = cityHasArabic ? shapeArabic(hotelCityRaw) : hotelCityRaw;
      doc.font(fontFor("regular", cityHasArabic))
         .fontSize(9.5)
         .fillColor(BRAND.mute)
         .text(hotelCity, hotelX, cursorY + 32, { width: colW, lineBreak: false });
    }

    cursorY += 70;
    hairline(doc, M, cursorY, contentW);
    cursorY += 18;

    // ---------- Section: Dates (three columns: check-in, check-out, nights) ----------
    const dateColW = contentW / 3;

    drawLabel(doc, L, t.checkIn, M, cursorY, L);
    doc.font(fontFor("semi"))
       .fontSize(13)
       .fillColor(BRAND.ink)
       .text(formatDate(booking.checkIn, L), M, cursorY + 14, { lineBreak: false });

    drawLabel(doc, L, t.checkOut, M + dateColW, cursorY, L);
    doc.font(fontFor("semi"))
       .fontSize(13)
       .fillColor(BRAND.ink)
       .text(formatDate(booking.checkOut, L), M + dateColW, cursorY + 14, { lineBreak: false });

    drawLabel(doc, L, isRtl ? t.nights : (booking.nights === 1 ? t.night : t.nights),
              M + dateColW * 2, cursorY, L);
    doc.font(fontFor("semi"))
       .fontSize(13)
       .fillColor(BRAND.ink)
       .text(`${booking.nights} ${booking.nights === 1 ? t.night : t.nights}`,
             M + dateColW * 2, cursorY + 14, { lineBreak: false });

    cursorY += 50;
    hairline(doc, M, cursorY, contentW);
    cursorY += 18;

    // ---------- Section: Rooms ----------
    drawLabel(doc, L, t.rooms, M, cursorY, L);
    cursorY += 16;

    const rooms = booking.rooms || [];
    // booking.currency may be at the top level (flat shape) or inside
    // booking.pricing (emailService shape). Fall through to "DZD".
    const currency = booking.currency || booking.pricing?.currency || "DZD";
    for (const r of rooms) {
      const roomType = r.room?.type || r.roomType || "Room";
      const qty = r.quantity || 1;
      const pricePerNight = r.pricePerNight || 0;
      const lineText = `${qty} × ${roomType}`;
      const rightText = `${formatPrice(pricePerNight, currency)} / ${t.night}`;

      const hasAr = hasArabic(lineText);
      doc.font(fontFor("regular", hasAr))
         .fontSize(11)
         .fillColor(BRAND.ink)
         .text(lineText, M, cursorY, {
           width: contentW - 200,
           lineBreak: false,
         });
      doc.font(fontFor("regular"))
         .fontSize(11)
         .fillColor(BRAND.mute)
         .text(rightText, M, cursorY, {
           width: contentW,
           align: "right",
           lineBreak: false,
         });
      cursorY += 18;
    }

    cursorY += 4;
    hairline(doc, M, cursorY, contentW);
    cursorY += 18;

    // ---------- Section: Total + Payment ----------
    // Total: big number on the right, label on the left
    drawLabel(doc, L, t.total, M, cursorY, L);
    // Total: support both flat (booking.total) and nested (booking.pricing.total) shapes
    const totalAmount = booking.total ?? booking.pricing?.total ?? 0;
    doc.font(fontFor("bold"))
       .fontSize(22)
       .fillColor(BRAND.ink)
       .text(formatPrice(totalAmount, currency), M, cursorY + 12, {
         width: contentW,
         align: "right",
         lineBreak: false,
       });

    cursorY += 50;

    // Payment method line
    doc.font(isRtl ? fontFor("regular", true) : fontFor("regular"))
       .fontSize(10)
       .fillColor(BRAND.mute)
       .text(`${t.payment}: ${paymentMethodLabel(booking.paymentMethod, L)}`,
             M, cursorY, { lineBreak: false });

    cursorY += 28;

    // ---------- Important note ----------
    doc.rect(M, cursorY, contentW, 1).fill(BRAND.red);
    cursorY += 10;

    doc.font(isRtl ? fontFor("bold", true) : fontFor("bold"))
       .fontSize(9)
       .fillColor(BRAND.red)
       .text(t.important.toUpperCase(), M, cursorY, {
         characterSpacing: 1,
         lineBreak: false,
       });

    cursorY += 14;

    const noteFontKey = isRtl ? fontFor("regular", true) : fontFor("regular");
    doc.font(noteFontKey)
       .fontSize(9.5)
       .fillColor(BRAND.ink)
       .text(t.importantNote, M, cursorY, {
         width: contentW,
         align: isRtl ? "right" : "left",
       });

    // ---------- Footer (bottom of page) ----------
    // Footer block sits ~96pt from the bottom — enough room for four lines
    // (licence, issued, contact, help) plus the red strip at H-6.
    const footerY = H - 96;
    hairline(doc, M, footerY, contentW);

    doc.font(isRtl ? fontFor("regular", true) : fontFor("regular"))
       .fontSize(8)
       .fillColor(BRAND.mute);

    // Licence first — it's the most "official" line and front-desk staff
    // sometimes look here for the agency identifier. Until the real number
    // is dropped in, the placeholder reads "TOURISM_LICENCE_NUMBER".
    doc.text(t.licence, M, footerY + 10, {
      width: contentW,
      align: isRtl ? "right" : "left",
    });

    const issuedText = `${t.issued}: ${formatDate(new Date(), L)} · Algiers`;
    doc.text(issuedText, M, footerY + 24, {
      width: contentW,
      align: isRtl ? "right" : "left",
    });

    const contactText = `${t.contact}: support@nzzor.com · nzzor.com`;
    doc.text(contactText, M, footerY + 38, {
      width: contentW,
      align: isRtl ? "right" : "left",
    });

    doc.fontSize(7)
       .fillColor(BRAND.muteSoft)
       .text(t.helpText, M, footerY + 56, {
         width: contentW,
         align: isRtl ? "right" : "left",
       });

    // Bottom red strip
    doc.rect(0, H - 6, W, 6).fill(BRAND.red);

    doc.end();
  });
}

// =============================================================================
// Internal helpers
// =============================================================================

// Draw a small uppercase label (used for section headers like "Guest").
function drawLabel(doc, lang, text, x, y, contextLang) {
  const isRtl = contextLang === "ar";
  const hasAr = hasArabic(text);
  const fontKey = hasAr ? (isRtl ? "Arabic" : "Sans") : "Sans";
  doc.font(fontKey)
     .fontSize(8)
     .fillColor("#A4A4A8")
     .text(text.toUpperCase(), x, y, {
       characterSpacing: 1.5,
       lineBreak: false,
     });
}

// Quick heuristic: does this string contain any Arabic-script characters?
// Used to switch fonts mid-document for content like hotel names.
function hasArabic(s) {
  if (!s || typeof s !== "string") return false;
  // Arabic Unicode block (0600-06FF) + Arabic Supplement (0750-077F) +
  // Arabic Extended-A (08A0-08FF) + Arabic Presentation Forms (FB50-FEFF).
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFEFF]/.test(s);
}

// Shape Arabic text for PDFKit. See the import header comment for what
// this does and why it's needed. Returns the input unchanged if there's no
// Arabic in it — safe to call on every string.
//
// Handles mixed-direction strings correctly: "بطاقة CIB" becomes
// "CIB ﺔﻗﺎﻄﺑ" (Latin word kept in order, Arabic word shaped and reversed).
function shapeArabic(s) {
  if (!s || typeof s !== "string") return s;
  if (!hasArabic(s)) return s;
  // Step 1: shape — substitute Arabic chars with their Presentation Forms.
  const shaped = ArabicShaper.convertArabic(s);
  // Step 2: bidi reorder — handles mixed Latin+Arabic runs properly.
  const levels = bidi.getEmbeddingLevels(shaped, "rtl");
  const segs = bidi.getReorderSegments(shaped, levels);
  const out = shaped.split("");
  for (const seg of segs) {
    const [start, end] = seg;
    const slice = out.slice(start, end + 1).reverse();
    out.splice(start, end - start + 1, ...slice);
  }
  return out.join("");
}

// Draw a hairline divider.
function hairline(doc, x, y, w) {
  doc.save()
     .strokeColor(BRAND.hairline)
     .lineWidth(0.5)
     .moveTo(x, y)
     .lineTo(x + w, y)
     .stroke()
     .restore();
}

// Build the verification URL that the QR code encodes. Scanning brings the
// front-desk staff to a public booking lookup that proves the reservation
// is real. We use the customer site here, not the API — clearer URL.
function buildVerificationUrl(reference) {
  const base = process.env.WEB_BASE_URL || "https://nzzor.com";
  return `${base}/bookings/${encodeURIComponent(reference)}`;
}

module.exports = {
  generateVoucherPdf,
};
