// =============================================================================
// Nzzor — Admin Hotels & Rooms CRUD
// All routes protected by requireAuth + requireAdmin (applied in server.js mount)
// =============================================================================

const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { formatHotel } = require("../utils/helpers");

router.use(requireAuth, requireAdmin);

const HOTEL_INCLUDE = {
  rooms: { orderBy: { sortOrder: "asc" }, include: { photos: true } },
  photos: { orderBy: { sortOrder: "asc" } },
  amenities: { include: { amenity: true } },
};

// slugify helper
function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// HOTELS
// ---------------------------------------------------------------------------

const hotelSchema = z.object({
  nameEn: z.string().min(1), nameFr: z.string().min(1), nameAr: z.string().min(1),
  descEn: z.string().default(""), descFr: z.string().default(""), descAr: z.string().default(""),
  stars: z.number().int().min(1).max(5),
  city: z.string().min(1),
  cityEn: z.string().min(1), cityFr: z.string().min(1), cityAr: z.string().min(1),
  regionEn: z.string().default(""), regionFr: z.string().default(""), regionAr: z.string().default(""),
  address: z.string().optional(),
  latitude: z.number().optional(), longitude: z.number().optional(),
  checkInTime: z.string().default("14:00"),
  checkOutTime: z.string().default("12:00"),
  cancellationHours: z.number().int().default(48),
  childrenAllowed: z.boolean().default(true),
  petsAllowed: z.boolean().default(false),
  parkingFree: z.boolean().default(true),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  instantConfirmation: z.boolean().default(true),
  verifiedPartner: z.boolean().default(true),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
});

// GET /api/admin/hotels — full list (admin view: includes inactive)
router.get("/hotels", async (req, res, next) => {
  try {
    const hotels = await prisma.hotel.findMany({
      include: HOTEL_INCLUDE,
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    });
    res.json({ data: hotels.map((h) => formatHotel(h, req.query.lang || "en")) });
  } catch (err) { next(err); }
});

// GET /api/admin/hotels/:id — single hotel (admin view, raw-ish)
router.get("/hotels/:id", async (req, res, next) => {
  try {
    const hotel = await prisma.hotel.findUnique({
      where: { id: req.params.id },
      include: HOTEL_INCLUDE,
    });
    if (!hotel) return res.status(404).json({ error: "Hotel not found" });
    res.json({ data: hotel });
  } catch (err) { next(err); }
});

// POST /api/admin/hotels — create
router.post("/hotels", async (req, res, next) => {
  try {
    const data = hotelSchema.parse(req.body);
    let slug = slugify(data.nameEn);
    // ensure unique slug
    let n = 1;
    while (await prisma.hotel.findUnique({ where: { slug } })) {
      slug = `${slugify(data.nameEn)}-${++n}`;
    }
    const hotel = await prisma.hotel.create({
      data: { ...data, slug, contactEmail: data.contactEmail || null },
      include: HOTEL_INCLUDE,
    });
    res.status(201).json({ data: hotel, message: "Hotel created" });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    next(err);
  }
});

// PUT /api/admin/hotels/:id — update
router.put("/hotels/:id", async (req, res, next) => {
  try {
    const data = hotelSchema.partial().parse(req.body);
    if (data.contactEmail === "") data.contactEmail = null;
    const hotel = await prisma.hotel.update({
      where: { id: req.params.id },
      data,
      include: HOTEL_INCLUDE,
    });
    res.json({ data: hotel, message: "Hotel updated" });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    next(err);
  }
});

