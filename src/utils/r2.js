// =============================================================================
// Nzzor — R2 storage client
//
// Uploads to Cloudflare R2 using the S3-compatible API. Reads credentials
// strictly from environment variables — they NEVER appear in code or git.
//
// Required env vars (set on Railway):
//   R2_ENDPOINT       e.g. https://<account-id>.r2.cloudflarestorage.com
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET         e.g. nzzor-hotels
//   R2_PUBLIC_URL     e.g. https://pub-<hash>.r2.dev  (the public bucket URL)
//
// Layout in R2:
//   hotels/{hotel-slug}/{stamp}-{rand}.{ext}        ← hotel-level photos
//   hotels/{hotel-slug}/rooms/{room-id}/{stamp}-{rand}.{ext}  ← room-type photos
//
// We organize by hotel slug at the top level so a future "delete hotel" job
// can wipe a hotel's whole tree (incl. rooms) with one prefix delete.
// =============================================================================

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

const {
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_URL,
} = process.env;

// Lazy client init so the API still boots even if R2 isn't configured.
// Upload endpoints will return a clear error if env vars are missing rather
// than crashing the whole server at startup.
let _client = null;
function getClient() {
  if (_client) return _client;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    return null;
  }
  _client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

function isR2Configured() {
  return Boolean(
    R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_URL
  );
}

// Safe extension map — refuses anything not in this list.
const ALLOWED = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Sanitize a slug fragment for use in an R2 object key.
// Allows lowercase letters, digits, hyphens. Caps length so a typo in a slug
// can't bloat the key past S3's 1024-char limit.
function sanitize(segment, max = 60) {
  return String(segment || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max) || "unknown";
}

// -----------------------------------------------------------------------------
// Core: upload a photo at a given path prefix.
// -----------------------------------------------------------------------------
// Internal helper. Use uploadHotelPhoto / uploadRoomPhoto from callers — they
// build the right path prefix and forward to this.
async function uploadPhoto(buffer, mimeType, pathPrefix) {
  const client = getClient();
  if (!client) {
    throw new Error("R2 storage is not configured on the server.");
  }

  const ext = ALLOWED[mimeType ? mimeType.toLowerCase() : ""];
  if (!ext) {
    throw new Error(`Unsupported image type: ${mimeType}. Allowed: JPG, PNG, WEBP.`);
  }

  // unique filename — timestamp + 6 random hex chars
  const stamp = Date.now();
  const rand = crypto.randomBytes(3).toString("hex");
  // Trim any trailing slash on the prefix to produce clean keys.
  const prefix = String(pathPrefix || "").replace(/\/+$/, "");
  const key = `${prefix}/${stamp}-${rand}.${ext}`;

  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
  }));

  const base = R2_PUBLIC_URL.replace(/\/+$/, "");
  return { url: `${base}/${key}`, key };
}

// -----------------------------------------------------------------------------
// Hotel-level photos
// -----------------------------------------------------------------------------
async function uploadHotelPhoto(buffer, mimeType, hotelSlug) {
  const safeSlug = sanitize(hotelSlug);
  return uploadPhoto(buffer, mimeType, `hotels/${safeSlug}`);
}

// -----------------------------------------------------------------------------
// Room-type photos — nested under the hotel for clean prefix-based deletion
// -----------------------------------------------------------------------------
async function uploadRoomPhoto(buffer, mimeType, hotelSlug, roomId) {
  const safeSlug = sanitize(hotelSlug);
  // roomId is a UUID — already URL-safe — but defensively sanitize anyway in
  // case schema ever changes to allow human-readable IDs.
  const safeRoomId = sanitize(roomId, 80);
  return uploadPhoto(buffer, mimeType, `hotels/${safeSlug}/rooms/${safeRoomId}`);
}

// -----------------------------------------------------------------------------
// Delete — works for any photo URL we issued, regardless of hotel/room scope.
// -----------------------------------------------------------------------------
// Generic — accepts any URL we wrote (hotel OR room). The old name
// `deleteHotelPhoto` is preserved below as an alias for backward compatibility
// with the existing hotel-photo delete route.
async function deletePhotoByUrl(publicUrl) {
  const client = getClient();
  if (!client || !publicUrl) return;
  if (!R2_PUBLIC_URL || !publicUrl.startsWith(R2_PUBLIC_URL)) return;
  const key = publicUrl.slice(R2_PUBLIC_URL.length).replace(/^\/+/, "");
  if (!key) return;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (e) {
    console.warn("R2 delete failed:", e.message);
  }
}

// Backward-compat alias for the existing hotel-photo delete route.
const deleteHotelPhoto = deletePhotoByUrl;

module.exports = {
  uploadHotelPhoto,
  uploadRoomPhoto,
  deleteHotelPhoto,
  deletePhotoByUrl,
  isR2Configured,
};
