const router = require("express").Router();
const prisma = require("../utils/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { formatBooking, paginate } = require("../utils/helpers");
const bookingService = require("../services/bookingService");
const { startOfTodayInAlgiers, endOfTodayInAlgiers } = require("../utils/dates");

router.use(requireAuth, requireAdmin);

router.get("/dashboard", async (req, res, next) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalHotels, totalRooms, totalBookings, recentBookings,
      bookingsByStatus, revenueTotal, revenueLast30, revenueLast7, topHotels,
    ] = await Promise.all([
      prisma.hotel.count({ where: { isActive: true } }),
      prisma.room.count({ where: { isActive: true } }),
      prisma.booking.count(),
      prisma.booking.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.booking.groupBy({ by: ["status"], _count: { id: true } }),
      prisma.booking.aggregate({ where: { status: { in: ["CONFIRMED", "COMPLETED"] } }, _sum: { total: true } }),
      prisma.booking.aggregate({ where: { status: { in: ["CONFIRMED", "COMPLETED"] }, createdAt: { gte: thirtyDaysAgo } }, _sum: { total: true } }),
      prisma.booking.aggregate({ where: { status: { in: ["CONFIRMED", "COMPLETED"] }, createdAt: { gte: sevenDaysAgo } }, _sum: { total: true } }),
      prisma.booking.groupBy({
        by: ["hotelId"],
        where: { status: { in: ["CONFIRMED", "COMPLETED"] } },
        _count: { id: true },
        _sum: { total: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      }),
    ]);

    const hotelIds = topHotels.map(t => t.hotelId);
    const hotels = await prisma.hotel.findMany({
      where: { id: { in: hotelIds } },
      select: { id: true, nameEn: true, nameFr: true, slug: true },
    });
    const hotelMap = Object.fromEntries(hotels.map(h => [h.id, h]));

    res.json({
      data: {
        hotels: { total: totalHotels, totalRooms },
        bookings: {
          total: totalBookings,
          last7Days: recentBookings,
          byStatus: Object.fromEntries(bookingsByStatus.map(b => [b.status, b._count.id])),
        },
        revenue: {
          total: revenueTotal._sum.total || 0,
          last30Days: revenueLast30._sum.total || 0,
          last7Days: revenueLast7._sum.total || 0,
          currency: "DZD",
        },
        topHotels: topHotels.map(t => ({
          hotel: hotelMap[t.hotelId]?.nameEn || "Unknown",
          slug: hotelMap[t.hotelId]?.slug,
          bookings: t._count.id,
          revenue: t._sum.total || 0,
        })),
      },
    });
  } catch (err) { next(err); }
});

// =============================================================================
// GET /api/admin/today — Today's activity feed
// -----------------------------------------------------------------------------
// Powers the "Today's activity" panel on the admin overview tab. Returns
// summary counts plus a short list of recent state transitions so the team
// can see at a glance "what happened on the platform today" without
// scrolling the full bookings list.
//
// "Today" is computed in ALGIERS local time so the counts feel correct to
// staff in Algeria regardless of where Railway physically runs the server.
//
// Item #7 from the polish queue. We deliberately query the existing
// bookings table by timestamps (createdAt / confirmedAt / cancelledAt)
// rather than introducing a separate booking_events audit-log table —
// it's simpler, requires no schema migration, and covers 95% of what an
// operations team needs. If we later want a full audit trail of every
// state change with actor info, that's a separate feature.
// =============================================================================
router.get("/today", async (req, res, next) => {
  try {
    const lang = req.query.lang || "en";
    const start = startOfTodayInAlgiers();
    const end = endOfTodayInAlgiers();
    const todayWindow = { gte: start, lte: end };

    // Run all the count queries in parallel — they're independent.
    const [
      createdToday,
      confirmedToday,
      cancelledToday,
      paidTodayRevenue,
      recentTransitions,
    ] = await Promise.all([
      prisma.booking.count({ where: { createdAt: todayWindow } }),
      prisma.booking.count({ where: { confirmedAt: todayWindow } }),
      prisma.booking.count({ where: { cancelledAt: todayWindow } }),
      // Revenue locked in today via confirmations
      prisma.booking.aggregate({
        where: { confirmedAt: todayWindow, status: "CONFIRMED" },
        _sum: { total: true },
      }),
      // Latest ~15 bookings touched today, regardless of which lifecycle
      // event happened. We compute the per-row "kind" client-side from the
      // timestamps so we can show "what changed" without separate queries.
      prisma.booking.findMany({
        where: {
          OR: [
            { createdAt: todayWindow },
            { confirmedAt: todayWindow },
            { cancelledAt: todayWindow },
          ],
        },
        include: { hotel: true, rooms: { include: { room: true } } },
        orderBy: { updatedAt: "desc" },
        take: 15,
      }),
    ]);

    // Annotate each recent transition with the LATEST event we know about
    // (the timestamp most recently touched). The frontend renders this as
    // "10:42 · Royal Maqam booking NZR-XX confirmed".
    const events = recentTransitions.map((b) => {
      const tCreated   = b.createdAt   && b.createdAt   >= start && b.createdAt   <= end ? b.createdAt   : null;
      const tConfirmed = b.confirmedAt && b.confirmedAt >= start && b.confirmedAt <= end ? b.confirmedAt : null;
      const tCancelled = b.cancelledAt && b.cancelledAt >= start && b.cancelledAt <= end ? b.cancelledAt : null;

      // Pick the LATEST among the three to decide "what happened most recently"
      let kind = "created";
      let at = tCreated;
      if (tCancelled && (!at || tCancelled > at)) { kind = b.status === "REJECTED" ? "rejected" : "cancelled"; at = tCancelled; }
      if (tConfirmed && (!at || tConfirmed > at)) { kind = "confirmed"; at = tConfirmed; }

      return {
        ...formatBooking(b, lang),
        event: {
          kind,
          at: at?.toISOString() || b.updatedAt?.toISOString() || null,
        },
      };
    });

    res.json({
      data: {
        counts: {
          created: createdToday,
          confirmed: confirmedToday,
          cancelled: cancelledToday,
          revenueConfirmed: paidTodayRevenue._sum.total || 0,
          currency: "DZD",
        },
        events,
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
      },
    });
  } catch (err) { next(err); }
});

