// =============================================================================
// Nzzor — Admin Hotels & Rooms CRUD
// All routes protected by requireAuth + requireAdmin (applied in server.js mount)
// =============================================================================

const router = require("express").Router();
const { z } = require("zod");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const prisma = require("../utils/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { formatHotel } = require("../utils/helpers");
const { TAG_KEYS } = require("../utils/tags");
const { uploadHotelPhoto, deleteHotelPhoto, isR2Configured } = require("../utils/r2");

// In-memory upload — files are streamed straight to R2, never touch disk.
// Limit 8MB per file to keep uploads snappy and within R2 free-tier sanity.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

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
  // AI-search tags — filter to only known keys so the data stays clean
  tags: z.array(z.string()).optional().transform((arr) => (arr || []).filter((k) => TAG_KEYS.includes(k))),
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

// POST /api/admin/hotels/:id/photos/upload — upload a real file to R2
// multipart/form-data with field "photo"
router.post("/hotels/:id/photos/upload", upload.single("photo"), async (req, res, next) => {
  try {
    if (!isR2Configured()) {
      return res.status(503).json({
        error: "Photo upload is not configured on this server. Set R2_* env vars on the backend.",
      });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file received. Field must be named 'photo'." });
    }
    // look up hotel slug so we can organize files in R2: hotels/{slug}/{file}
    const hotel = await prisma.hotel.findUnique({
      where: { id: req.params.id },
      select: { id: true, slug: true },
    });
    if (!hotel) return res.status(404).json({ error: "Hotel not found" });

    const { url } = await uploadHotelPhoto(
      req.file.buffer,
      req.file.mimetype,
      hotel.slug,
    );

    const count = await prisma.hotelPhoto.count({ where: { hotelId: hotel.id } });
    const isPrimary = req.body && req.body.isPrimary === "true";
    if (isPrimary) {
      await prisma.hotelPhoto.updateMany({
        where: { hotelId: hotel.id },
        data: { isPrimary: false },
      });
    }
    const photo = await prisma.hotelPhoto.create({
      data: {
        hotelId: hotel.id,
        url,
        isPrimary: isPrimary || count === 0,
        sortOrder: count,
      },
    });
    res.status(201).json({ data: photo, message: "Photo uploaded" });
  } catch (err) {
    // multer file-too-large error has a specific code
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Image is too large. Max 8 MB." });
    }
    // surface the R2 module's clear errors directly to the client
    if (err && typeof err.message === "string" && (
      err.message.includes("Unsupported image type") ||
      err.message.includes("R2 storage is not configured")
    )) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// DELETE /api/admin/photos/:photoId — also remove from R2 if it's our file
router.delete("/photos/:photoId", async (req, res, next) => {
  try {
    const photo = await prisma.hotelPhoto.findUnique({
      where: { id: req.params.photoId },
    });
    if (photo) {
      // fire-and-forget R2 delete: don't block the API on storage cleanup
      deleteHotelPhoto(photo.url).catch(() => {});
      await prisma.hotelPhoto.delete({ where: { id: req.params.photoId } });
    }
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

// =============================================================================
// HOTEL PARTNER USERS — create/list/remove accounts that log into /partner
// =============================================================================

// list partner users for a hotel
router.get("/hotels/:id/managers", async (req, res, next) => {
  try {
    const links = await prisma.hotelManager.findMany({
      where: { hotelId: req.params.id },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, isActive: true, createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: links.map((l) => ({ linkId: l.id, ...l.user })) });
  } catch (err) { next(err); }
});

const partnerUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  // accept empty string OR a real name — frontend always sends a string
  firstName: z.string().optional().nullable().transform((v) => (v && v.trim()) || null),
  lastName: z.string().optional().nullable().transform((v) => (v && v.trim()) || null),
});

// create a partner user and link to this hotel (or link an existing user)
router.post("/hotels/:id/managers", async (req, res, next) => {
  try {
    const data = partnerUserSchema.parse(req.body);
    const hotel = await prisma.hotel.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!hotel) return res.status(404).json({ error: "Hotel not found" });

    let user = await prisma.user.findUnique({ where: { email: data.email } });
    if (user) {
      // existing user — promote to HOTEL_MANAGER if customer, otherwise leave role
      if (user.role === "CUSTOMER") {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { role: "HOTEL_MANAGER" },
        });
      }
    } else {
      const passwordHash = await bcrypt.hash(data.password, 12);
      user = await prisma.user.create({
        data: {
          email: data.email,
          passwordHash,
          role: "HOTEL_MANAGER",
          firstName: data.firstName || null,
          lastName: data.lastName || null,
        },
      });
    }

    // link (idempotent via unique constraint)
    try {
      await prisma.hotelManager.create({ data: { userId: user.id, hotelId: hotel.id } });
    } catch (e) {
      // already linked is fine
      if (e.code !== "P2002") throw e;
    }
    res.status(201).json({
      data: {
        id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
      },
    });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// unlink a partner user from a hotel
router.delete("/hotels/:id/managers/:userId", async (req, res, next) => {
  try {
    await prisma.hotelManager.deleteMany({
      where: { hotelId: req.params.id, userId: req.params.userId },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// reset a partner user's password (admin-controlled — for when partners
// forget their password and call Allouni for help)
const resetPasswordSchema = z.object({
  newPassword: z.string().min(6),
});
router.post("/hotels/:id/managers/:userId/reset-password", async (req, res, next) => {
  try {
    const { newPassword } = resetPasswordSchema.parse(req.body);
    // confirm this user is actually linked to this hotel — prevents admins
    // from resetting passwords of users they aren't managing through this hotel
    const link = await prisma.hotelManager.findUnique({
      where: { userId_hotelId: { userId: req.params.userId, hotelId: req.params.id } },
    });
    if (!link) return res.status(404).json({ error: "Partner not linked to this hotel" });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.params.userId },
      data: { passwordHash },
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

module.exports = router;
