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
const { uploadHotelPhoto, uploadRoomPhoto, deleteHotelPhoto, deletePhotoByUrl, isR2Configured } = require("../utils/r2");

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

// Normalization helpers — applied at the write boundary so that no matter
// what casing/whitespace the admin form sends, what lands in the DB is
// always one consistent format. This prevents the class of bug where the
// same city ends up stored as both "Setif" and "setif" (or with stray
// whitespace) and the dropdown splits it into two groups, or the city
// filter — which does WHERE city = ?.toLowerCase() — silently misses rows.

// Lower-cased key form. Used for the `city` field, which is the filter key,
// not for display. Trims whitespace and collapses internal runs of spaces.
const toKey = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

// Title-case display form. "setif" / "SETIF" / "  Setif  " -> "Setif".
// Handles multi-word names ("tizi ouzou" -> "Tizi Ouzou") and preserves
// non-ASCII letters (so accented forms like "Aïn Defla" stay intact).
const toTitle = (s) => String(s || "")
  .trim()
  .replace(/\s+/g, " ")
  .toLowerCase()
  .replace(/(^|\s|-)(\S)/g, (_, sep, ch) => sep + ch.toUpperCase());

// Arabic / RTL display fields don't have case — trim only.
const trimOnly = (s) => String(s || "").trim();

