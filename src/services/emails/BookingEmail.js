// =============================================================================
// BookingEmail — React Email template
// -----------------------------------------------------------------------------
// One template, three variants (created / confirmed / paid), three languages
// (EN/FR/AR). Rendered to HTML via @react-email/render and passed to Resend.
//
// We use React.createElement directly (no JSX) so this file is plain CommonJS
// and needs no build step — matches the rest of the nzzor-api codebase.
//
// Brand language: warm, factual, agency-grade. NOT marketing copy. The reader
// is mid-trip-planning and wants their receipt.
//
// Visual style: Daylight Cinematic — red #E63946 accent, ink #16161A text on
// cream #FAF8F4 background. Big serif headline, clean sans body. Email-safe
// HTML (no flex, no grid — table layouts under the hood via @react-email).
// =============================================================================

const React = require("react");
const {
  Html,
  Head,
  Body,
  Container,
  Section,
  Row,
  Column,
  Text,
  Heading,
  Hr,
  Link,
  Preview,
  Img,
  Font,
} = require("@react-email/components");

const { t } = require("../emailStrings");

// ---- Helpers ----------------------------------------------------------------
// React.createElement is verbose — these short aliases keep the markup readable.
const e = React.createElement;
const Br = () => e("br");

// Format a money amount as "18,000 DZD" with thin-space grouping.
function money(amount, currency = "DZD", lang = "en") {
  const n = Math.round(amount || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n} ${currency}`;
}

// Format a date as "Sat, 12 Jun 2026" in the booking's language.
function formatDate(dateInput, lang = "en") {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";
  const locale = lang === "ar" ? "ar-DZ" : lang === "fr" ? "fr-FR" : "en-GB";
  return d.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Map a payment method enum to human-readable in the email's language.
function paymentMethodLabel(method, lang) {
  const map = {
    CIB: t("payment.cib", lang),
    EDDAHABIA: t("payment.eddahabia", lang),
    CASH: t("payment.cash", lang),
    BANK_TRANSFER: t("payment.bank_transfer", lang),
    WHATSAPP_ASSISTED: t("payment.whatsapp_assisted", lang),
  };
  return map[method] || method;
}

// ---- Design tokens (inlined; email clients ignore stylesheets) -------------
const colors = {
  red: "#E63946",
  ink: "#16161A",
  ink2: "#3A3A40",
  gray400: "#7A7A80",
  gray200: "#E5E5E7",
  cream: "#FAF8F4",
  white: "#FFFFFF",
};

const styles = {
  body: {
    backgroundColor: colors.cream,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    margin: 0,
    padding: 0,
    color: colors.ink,
  },
  container: {
    margin: "0 auto",
    padding: "0",
    maxWidth: "600px",
    backgroundColor: colors.cream,
  },
  header: {
    padding: "32px 40px 24px",
    borderBottom: `1px solid ${colors.gray200}`,
  },
  brandRow: {
    fontSize: "18px",
    fontWeight: "700",
    letterSpacing: "-0.01em",
    color: colors.ink,
  },
  brandDot: {
    display: "inline-block",
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    backgroundColor: colors.red,
    marginRight: "10px",
    verticalAlign: "middle",
  },
  brandSubtitle: {
    fontSize: "11px",
    fontWeight: "600",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: colors.gray400,
    margin: "4px 0 0",
  },
  heroSection: {
    padding: "40px 40px 8px",
  },
  variantKicker: {
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: colors.red,
    margin: "0 0 14px",
  },
  heading: {
    fontSize: "30px",
    fontWeight: "600",
    letterSpacing: "-0.02em",
    lineHeight: "1.15",
    color: colors.ink,
    margin: "0 0 16px",
  },
  lead: {
    fontSize: "15.5px",
    lineHeight: "1.6",
    color: colors.ink2,
    margin: "0 0 28px",
  },
  refCard: {
    backgroundColor: colors.white,
    border: `1px solid ${colors.gray200}`,
    borderRadius: "10px",
    padding: "20px 24px",
    margin: "0 40px 28px",
  },
  refLabel: {
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: colors.gray400,
    margin: "0 0 6px",
  },
  refValue: {
    fontSize: "22px",
    fontWeight: "700",
    fontFamily: "'Courier New', Courier, monospace",
    letterSpacing: "0.02em",
    color: colors.ink,
    margin: 0,
  },
  detailsSection: {
    padding: "0 40px 8px",
  },
  detailsTitle: {
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: colors.gray400,
    margin: "0 0 14px",
  },
  detailRow: {
    padding: "12px 0",
    borderBottom: `1px solid ${colors.gray200}`,
  },
  detailLabel: {
    fontSize: "13px",
    color: colors.gray400,
    margin: "0 0 4px",
  },
  detailValue: {
    fontSize: "15px",
    fontWeight: "500",
    color: colors.ink,
    margin: 0,
    lineHeight: "1.4",
  },
  totalRow: {
    padding: "20px 0 4px",
  },
  totalLabel: {
    fontSize: "13px",
    fontWeight: "700",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: colors.gray400,
  },
  totalValue: {
    fontSize: "26px",
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: "-0.01em",
  },
  noteCard: {
    backgroundColor: "#FFF5F5",
    border: `1px solid #FBE5E5`,
    borderLeft: `3px solid ${colors.red}`,
    borderRadius: "6px",
    padding: "16px 20px",
    margin: "28px 40px 8px",
  },
  noteText: {
    fontSize: "14px",
    lineHeight: "1.55",
    color: colors.ink2,
    margin: 0,
  },
  ctaWrap: {
    padding: "32px 40px 8px",
    textAlign: "center",
  },
  ctaButton: {
    display: "inline-block",
    backgroundColor: colors.ink,
    color: colors.white,
    fontSize: "14px",
    fontWeight: "600",
    padding: "13px 28px",
    borderRadius: "8px",
    textDecoration: "none",
    letterSpacing: "0.01em",
  },
  footer: {
    padding: "40px 40px 32px",
    borderTop: `1px solid ${colors.gray200}`,
    marginTop: "32px",
  },
  footerText: {
    fontSize: "12.5px",
    lineHeight: "1.6",
    color: colors.gray400,
    margin: "0 0 8px",
  },
  footerLink: {
    color: colors.gray400,
    textDecoration: "underline",
  },
};

