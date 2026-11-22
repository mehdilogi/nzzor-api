// =============================================================================
// Push notifications to the admins' phones (Web Push)
// -----------------------------------------------------------------------------
// Every phone or computer that turns on notifications in /admin is stored in
// push_subscriptions. Booking events call notifyBooking / notifyGroup, which
// send to all of them.
//
// No npm dependency: Web Push is two standards, implemented here with Node's
// crypto module —
//   RFC 8291  message encryption (aes128gcm), so only that browser can read it
//   RFC 8292  VAPID, which proves to Apple / Google the message is from us
// The VAPID key pair is created on first use and kept in app_settings, so
// there is nothing to configure. (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env
// vars override it if ever needed.)
//
// Sending never throws and never blocks a booking: every call is wrapped and
// only logs on failure.
// =============================================================================

const crypto = require("crypto");
const https = require("https");
const prisma = require("../utils/prisma");

const SUBJECT = process.env.VAPID_SUBJECT || "mailto:contact@nzzor.com";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (s) => Buffer.from(String(s), "base64url");

// ---- Keys --------------------------------------------------------------------

let keysPromise = null;

function getKeys() {
  if (!keysPromise) {
    keysPromise = loadKeys().catch((err) => {
      keysPromise = null;
      throw err;
    });
  }
  return keysPromise;
}

async function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const row = await prisma.appSetting.findUnique({ where: { key: "vapid" } });
  if (row) return JSON.parse(row.value);

  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const keys = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
  try {
    await prisma.appSetting.create({ data: { key: "vapid", value: JSON.stringify(keys) } });
    console.log("[push] created VAPID keys");
    return keys;
  } catch (err) {
    // Another instance created them at the same moment: use theirs.
    const again = await prisma.appSetting.findUnique({ where: { key: "vapid" } });
    if (again) return JSON.parse(again.value);
    throw err;
  }
}

// ---- RFC 8292: VAPID authorization -------------------------------------------

function vapidHeader(endpoint, keys) {
  const pub = fromB64u(keys.publicKey);
  const key = crypto.createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: SUBJECT,
  }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

// ---- RFC 8291: payload encryption (aes128gcm) --------------------------------

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

// HKDF (RFC 5869) for outputs of 32 bytes or less: one expand round.
function hkdf(salt, ikm, info, length) {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

// `_test` lets the test script pin the random parts; never used in production.
function encrypt(payload, sub, _test) {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);

  const local = crypto.createECDH("prime256v1");
  if (_test && _test.privateKey) local.setPrivateKey(_test.privateKey);
  else local.generateKeys();
  const asPublic = local.getPublicKey();
  const shared = local.computeSecret(uaPublic);
  const salt = (_test && _test.salt) || crypto.randomBytes(16);

  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const plain = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([2])]); // 0x02 = last record
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1 + asPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  asPublic.copy(header, 21);
  return Buffer.concat([header, body]);
}

// ---- Sending -------------------------------------------------------------------

function post(endpoint, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(endpoint, { method: "POST", headers: { ...headers, "Content-Length": body.length }, timeout: 10000 }, (res) => {
      let text = "";
      res.on("data", (c) => { if (text.length < 500) text += c; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

async function sendOne(sub, message, keys) {
  const body = encrypt(JSON.stringify(message), sub);
  const res = await post(sub.endpoint, body, {
    TTL: "86400",
    Urgency: "high",
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aes128gcm",
    Authorization: vapidHeader(sub.endpoint, keys),
  });
  if (res.status === 404 || res.status === 410) {
    // The phone turned notifications off or the browser dropped the
    // subscription: forget it.
    await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
    return { ok: false, gone: true };
  }
  if (res.status >= 300) {
    console.error(`[push] ${new URL(sub.endpoint).host} answered ${res.status}: ${res.text.slice(0, 200)}`);
    return { ok: false, status: res.status };
  }
  return { ok: true };
}

/**
 * Send one notification to every stored subscription (or the given ones).
 * message: { title, body, url, tag }
 */
async function sendToAll(message, subs) {
  try {
    const list = subs || (await prisma.pushSubscription.findMany());
    if (!list.length) return { sent: 0, total: 0 };
    const keys = await getKeys();
    const results = await Promise.allSettled(list.map((s) => sendOne(s, message, keys)));
    const sent = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    results.forEach((r) => { if (r.status === "rejected") console.error("[push] send failed:", r.reason && r.reason.message); });
    return { sent, total: list.length };
  } catch (err) {
    console.error("[push] sendToAll failed:", err.message);
    return { sent: 0, total: 0, error: err.message };
  }
}

// ---- Booking events ------------------------------------------------------------

// The same event for the same booking is sent once (a resent voucher is not a
// new booking). Kept in memory: a restart can at worst repeat one message.
const recent = new Map();
function seen(key) {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 12 * 3600 * 1000) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
}

const money = (n) => `${Number(n || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ")} DA`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayMonth(d) {
  if (!d) return "";
  const x = new Date(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
}

/**
 * kind: "created" | "confirmed" | "payment_failed" | "cancelled"
 */
async function notifyBooking(kind, reference) {
  try {
    if (!reference || seen(`${kind}:${reference}`)) return;
    const b = await prisma.booking.findUnique({
      where: { reference },
      select: {
        id: true, reference: true, status: true, total: true, isTest: true, paymentMethod: true,
        guestFirstName: true, guestLastName: true, checkIn: true, checkOut: true,
        hotel: { select: { nameFr: true, nameEn: true } },
      },
    });
    if (!b) return;

    const hotel = (b.hotel && (b.hotel.nameFr || b.hotel.nameEn)) || "";
    const guest = `${b.guestFirstName || ""} ${b.guestLastName || ""}`.trim();
    const stay = `${dayMonth(b.checkIn)} → ${dayMonth(b.checkOut)}`;
    const test = b.isTest ? "TEST · " : "";

    let title;
    let next = "";
    if (kind === "confirmed") {
      title = `✅ ${test}Confirmed booking · ${money(b.total)}`;
    } else if (kind === "payment_failed") {
      title = `⚠️ ${test}Card payment failed · ${money(b.total)}`;
      next = "Recovery email sent. Call the guest.";
    } else if (kind === "cancelled") {
      title = `✖️ ${test}Booking cancelled · ${money(b.total)}`;
    } else if (b.status === "PENDING_PAYMENT") {
      title = `💳 ${test}Paying by card now · ${money(b.total)}`;
      next = "Waiting for SATIM.";
    } else {
      title = `🛎️ ${test}New booking · ${money(b.total)}`;
      next = "Confirm with the hotel.";
    }

    await sendToAll({
      title,
      body: [`${hotel} · ${guest}`, stay, next].filter(Boolean).join("\n"),
      url: `/admin?booking=${encodeURIComponent(b.id)}#bookings`,
      tag: b.reference,
    });
  } catch (err) {
    console.error(`[push] notifyBooking(${kind}, ${reference}) failed:`, err.message);
  }
}

async function notifyGroup(g) {
  try {
    if (!g || seen(`group:${g.reference}`)) return;
    const when = g.checkIn ? dayMonth(g.checkIn) : "dates open";
    await sendToAll({
      title: `👥 Group request · ${g.people} people`,
      body: [`${g.organization || g.contactName} · ${g.destination || "destination open"} · ${when}`, "Send a quote."].join("\n"),
      url: "/admin#groups",
      tag: g.reference,
    });
  } catch (err) {
    console.error("[push] notifyGroup failed:", err.message);
  }
}

module.exports = { getKeys, sendToAll, notifyBooking, notifyGroup, encrypt, vapidHeader };
