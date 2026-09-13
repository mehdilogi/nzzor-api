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

// Price facet resolution. 2 500 DZD reads as a natural step in this market and
// gives a usable number of bars across the range the catalogue occupies.
const PRICE_BUCKET = 2500;

// The star values offered as filters. The filter is "N and up", so the facet
// count for each is cumulative — see starFacets below.
const STAR_CHOICES = [2, 3, 4, 5];

// ---------------------------------------------------------------------------
// Shared filter builder
// ---------------------------------------------------------------------------
// The listing and the facets endpoint MUST agree on what a filter means, or
// the counts shown beside an option will not match what selecting it returns.
// One builder, with an `omit` set for facet queries that need to exclude their
// own dimension.
function buildWhere(query, omit = []) {
  const skip = (d) => omit.includes(d);
  const where = { isActive: true };

  if (query.city && !skip("city")) where.city = String(query.city).toLowerCase();
  if (query.stars && !skip("stars")) where.stars = { gte: parseInt(query.stars) };
  if (query.featured === "true") where.isFeatured = true;

  // Tags can arrive as a comma-separated string ("beach,family") or as repeated
  // params (?tags=beach&tags=family). A hotel must match ALL requested tags.
  if (query.tags && !skip("tags")) {
    const tagList = Array.isArray(query.tags)
      ? query.tags
      : String(query.tags).split(",").map((s) => s.trim()).filter(Boolean);
    if (tagList.length) where.tags = { hasEvery: tagList };
  }

  if ((query.minPrice || query.maxPrice) && !skip("price")) {
    where.rooms = {
      some: {
        isActive: true,
        basePrice: {
          ...(query.minPrice ? { gte: parseInt(query.minPrice) } : {}),
          ...(query.maxPrice ? { lte: parseInt(query.maxPrice) } : {}),
        },
      },
    };
  }

  if (query.q) {
    const q = query.q;
    where.OR = [
      { nameEn: { contains: q, mode: "insensitive" } },
      { nameFr: { contains: q, mode: "insensitive" } },
      { nameAr: { contains: q } },
      { cityEn: { contains: q, mode: "insensitive" } },
      { cityFr: { contains: q, mode: "insensitive" } },
      { cityAr: { contains: q } },
    ];
  }

  return where;
}

// GET /api/hotels — Search & list
router.get("/", async (req, res, next) => {
  try {
    const lang = req.query.lang || "en";
    const { skip, take, page, limit } = paginate(req.query, LIST_MAX_LIMIT);

    const where = buildWhere(req.query);

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

// GET /api/hotels/meta/facets — counts for every filter option
// ---------------------------------------------------------------------------
// Takes the same query parameters as the listing and answers "how many hotels
// would I get if I picked this?" for each option, so the sidebar can show a
// real number beside every row instead of nothing.
//
// The semantics differ per control, deliberately:
//
//   stars — single choice, so its own value is EXCLUDED from the base set.
//           Otherwise picking ★★★★ would make every other star count read 0.
//           Counts are cumulative because the filter is "N and up".
//   price — same reasoning: the range excludes itself, or the histogram would
//           collapse to the bars already selected.
//   tags  — multi-select and ANDed, so the base set KEEPS the current tags.
//           The count answers "how many remain if I add this one too", which
//           is what stops a guest picking a combination that returns nothing.
//
// Cost: three queries over the active catalogue. At ~220 hotels that is
// nothing. If the catalogue reaches five figures, the tag and price tallies
// should move into SQL (unnest for tags, a width_bucket for price) rather than
// being counted in JS.
router.get("/meta/facets", async (req, res, next) => {
  try {
    const [starGroups, tagRows, priceRows, total] = await Promise.all([
      // stars: own dimension excluded
      prisma.hotel.groupBy({
        by: ["stars"],
        where: buildWhere(req.query, ["stars"]),
        _count: { _all: true },
      }),
      // tags: current selection kept
      prisma.hotel.findMany({
        where: buildWhere(req.query),
        select: { tags: true },
      }),
      // price: own dimension excluded
      prisma.hotel.findMany({
        where: buildWhere(req.query, ["price"]),
        select: { rooms: { where: { isActive: true }, select: { basePrice: true } } },
      }),
      prisma.hotel.count({ where: buildWhere(req.query) }),
    ]);

    // "N and up", so walk down from the highest star value accumulating.
    const byStar = new Map(starGroups.map((g) => [g.stars, g._count._all]));
    const starsTotal = starGroups.reduce((n, g) => n + g._count._all, 0);
    const stars = {};
    let running = 0;
    for (const value of [...STAR_CHOICES].sort((a, b) => b - a)) {
      running += byStar.get(value) || 0;
      stars[value] = running;
    }

    const tags = {};
    for (const row of tagRows) {
      for (const key of row.tags || []) tags[key] = (tags[key] || 0) + 1;
    }

    // priceFrom is the cheapest active room, which is what the card shows and
    // what the filter matches on. A hotel with no active room has no price and
    // is left out of the histogram rather than counted at zero.
    const minima = priceRows
      .map((h) => h.rooms.map((r) => r.basePrice).filter((p) => typeof p === "number" && p > 0))
      .filter((prices) => prices.length > 0)
      .map((prices) => Math.min(...prices));

    const maxPrice = minima.length ? Math.max(...minima) : 0;
    const ceiling = Math.max(PRICE_BUCKET, Math.ceil(maxPrice / PRICE_BUCKET) * PRICE_BUCKET);
    const bucketCount = ceiling / PRICE_BUCKET;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      from: i * PRICE_BUCKET,
      to: (i + 1) * PRICE_BUCKET,
      count: 0,
    }));
    for (const price of minima) {
      // Clamp so the top of the range lands in the last bucket rather than
      // past the end of the array.
      const i = Math.min(bucketCount - 1, Math.floor(price / PRICE_BUCKET));
      buckets[i].count += 1;
    }

    res.json({
      data: {
        total,
        stars,
        starsAny: starsTotal,
        tags,
        price: {
          min: minima.length ? Math.min(...minima) : 0,
          max: ceiling,
          bucket: PRICE_BUCKET,
          buckets,
        },
      },
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
// Must stay BELOW every /meta/* route: Express matches in declaration order,
// and this pattern would otherwise swallow "meta" as a slug.
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