// ---- Sub-component: detail row ---------------------------------------------
function DetailRow({ label, value, isLast }) {
  return e(
    "div",
    {
      style: {
        ...styles.detailRow,
        borderBottom: isLast ? "none" : styles.detailRow.borderBottom,
      },
    },
    e(Text, { style: styles.detailLabel }, label),
    e(Text, { style: styles.detailValue }, value)
  );
}

// ---- Main component --------------------------------------------------------
//
// Props:
//   variant: "created" | "confirmed" | "paid"
//   booking: formatted booking object (from formatBooking helper)
//   lang: "en" | "fr" | "ar"
//   webBaseUrl: base URL for the booking link
//
function BookingEmail(props) {
  const { variant = "created", booking, lang = "en", webBaseUrl = "https://nzzor.com" } = props;
  const isRtl = lang === "ar";
  const dir = isRtl ? "rtl" : "ltr";

  const bookingUrl = `${webBaseUrl}/bookings/${booking.reference}?lang=${lang}`;

  // Variant-specific copy
  const kicker = t(`variant.${variant}.kicker`, lang);
  const heading = t(`variant.${variant}.heading`, lang);
  const lead = t(`variant.${variant}.lead`, lang)
    .replace("{firstName}", booking.guest.firstName);

  // Note: factual + reassuring, NOT promotional. Allouni team-confirms-by-noon
  // messaging lives in "created"; the other variants pivot tone accordingly.
  const note = t(`variant.${variant}.note`, lang);

  const previewText = t(`variant.${variant}.preview`, lang)
    .replace("{reference}", booking.reference)
    .replace("{hotel}", booking.hotel ? booking.hotel.name : "");

  return e(
    Html,
    { lang, dir },
    e(Head, null),
    e(Preview, null, previewText),
    e(
      Body,
      { style: styles.body },
      e(
        Container,
        { style: styles.container },

        // ----- Header (brand) -----
        e(
          Section,
          { style: styles.header },
          e(
            "div",
            { style: styles.brandRow },
            e("span", { style: styles.brandDot }),
            "Nzzor"
          ),
          e(Text, { style: styles.brandSubtitle }, t("brand.subtitle", lang))
        ),

        // ----- Hero (variant-specific copy) -----
        e(
          Section,
          { style: styles.heroSection },
          e(Text, { style: styles.variantKicker }, kicker),
          e(Heading, { style: styles.heading, as: "h1" }, heading),
          e(Text, { style: styles.lead }, lead)
        ),

        // ----- Booking reference card -----
        e(
          Section,
          { style: styles.refCard },
          e(Text, { style: styles.refLabel }, t("ref.label", lang)),
          e(Text, { style: styles.refValue }, booking.reference)
        ),

        // ----- Details -----
        e(
          Section,
          { style: styles.detailsSection },
          e(Text, { style: styles.detailsTitle }, t("details.title", lang)),

          booking.hotel && e(DetailRow, {
            label: t("details.hotel", lang),
            value: `${booking.hotel.name}${booking.hotel.city ? " · " + booking.hotel.city : ""}`,
          }),
          e(DetailRow, {
            label: t("details.guest", lang),
            value: `${booking.guest.firstName} ${booking.guest.lastName}`,
          }),
          e(DetailRow, {
            label: t("details.checkin", lang),
            value: formatDate(booking.checkIn, lang),
          }),
          e(DetailRow, {
            label: t("details.checkout", lang),
            value: formatDate(booking.checkOut, lang),
          }),
          e(DetailRow, {
            label: t("details.nights", lang),
            value: `${booking.nights} ${booking.nights === 1 ? t("details.night_one", lang) : t("details.night_many", lang)}`,
          }),
          booking.rooms && booking.rooms.length > 0 && e(DetailRow, {
            label: t("details.rooms", lang),
            value: booking.rooms.map(r => `${r.quantity} × ${r.type}`).join(", "),
          }),
          e(DetailRow, {
            label: t("details.payment", lang),
            value: paymentMethodLabel(booking.payment.method, lang),
            isLast: true,
          })
        ),

        // ----- Total -----
        e(
          Section,
          { style: { padding: "0 40px" } },
          e(
            "div",
            { style: styles.totalRow },
            e(
              "table",
              { width: "100%", cellPadding: "0", cellSpacing: "0", role: "presentation" },
              e(
                "tr",
                null,
                e(
                  "td",
                  { style: { verticalAlign: "middle", textAlign: isRtl ? "right" : "left" } },
                  e("span", { style: styles.totalLabel }, t("details.total", lang))
                ),
                e(
                  "td",
                  { style: { verticalAlign: "middle", textAlign: isRtl ? "left" : "right" } },
                  e("span", { style: styles.totalValue }, money(booking.pricing.total, booking.pricing.currency, lang))
                )
              )
            )
          )
        ),

        // ----- Variant-specific note -----
        note && e(
          Section,
          { style: styles.noteCard },
          e(Text, { style: styles.noteText }, note)
        ),

        // ----- CTA: view booking online -----
        e(
          Section,
          { style: styles.ctaWrap },
          e(
            Link,
            { href: bookingUrl, style: styles.ctaButton },
            t("cta.view", lang)
          )
        ),

        // ----- Footer -----
        e(
          Section,
          { style: styles.footer },
          e(Text, { style: styles.footerText }, t("footer.operator", lang)),
          e(Text, { style: styles.footerText }, t("footer.ministry", lang)),
          e(
            Text,
            { style: styles.footerText },
            t("footer.contact", lang),
            " ",
            e(Link, { href: "mailto:bookings@nzzor.com", style: styles.footerLink }, "bookings@nzzor.com")
          ),
          e(
            Text,
            { style: { ...styles.footerText, marginTop: "16px" } },
            t("footer.unsubscribe_note", lang)
          )
        )
      )
    )
  );
}

module.exports = BookingEmail;
