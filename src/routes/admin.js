const router = require("express").Router();
const prisma = require("../utils/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { formatBooking, paginate } = require("../utils/helpers");

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

router.get("/bookings", async (req, res, next) => {
  try {
    const { skip, take, page, limit } = paginate(req.query);
    const lang = req.query.lang || "en";

    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.hotelId) where.hotelId = req.query.hotelId;
    if (req.query.from) where.createdAt = { gte: new Date(req.query.from) };

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
    const { status } = req.body;
    const validStatuses = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "REFUNDED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }
    const booking = await prisma.booking.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(status === "CONFIRMED" ? { confirmedAt: new Date() } : {}),
        ...(status === "CANCELLED" ? { cancelledAt: new Date() } : {}),
      },
      include: { hotel: true, rooms: { include: { room: true } } },
    });
    res.json({ data: formatBooking(booking), message: `Booking status updated to ${status}` });
  } catch (err) { next(err); }
});

module.exports = router;
