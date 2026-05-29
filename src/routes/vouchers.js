// =============================================================================
// vouchers route — public GET endpoint for voucher PDFs
// -----------------------------------------------------------------------------
// GET /api/bookings/:reference/voucher.pdf?lang=fr
//
// Returns the PDF as an attachment. No auth — the booking reference itself
// is the authorization (it's unguessable, 8 chars from a base32-style
// alphabet, ~10^12 combinations).
//
// We allow CONFIRMED, PENDING, CANCELLED, EXPIRED, COMPLETED. The PDF
// shows the current status clearly. Even a cancelled-booking voucher is
// useful — guests need them for travel-insurance claims.
//
// What we DON'T return a voucher for: a booking that never existed. 404.
// =============================================================================

const router = require("express").Router({ mergeParams: true });
const prisma = require("../utils/prisma");
const { formatBooking } = require("../utils/helpers");
const { generateVoucherPdf } = require("../services/voucherService");

// Mounted at /api/bookings, so this becomes /api/bookings/:reference/voucher.pdf
router.get("/:reference/voucher.pdf", async (req, res, next) => {
  try {
    const reference = (req.params.reference || "").toUpperCase();
    const lang = (req.query.lang || "fr").toLowerCase();

    if (!["en", "fr", "ar"].includes(lang)) {
      return res.status(400).json({ error: "Invalid lang (en, fr, ar)" });
    }

    const booking = await prisma.booking.findUnique({
      where: { reference },
      include: {
        hotel: true,
        rooms: { include: { room: true } },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const formatted = formatBooking(booking, lang);
    const pdfBuffer = await generateVoucherPdf(formatted, lang);

    // Set headers — attachment forces download in browsers; some users
    // will still preview inline depending on browser settings, which is
    // fine. Filename includes the reference so saved files are findable.
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="nzzor-${reference}.pdf"`
    );
    res.setHeader("Content-Length", pdfBuffer.length);
    // Cache for 5 min privately — vouchers can change (status updates,
    // payment events). Don't cache publicly because each one is different.
    res.setHeader("Cache-Control", "private, max-age=300");

    res.send(pdfBuffer);
  } catch (err) {
    console.error("[voucher] generation failed:", err);
    next(err);
  }
});

module.exports = router;