const hotelSchema = z.object({
  nameEn: z.string().min(1), nameFr: z.string().min(1), nameAr: z.string().min(1),
  descEn: z.string().default(""), descFr: z.string().default(""), descAr: z.string().default(""),
  stars: z.number().int().min(1).max(5),
  // city is the filter KEY — always lowercase, always trimmed.
  city: z.string().min(1).transform(toKey),
  // Display fields: trimmed; Latin scripts get title-cased so the dropdown
  // groups by a single canonical label instead of "Setif" vs "setif".
  cityEn: z.string().min(1).transform(toTitle),
  cityFr: z.string().min(1).transform(toTitle),
  cityAr: z.string().min(1).transform(trimOnly),
  regionEn: z.string().default("").transform(toTitle),
  regionFr: z.string().default("").transform(toTitle),
  regionAr: z.string().default("").transform(trimOnly),
  address: z.string().optional(),
  // .nullable() so the admin can CLEAR a pin (web sends null) — not just .optional(),
  // which would reject null. Range bounds reject garbage (a longitude of 500, etc.).
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
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
//
// By default, inactive (soft-deleted) rooms are EXCLUDED from the response.
// This matches the admin's mental model: when they "Remove" a room, they
// expect it to stop appearing in the editor. The room row is preserved in
// the DB so existing bookings keep their FK reference, but the admin
// doesn't see it unless they pass `?includeInactive=true` (reserved for a
// future "show archived rooms" toggle).
router.get("/hotels/:id", async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const include = includeInactive
      ? HOTEL_INCLUDE
      : {
          ...HOTEL_INCLUDE,
          // Override the rooms include with a where clause filtering to
          // active only. Photos and amenities are unaffected.
          rooms: {
            where: { isActive: true },
            orderBy: { sortOrder: "asc" },
            include: { photos: true },
          },
        };
    const hotel = await prisma.hotel.findUnique({
      where: { id: req.params.id },
      include,
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
//
// If the deleted photo was the primary, we promote the next-oldest photo
// to primary so the hotel never ends up with photos but no primary set.
// (The frontend uses primaryPhoto as the thumbnail in hotel cards; without
// one, the card shows "No photo" — a degraded experience.)
router.delete("/photos/:photoId", async (req, res, next) => {
  try {
    const photo = await prisma.hotelPhoto.findUnique({
      where: { id: req.params.photoId },
    });
    if (photo) {
      // fire-and-forget R2 delete: don't block the API on storage cleanup
      deleteHotelPhoto(photo.url).catch(() => {});
      await prisma.hotelPhoto.delete({ where: { id: req.params.photoId } });

      // Promote a successor if we deleted the primary. We pick the
      // remaining photo with the lowest sortOrder (i.e. the oldest in the
      // gallery, after sorting). If no photos remain, nothing to do.
      if (photo.isPrimary) {
        const successor = await prisma.hotelPhoto.findFirst({
          where: { hotelId: photo.hotelId },
          orderBy: { sortOrder: "asc" },
        });
        if (successor) {
          await prisma.hotelPhoto.update({
            where: { id: successor.id },
            data: { isPrimary: true },
          });
        }
      }
    }
    res.json({ message: "Photo removed" });
  } catch (err) { next(err); }
});

// PATCH /api/admin/photos/:photoId — update a photo's properties
//
// Currently supports `isPrimary: true` to make this photo the new primary
// (clearing the flag on all others in the same hotel). Wrapped in a
// transaction so we never end up with two primaries or zero primaries.
router.patch("/photos/:photoId", async (req, res, next) => {
  try {
    const { isPrimary } = req.body || {};

    if (isPrimary === true) {
      const photo = await prisma.hotelPhoto.findUnique({
        where: { id: req.params.photoId },
        select: { id: true, hotelId: true },
      });
      if (!photo) return res.status(404).json({ error: "Photo not found" });

      // Transaction: clear flag on all sibling photos, then set on this one.
      // Doing both inside a single transaction prevents a window where the
      // hotel has zero primary photos.
      await prisma.$transaction([
        prisma.hotelPhoto.updateMany({
          where: { hotelId: photo.hotelId },
          data: { isPrimary: false },
        }),
        prisma.hotelPhoto.update({
          where: { id: photo.id },
          data: { isPrimary: true },
        }),
      ]);
      return res.json({ message: "Primary photo updated" });
    }

    // No supported operation matched.
    return res.status(400).json({
      error: "Nothing to update. Supported: { isPrimary: true }",
    });
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

// -----------------------------------------------------------------------------
// BOARD / MEAL-PLAN RATES (Phase B)
// -----------------------------------------------------------------------------
// One price per board type per room. The admin sends the FULL set each save
// (replace semantics): boards with a price are upserted; boards omitted or sent
// null are removed. ROOM_ONLY stays the basePrice fallback but can also be
// priced explicitly here.

const BOARD_TYPES = ["ROOM_ONLY", "BREAKFAST", "HALF_BOARD", "FULL_BOARD", "ALL_INCLUSIVE"];

// Accepts EITHER `supplement` (new admin) OR `price` (old/cached admin). Both
// optional; at least the field the running admin sends will be present. The
// handler normalizes to a supplement using the room's base price. This makes
// the endpoint work no matter which admin bundle the browser has cached.
const boardRatesSchema = z.object({
  rates: z.array(
    z.object({
      board: z.enum(BOARD_TYPES),
      supplement: z.number().int().min(0).nullable().optional(),
      price: z.number().int().min(0).nullable().optional(),
      isActive: z.boolean().default(true),
    })
  ),
});

// GET /api/admin/rooms/:roomId/board-rates — list a room's board rates
router.get("/rooms/:roomId/board-rates", async (req, res, next) => {
  try {
    const roomId = req.params.roomId;
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { basePrice: true } });
    const base = room?.basePrice || 0;
    const rates = await prisma.roomBoardRate.findMany({
      where: { roomId },
      orderBy: { board: "asc" },
    });
    // Return both shapes so either admin panel displays correctly:
    //  - `supplement`: the add-on (new panel reads this directly)
    //  - `price`: what the OLD panel shows in its box — for non-ROOM_ONLY we
    //    expose the SUPPLEMENT here (so "what you see = what you type"), and
    //    for ROOM_ONLY we expose the base. The true absolute is `priceAbsolute`.
    const shaped = rates.map((r) => ({
      ...r,
      priceAbsolute: r.price,
      price: r.board === "ROOM_ONLY" ? base : (r.supplement ?? Math.max(0, r.price - base)),
    }));
    res.json({ data: shaped });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/rooms/:roomId/board-rates — replace a room's board rates
router.put("/rooms/:roomId/board-rates", async (req, res, next) => {
  try {
    const { rates } = boardRatesSchema.parse(req.body);
    const roomId = req.params.roomId;

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: "Room not found" });

    // Determine the BASE price for this save. The old (cached) admin sends
    // ROOM_ONLY as an absolute `price` (the room rate itself). The new admin
    // sends supplement:0 for ROOM_ONLY and the base comes from the room. We
    // prefer an explicit ROOM_ONLY price if present, else the room's basePrice.
    const roomOnlyRow = rates.find((r) => r.board === "ROOM_ONLY");
    const base =
      roomOnlyRow && roomOnlyRow.price != null
        ? roomOnlyRow.price
        : (room.basePrice || 0);

    // Normalize each NON-ROOM_ONLY row to a supplement (the add-on over base):
    //  - new admin sends `supplement` directly
    //  - old/cached admin sends `price` = the number typed in that box, which
    //    the user means as the ADD-ON (e.g. "half board 5500" on a 5500 room
    //    => +5500 => 11000). So price is treated as the supplement, NOT an
    //    absolute. This matches how the admin actually enters values.
    //  - both null/absent => not offered (delete)
    const normalize = (r) => {
      if (r.board === "ROOM_ONLY") return 0;
      if (r.supplement != null) return Math.max(0, r.supplement);
      if (r.price != null) return Math.max(0, r.price);
      return null; // not offered
    };

    await prisma.$transaction([
      // Keep the room's basePrice in sync with the ROOM_ONLY value entered.
      ...(base !== (room.basePrice || 0)
        ? [prisma.room.update({ where: { id: roomId }, data: { basePrice: base } })]
        : []),
      ...rates.map((r) => {
        const supp = normalize(r);
        return supp == null
          ? prisma.roomBoardRate.deleteMany({ where: { roomId, board: r.board } })
          : prisma.roomBoardRate.upsert({
              where: { roomId_board: { roomId, board: r.board } },
              update: { supplement: supp, price: base + supp, isActive: r.isActive },
              create: { roomId, board: r.board, supplement: supp, price: base + supp, isActive: r.isActive },
            });
      }),
    ]);

    const updated = await prisma.roomBoardRate.findMany({
      where: { roomId },
      orderBy: { board: "asc" },
    });
    res.json({ data: updated, message: "Board rates updated" });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    next(err);
  }
});

// DELETE /api/admin/rooms/:roomId
// DELETE /api/admin/rooms/:roomId — smart delete
//
// Tries to hard-delete the room. If the room has bookings (historical,
// current, or pending) that reference it via the BookingRoom join table,
// we CAN'T hard-delete without violating the FK constraint — Prisma
// will throw P2003. In that case we fall back to a soft-delete
// (isActive: false) so the room disappears from the admin editor (the
// detail endpoint filters inactive rooms by default) but bookings keep
// their FK reference intact.
//
// The response includes `deleteMode: "hard" | "soft"` so the frontend
// can show a different message if it wants to.
router.delete("/rooms/:roomId", async (req, res, next) => {
  try {
    // First check if any bookings reference this room. If yes, we know
    // hard delete will fail before we try it, and we can give a clearer
    // message than the FK-constraint error.
    const bookingRefs = await prisma.bookingRoom.count({
      where: { roomId: req.params.roomId },
    });

    if (bookingRefs === 0) {
      // Safe to hard delete — no booking references exist.
      await prisma.room.delete({ where: { id: req.params.roomId } });
      return res.json({
        message: "Room deleted",
        deleteMode: "hard",
        bookingRefs: 0,
      });
    }

    // Bookings reference this room — soft-delete instead. The room row
    // stays in the database with isActive=false so the FK constraint
    // is preserved. The admin editor's detail endpoint filters inactive
    // rooms out of the rooms list by default (see /hotels/:id).
    await prisma.room.update({
      where: { id: req.params.roomId },
      data: { isActive: false },
    });
    res.json({
      message: `Room archived (${bookingRefs} booking${bookingRefs === 1 ? "" : "s"} reference it, so it can't be permanently deleted)`,
      deleteMode: "soft",
      bookingRefs,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// ROOM PHOTOS
// ---------------------------------------------------------------------------
// Mirrors the hotel-photo routes but scoped to a single room type. Room
// photos have NO isPrimary flag — they're just an ordered gallery (sortOrder).
// Files live in R2 under hotels/{slug}/rooms/{roomId}/ via uploadRoomPhoto().
// The room_photos table already exists in the schema (Room.photos relation is
// already queried in /hotels/:id), so this is purely additive — no migration.
//
// Client contract (web/lib/adminApi.js):
//   adminAddRoomPhoto(roomId, url)    -> POST   /rooms/:roomId/photos        { url }
//   adminUploadRoomPhoto(roomId,file) -> POST   /rooms/:roomId/photos/upload (field "photo")
//   adminDeleteRoomPhoto(photoId)     -> DELETE /room-photos/:photoId

// POST /api/admin/rooms/:roomId/photos — add a room photo by URL
router.post("/rooms/:roomId/photos", async (req, res, next) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "Photo url required" });

    const room = await prisma.room.findUnique({
      where: { id: req.params.roomId },
      select: { id: true },
    });
    if (!room) return res.status(404).json({ error: "Room not found" });

    const count = await prisma.roomPhoto.count({ where: { roomId: room.id } });
    const photo = await prisma.roomPhoto.create({
      data: { roomId: room.id, url, sortOrder: count },
    });
    res.status(201).json({ data: photo, message: "Room photo added" });
  } catch (err) { next(err); }
});

// POST /api/admin/rooms/:roomId/photos/upload — upload a real file to R2
// multipart/form-data with field "photo"
router.post("/rooms/:roomId/photos/upload", upload.single("photo"), async (req, res, next) => {
  try {
    if (!isR2Configured()) {
      return res.status(503).json({
        error: "Photo upload is not configured on this server. Set R2_* env vars on the backend.",
      });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file received. Field must be named 'photo'." });
    }
    // Need the parent hotel's slug to build the R2 key:
    //   hotels/{slug}/rooms/{roomId}/{file}
    const room = await prisma.room.findUnique({
      where: { id: req.params.roomId },
      select: { id: true, hotel: { select: { slug: true } } },
    });
    if (!room) return res.status(404).json({ error: "Room not found" });

    const { url } = await uploadRoomPhoto(
      req.file.buffer,
      req.file.mimetype,
      room.hotel.slug,
      room.id,
    );

    const count = await prisma.roomPhoto.count({ where: { roomId: room.id } });
    const photo = await prisma.roomPhoto.create({
      data: { roomId: room.id, url, sortOrder: count },
    });
    res.status(201).json({ data: photo, message: "Room photo uploaded" });
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

// DELETE /api/admin/room-photos/:photoId — delete a room photo (+ R2 object)
// Best-effort R2 cleanup: we never fail the request if the object is already
// gone or R2 hiccups — the DB row is the source of truth.
router.delete("/room-photos/:photoId", async (req, res, next) => {
  try {
    const photo = await prisma.roomPhoto.findUnique({
      where: { id: req.params.photoId },
    });
    if (photo) {
      deletePhotoByUrl(photo.url).catch(() => {});
      await prisma.roomPhoto.delete({ where: { id: req.params.photoId } });
    }
    res.json({ message: "Room photo removed" });
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
