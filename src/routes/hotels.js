const router = require("express").Router();
const prisma = require("../utils/prisma");
const { formatHotel, formatHotelCard, paginate } = require("../utils/helpers");

const HOTEL_INCLUDE = {
  rooms: { where: { isActive: true }, orderBy: { sortOrder: "asc" }, include: { photos: true } },
  photos: { orderBy: { sortOrder: "asc" } },
  amenities: { include: { amenity: true } },
};

// What the listing grid actually needs. The full include above pulls every
// room with its own photos and every amenity joined to its dictionary row —
// for 24 hotels that is thousands of rows fetched to render a card that shows
// a name, a city, a rating and a price.
//
// Photos are capped at five with the primary first: that is what the card's
// carousel shows, and twenty URLs per hotel is most of the response body.
// Rooms are reduced to basePrice, which is all priceFrom is computed from.
const LIST_INCLUDE = {
  rooms: { where: { isActive: true }, select: { basePrice: true } },
  photos: {
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
    take: 5,
    select: { id: true, url: true, isPrimary: true },
  },
};

// The listing accumulates pages client-side, and a back-navigation restores
// them in a single request, so this route needs a higher ceiling than the
// 50 that suits every other caller.
const LIST_MAX_LIMIT = 200;

// GET /api/hotels — Search & list
router.get("/", async (req, res, next) => {
  try {
    const lang = req.query.lang || "en";
    const { skip, take, page, limit } = paginate(req.query, LIST_MAX_LIMIT);

    const where = { isActive: true };

    if (req.query.city) where.city = req.query.city.toLowerCase();
    if (req.query.stars) where.stars = { gte: parseInt(req.query.stars) };
    if (req.query.featured === "true") where.isFeatured = true;
    // Tags can arrive as a comma-separated string ("beach,family") or as repeated
    // params (?tags=beach&tags=family). A hotel must match ALL requested tags.
    if (req.query.tags) {
      const tagList = Array.isArray(req.query.tags)
        ? req.query.tags
        : String(req.query.tags).split(",").map((s) => s.trim()).filter(Boolean);
      if (tagList.length) where.tags = { hasEvery: tagList };
    }
    if (req.query.minPrice || req.query.maxPrice) {
      where.rooms = {
        some: {
          isActive: true,
          basePrice: {
            ...(req.query.minPrice ? { gte: parseInt(req.query.minPrice) } : {}),
            ...(req.query.maxPrice ? { lte: parseInt(req.query.maxPrice) } : {}),
          },
        },
      };
    }

    if (req.query.q) {
      const q = req.query.q;
      where.OR = [
        { nameEn: { contains: q, mode: "insensitive" } },
        { nameFr: { contains: q, mode: "insensitive" } },
        { nameAr: { contains: q } },
        { cityEn: { contains: q, mode: "insensitive" } },
        { cityFr: { contains: q, mode: "insensitive" } },
        { cityAr: { contains: q } },
      ];
    }

    let orderBy;
    switch (req.query.sort) {
      case "price_asc": orderBy = { rooms: { _min: { basePrice: "asc" } } }; break;
      case "price_desc": orderBy = { rooms: { _min: { basePrice: "desc" } } }; break;
      case "rating": orderBy = { rating: "desc" }; break;
      case "stars": orderBy = { stars: "desc" }; break;
      default: orderBy = [{ isFeatured: "desc" }, { reviewCount: "desc" }];
    }

    const [hotels, total] = await Promise.all([
      prisma.hotel.findMany({ where, include: LIST_INCLUDE, orderBy, skip, take }),
      prisma.hotel.count({ where }),
    ]);

    res.json({
      data: hotels.map(h => formatHotelCard(h, lang)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// GET /api/hotels/meta/cities
router.get("/meta/cities", async (req, res, next) => {
  try {
    const lang = req.query.lang || "en";
    const cities = await prisma.hotel.groupBy({
      by: ["city", "cityEn", "cityFr", "cityAr"],
      where: { isActive: true },
      _count: { id: true },
    });
    res.json({
      data: cities.map(c => ({
        key: c.city,
        name: c[`city${lang.charAt(0).toUpperCase() + lang.slice(1)}`] || c.cityEn,
        hotelCount: c._count.id,
      })),
    });
  } catch (err) { next(err); }
});

// GET /api/hotels/meta/tags — the canonical tag dictionary
router.get("/meta/tags", async (req, res, next) => {
  try {
    const { TAGS } = require("../utils/tags");
    res.json({ data: TAGS });
  } catch (err) { next(err); }
});

// GET /api/hotels/:slug
router.get("/:slug", async (req, res, next) => {
  try {
    const lang = req.query.lang || "en";
    const hotel = await prisma.hotel.findUnique({
      where: { slug: req.params.slug },
      include: HOTEL_INCLUDE,
    });
    if (!hotel || !hotel.isActive) {
      return res.status(404).json({ error: "Hotel not found" });
    }
    res.json({ data: formatHotel(hotel, lang) });
  } catch (err) { next(err); }
});

module.exports = router;
