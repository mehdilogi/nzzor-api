// =============================================================================
// Group requests — public intake (POST /api/groups)
// -----------------------------------------------------------------------------
// 10+ travellers never go through instant booking: hotels price groups
// differently (group rate, deposit, own cancellation terms) and the amounts
// are beyond what a single card payment handles well. The customer leaves a
// request, the agency is emailed at once and answers with a quote.
// =============================================================================

const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { sendGroupRequest } = require("../services/emailService");

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ error: "Too many requests, please try again later", code: "RATE_LIMITED" }),
});

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .or(z.literal(""));

const schema = z.object({
  groupType: z.enum(["COMPANY", "WEDDING", "SPORTS", "SCHOOL", "ASSOCIATION", "OTHER"]),
  destination: z.string().max(60).nullish(),
  checkIn: day,
  checkOut: day,
  people: z.coerce.number().int().min(2).max(2000),
  rooms: z.coerce.number().int().min(1).max(1000).nullish(),
  budget: z.string().max(40).nullish(),
  organization: z.string().max(160).nullish(),
  contactName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30).regex(/^[+\d\s().-]+$/),
  email: z.string().trim().email().max(160).nullish().or(z.literal("")),
  message: z.string().max(3000).nullish(),
  lang: z.enum(["fr", "en", "ar"]).optional().default("fr"),
  website: z.string().max(0).optional(), // honeypot: bots fill it, people never see it
});

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeReference() {
  const bytes = crypto.randomBytes(6);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `GRP-${s}`;
}

router.post("/", limiter, async (req, res, next) => {
  try {
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        code: "VALIDATION",
        details: parsed.error.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
      });
    }
    const d = parsed.data;
    if (d.website) return res.status(201).json({ data: { reference: makeReference() } }); // silently drop bots

    const toDate = (v) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
    const checkIn = toDate(d.checkIn);
    const checkOut = toDate(d.checkOut);
    if (checkIn && checkOut && checkOut <= checkIn) {
      return res.status(400).json({ error: "Check-out must be after check-in", code: "BAD_DATES" });
    }

    let created = null;
    for (let i = 0; i < 3 && !created; i++) {
      try {
        created = await prisma.groupRequest.create({
          data: {
            reference: makeReference(),
            groupType: d.groupType,
            destination: d.destination || null,
            checkIn,
            checkOut,
            people: d.people,
            rooms: d.rooms || null,
            budget: d.budget || null,
            organization: d.organization || null,
            contactName: d.contactName,
            phone: d.phone,
            email: d.email || null,
            message: d.message || null,
            lang: d.lang,
            country: req.headers["cf-ipcountry"] || null,
            region: req.headers["cf-region"] || null,
          },
        });
      } catch (err) {
        if (err.code !== "P2002") throw err; // reference collision: retry
      }
    }

    // Never block the customer on email.
    setImmediate(() => {
      sendGroupRequest(created).catch((e) =>
        console.error(`[groups] notify ${created.reference} failed:`, e.message)
      );
    });
    console.log(`[groups] new request ${created.reference} · ${created.people} pers · ${created.destination || "?"}`);

    res.status(201).json({ data: { reference: created.reference } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