// DELETE /api/admin/hotels/:id — soft delete (set inactive)
router.delete("/hotels/:id", async (req, res, next) => {
  try {
    const hard = req.query.hard === "true";
    if (hard) {
      await prisma.hotel.delete({ where: { id: req.params.id } });
      return res.json({ message: "Hotel permanently deleted" });
    }
    await prisma.hotel.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: "Hotel deactivated" });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PHOTOS
// ---------------------------------------------------------------------------

// POST /api/admin/hotels/:id/photos — add a photo (by URL)
router.post("/hotels/:id/photos", async (req, res, next) => {
  try {
    const { url, isPrimary } = req.body;
    if (!url) return res.status(400).json({ error: "Photo url required" });
    const count = await prisma.hotelPhoto.count({ where: { hotelId: req.params.id } });
    if (isPrimary) {
      await prisma.hotelPhoto.updateMany({
        where: { hotelId: req.params.id },
        data: { isPrimary: false },
      });
    }
    const photo = await prisma.hotelPhoto.create({
      data: {
        hotelId: req.params.id, url,
        isPrimary: Boolean(isPrimary) || count === 0,
        sortOrder: count,
      },
    });
    res.status(201).json({ data: photo, message: "Photo added" });
  } catch (err) { next(err); }
});

// DELETE /api/admin/photos/:photoId
router.delete("/photos/:photoId", async (req, res, next) => {
  try {
    await prisma.hotelPhoto.delete({ where: { id: req.params.photoId } });
    res.json({ message: "Photo removed" });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// ROOMS
// ---------------------------------------------------------------------------

const roomSchema = z.object({
  typeEn: z.string().min(1), typeFr: z.string().min(1), typeAr: z.string().min(1),
  descEn: z.string().optional(), descFr: z.string().optional(), descAr: z.string().optional(),
  capacity: z.number().int().min(1),
  sizeSqm: z.number().int().optional(),
  bedType: z.string().min(1),
  basePrice: z.number().int().min(0),
  totalUnits: z.number().int().min(1).default(1),
  isActive: z.boolean().default(true),
});

// POST /api/admin/hotels/:id/rooms — add room to a hotel
router.post("/hotels/:id/rooms", async (req, res, next) => {
  try {
    const data = roomSchema.parse(req.body);
    const hotel = await prisma.hotel.findUnique({ where: { id: req.params.id } });
    if (!hotel) return res.status(404).json({ error: "Hotel not found" });
    const count = await prisma.room.count({ where: { hotelId: req.params.id } });
    const room = await prisma.room.create({
      data: { ...data, hotelId: req.params.id, sortOrder: count },
    });
    res.status(201).json({ data: room, message: "Room added" });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    next(err);
  }
});

// PUT /api/admin/rooms/:roomId — update room
router.put("/rooms/:roomId", async (req, res, next) => {
  try {
    const data = roomSchema.partial().parse(req.body);
    const room = await prisma.room.update({
      where: { id: req.params.roomId },
      data,
    });
    res.json({ data: room, message: "Room updated" });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    next(err);
  }
});

// DELETE /api/admin/rooms/:roomId
router.delete("/rooms/:roomId", async (req, res, next) => {
  try {
    const hard = req.query.hard === "true";
    if (hard) {
      await prisma.room.delete({ where: { id: req.params.roomId } });
      return res.json({ message: "Room permanently deleted" });
    }
    await prisma.room.update({
      where: { id: req.params.roomId },
      data: { isActive: false },
    });
    res.json({ message: "Room deactivated" });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// AMENITIES (reference list, for the hotel form)
// ---------------------------------------------------------------------------

// GET /api/admin/amenities — all amenities
router.get("/amenities", async (req, res, next) => {
  try {
    const amenities = await prisma.amenity.findMany({ orderBy: { category: "asc" } });
    res.json({ data: amenities });
  } catch (err) { next(err); }
});

// PUT /api/admin/hotels/:id/amenities — set a hotel's amenities (array of amenity keys)
router.put("/hotels/:id/amenities", async (req, res, next) => {
  try {
    const { keys } = req.body; // array of amenity keys
    if (!Array.isArray(keys)) return res.status(400).json({ error: "keys must be an array" });
    const amenities = await prisma.amenity.findMany({ where: { key: { in: keys } } });
    // clear existing, then set
    await prisma.hotelAmenity.deleteMany({ where: { hotelId: req.params.id } });
    await prisma.hotelAmenity.createMany({
      data: amenities.map((a) => ({ hotelId: req.params.id, amenityId: a.id })),
      skipDuplicates: true,
    });
    res.json({ message: "Amenities updated", count: amenities.length });
  } catch (err) { next(err); }
});

module.exports = router;
