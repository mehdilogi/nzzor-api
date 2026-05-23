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

async function uploadHotelPhoto(buffer, mimeType, hotelSlug) {
  const client = getClient();
  if (!client) {
    throw new Error("R2 storage is not configured on the server.");
  }

  const ext = ALLOWED[mimeType ? mimeType.toLowerCase() : ""];
  if (!ext) {
    throw new Error(`Unsupported image type: ${mimeType}. Allowed: JPG, PNG, WEBP.`);
  }

  // sanitize slug for use in the path
  const safeSlug = String(hotelSlug || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "unknown";

  // unique filename — timestamp + 6 random hex chars
  const stamp = Date.now();
  const rand = crypto.randomBytes(3).toString("hex");
  const key = `hotels/${safeSlug}/${stamp}-${rand}.${ext}`;

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

async function deleteHotelPhoto(publicUrl) {
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

module.exports = { uploadHotelPhoto, deleteHotelPhoto, isR2Configured };