router.get("/bookings", async (req, res, next) => {
  try {
    const { skip, take, page, limit } = paginate(req.query);
    const lang = req.query.lang || "en";

    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
    if (req.query.hotelId) where.hotelId = req.query.hotelId;

    // Date range on createdAt — supports `from`, `to`, or both. Both come
    // as YYYY-MM-DD strings from the frontend filter UI.
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(req.query.from);
      if (req.query.to) {
        // End of day for the `to` value so the user's selection is inclusive.
        const to = new Date(req.query.to);
        to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }

    // Search across reference + guest name + guest email. Case-insensitive
    // substring match. We OR the four fields together so a single search
    // term ("ahmed" or "NZR-A3BX" or "ahmed@gmail.com") finds matches in
    // any of them. Prisma's `mode: "insensitive"` requires Postgres which
    // we already use, so this is safe.
    const q = (req.query.search || req.query.q || "").trim();
    if (q) {
      where.OR = [
        { reference:       { contains: q, mode: "insensitive" } },
        { guestFirstName:  { contains: q, mode: "insensitive" } },
        { guestLastName:   { contains: q, mode: "insensitive" } },
        { guestEmail:      { contains: q, mode: "insensitive" } },
      ];
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: { hotel: true, rooms: { include: { room: true } } },
        orderBy: { createdAt: "desc" },
        skip, take,
      }),
      prisma.booking.count({ where }),
    ]);

    res.json({
      data: bookings.map(b => formatBooking(b, lang)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

router.get("/bookings/:id", async (req, res, next) => {
  try {
    const lang = req.query.lang || "en";
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: {
        hotel: true,
        rooms: { include: { room: true } },
      },
    });
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    res.json({ data: formatBooking(booking, lang) });
  } catch (err) { next(err); }
});

router.patch("/bookings/:id/status", async (req, res, next) => {
  try {
    const { status, reason } = req.body;
    const validStatuses = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "REFUNDED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    // Hand off to bookingService. It reads the previous status, performs the
    // update atomically, and fires the right email if (and only if) this is
    // a real state transition. No duplicate emails on no-op writes.
    const formatted = await bookingService.transitionBookingStatus({
      bookingId: req.params.id,
      newStatus: status,
      actor: "admin",
      reason,
    });

    res.json({ data: formatted, message: `Booking status updated to ${status}` });
  } catch (err) {
    // bookingService throws { statusCode: 404, message } for not-found.
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/admin/bookings/:id/payment
// Mark the booking's payment status. Used by the Allouni team once cash has
// been counted on arrival, a bank transfer has cleared, or a CIB charge has
// been captured. Fires the "paid" receipt email on PENDING/FAILED → PAID.
//
// Body: { paymentStatus: "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED" }
router.patch("/bookings/:id/payment", async (req, res, next) => {
  try {
    const { paymentStatus } = req.body;
    const validPaymentStatuses = ["PENDING", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"];
    if (!validPaymentStatuses.includes(paymentStatus)) {
      return res.status(400).json({
        error: `Invalid paymentStatus. Must be one of: ${validPaymentStatuses.join(", ")}`,
      });
    }

    const formatted = await bookingService.transitionBookingPayment({
      bookingId: req.params.id,
      newPaymentStatus: paymentStatus,
      actor: "admin",
    });

    res.json({ data: formatted, message: `Payment status updated to ${paymentStatus}` });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// =============================================================================
// CUSTOMER USERS — admin view of registered customer accounts
// -----------------------------------------------------------------------------
// Read-only for v1. List has search, pagination, and aggregates (booking
// count, lifetime spend). Detail includes the user's full booking history.
//
// We intentionally do NOT expose: password hashes, password reset tokens,
// IP/user-agent metadata, or audit fields beyond createdAt/lastLoginAt.
// Destructive actions (delete, disable, edit) are deferred to a future
// wave when we have a clear policy + audit logging.
// =============================================================================
router.get("/users", async (req, res, next) => {
  try {
    const { skip, take, page, limit } = paginate(req.query);

    // Filter to CUSTOMER role only. The User table also holds ADMIN and
    // hotel-manager accounts which shouldn't show in the customer list.
    const where = { role: "CUSTOMER" };

    // Search across name + email + phone, case-insensitive.
    const q = (req.query.search || req.query.q || "").trim();
    if (q) {
      where.OR = [
        { email:     { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName:  { contains: q, mode: "insensitive" } },
        { phone:     { contains: q, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip, take,
        // Project only fields we want to surface — never select
        // passwordHash, passwordResetTokenHash, or passwordResetExpiresAt.
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          preferredLang: true,
          emailVerified: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    // ---- Booking aggregates per user ---------------------------------------
    // We MUST count via the email-ownership rule that the detail endpoint
    // and the /account/bookings endpoint use: a booking belongs to a user
    // if `userId === user.id` OR `guestEmail === user.email` (case-
    // insensitive). The previous implementation used `_count: { bookings }`
    // which only counts FK-linked bookings — that misses every guest-
    // checkout booking the user made BEFORE signing up. Result: list said
    // "0 bookings" for a user whose detail panel correctly showed 8.
    //
    // Strategy: fetch all bookings that match EITHER condition in a single
    // query, then aggregate in JS by user. For the typical admin view (~25
    // users per page) this is fast and avoids Prisma's lack of complex
    // groupBy support for OR-joined relationships.
    const userIds = users.map((u) => u.id);
    const userEmails = users.map((u) => (u.email || "").toLowerCase());
    let bookingsCountByUser = {};
    let revenueByUser = {};
    if (userIds.length > 0) {
      // Pull just the fields we need (no rooms or hotels) to keep it light.
      // We project guestEmail and userId so we can match each booking back
      // to its user in JS. `mode: insensitive` matches Postgres ILIKE, which
      // is what we want — emails are case-insensitive identifiers.
      const matching = await prisma.booking.findMany({
        where: {
          OR: [
            { userId: { in: userIds } },
            { guestEmail: { in: userEmails, mode: "insensitive" } },
          ],
        },
        select: {
          userId: true,
          guestEmail: true,
          status: true,
          total: true,
        },
      });

      // Build email → userId reverse lookup so we can match guest bookings
      // back to the right user even when userId is null.
      const emailToUserId = Object.fromEntries(
        users.map((u) => [(u.email || "").toLowerCase(), u.id])
      );

      for (const b of matching) {
        const uid =
          b.userId && userIds.includes(b.userId)
            ? b.userId
            : emailToUserId[(b.guestEmail || "").toLowerCase()];
        if (!uid) continue;

        // All bookings count toward bookingsCount (regardless of status).
        bookingsCountByUser[uid] = (bookingsCountByUser[uid] || 0) + 1;

        // Only confirmed/completed bookings count toward lifetime revenue —
        // pending bookings haven't been paid, cancelled/rejected don't
        // belong in spend totals.
        if (b.status === "CONFIRMED" || b.status === "COMPLETED") {
          revenueByUser[uid] = (revenueByUser[uid] || 0) + Number(b.total || 0);
        }
      }
    }

    const data = users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      preferredLang: u.preferredLang,
      emailVerified: u.emailVerified,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      bookingsCount: bookingsCountByUser[u.id] || 0,
      lifetimeRevenue: revenueByUser[u.id] || 0,
    }));

    res.json({
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

router.get("/users/:id", async (req, res, next) => {
  try {
    const lang = req.query.lang || "en";

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        preferredLang: true,
        emailVerified: true,
        phoneVerified: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        role: true,
      },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Fetch the user's bookings. We use the same OR rule that account.js
    // uses for the customer-facing /account/bookings endpoint — userId
    // match OR email match — so guest bookings made before signup also
    // appear under the user's history.
    const bookings = await prisma.booking.findMany({
      where: {
        OR: [
          { userId: user.id },
          { guestEmail: { equals: user.email, mode: "insensitive" } },
        ],
      },
      include: { hotel: true, rooms: { include: { room: true } } },
      orderBy: { createdAt: "desc" },
      take: 100, // generous cap — most users will have <10
    });

    res.json({
      data: {
        ...user,
        bookings: bookings.map((b) => formatBooking(b, lang)),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
