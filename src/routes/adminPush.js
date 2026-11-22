// =============================================================================
// Admin → phone notifications — /api/admin/push
//   GET  /key                  public key the browser needs to subscribe
//   POST /subscribe            { endpoint, keys: { p256dh, auth } }  this device
//   POST /unsubscribe          { endpoint }
//   POST /status               { endpoint }  → { on, devices }
//   POST /test                 { endpoint }  send a test to this device
// =============================================================================

const router = require("express").Router();
const prisma = require("../utils/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const push = require("../services/pushService");

router.use(requireAuth, requireAdmin);

const isEndpoint = (v) => typeof v === "string" && /^https:\/\/[^\s]{10,1000}$/.test(v);

router.get("/key", async (req, res, next) => {
  try {
    const { publicKey } = await push.getKeys();
    res.json({ data: { publicKey } });
  } catch (err) { next(err); }
});

router.post("/subscribe", async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!isEndpoint(endpoint) || !keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
      return res.status(400).json({ error: "Invalid subscription" });
    }
    const data = {
      p256dh: keys.p256dh.slice(0, 200),
      auth: keys.auth.slice(0, 100),
      userId: req.user && req.user.id ? String(req.user.id) : null,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    };
    await prisma.pushSubscription.upsert({ where: { endpoint }, create: { endpoint, ...data }, update: data });
    const devices = await prisma.pushSubscription.count();
    res.json({ data: { on: true, devices } });
  } catch (err) { next(err); }
});

router.post("/unsubscribe", async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (isEndpoint(endpoint)) await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    res.json({ data: { on: false } });
  } catch (err) { next(err); }
});

router.post("/status", async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    const [row, devices] = await Promise.all([
      isEndpoint(endpoint) ? prisma.pushSubscription.findUnique({ where: { endpoint } }) : null,
      prisma.pushSubscription.count(),
    ]);
    res.json({ data: { on: !!row, devices } });
  } catch (err) { next(err); }
});

router.post("/test", async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    const sub = isEndpoint(endpoint) ? await prisma.pushSubscription.findUnique({ where: { endpoint } }) : null;
    if (!sub) return res.status(404).json({ error: "This device is not subscribed" });
    const r = await push.sendToAll({
      title: "🔔 Nzzor notifications are on",
      body: "Every new booking, payment and group request will show up here.",
      url: "/admin",
      tag: "nzzor-test",
    }, [sub]);
    res.json({ data: r });
  } catch (err) { next(err); }
});

module.exports = router;
