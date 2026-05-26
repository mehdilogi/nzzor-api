const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { requireAuth } = require("../middleware/auth");
const emailService = require("../services/emailService");

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  firstName: z.string().min(1).max(100),
  // lastName, phone, preferredLang all optional
  lastName: z.string().optional().nullable().transform((v) => (v && v.trim()) || null),
  phone: z.string().min(5).max(20).optional().nullable().transform((v) => (v && v.trim()) || null),
  preferredLang: z.enum(["ar", "fr", "en"]).optional().default("fr"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function generateTokens(userId) {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
  });
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  });
  return { accessToken, refreshToken };
}

router.post("/register", async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        preferredLang: data.preferredLang,
      },
    });
    const tokens = generateTokens(user.id);
    res.status(201).json({
      data: {
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
        ...tokens,
      },
      message: "Account created successfully",
    });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: "Validation failed", details: err.errors });
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const tokens = generateTokens(user.id);
    res.json({
      data: {
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
        ...tokens,
      },
    });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: "Validation failed", details: err.errors });
    next(err);
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, email: true, phone: true, firstName: true, lastName: true,
      role: true, preferredLang: true, createdAt: true,
      _count: { select: { bookings: true, reviews: true } },
    },
  });
  res.json({ data: user });
});

// PATCH /api/auth/me — update profile (name, phone, preferred language)
const profileUpdateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().optional().nullable().transform((v) => (v && v.trim()) || null),
  phone: z.string().min(5).max(20).optional().nullable().transform((v) => (v && v.trim()) || null),
  preferredLang: z.enum(["ar", "fr", "en"]).optional(),
});
router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const data = profileUpdateSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, preferredLang: true },
    });
    res.json({ data: user });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: "Validation failed", details: err.errors });
    next(err);
  }
});

// POST /api/auth/me/password — change password (requires current password)
const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});
router.post("/me/password", requireAuth, async (req, res, next) => {
  try {
    const data = passwordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
    const passwordHash = await bcrypt.hash(data.newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ ok: true });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: "Validation failed", details: err.errors });
    next(err);
  }
});

// =============================================================================
// PASSWORD RESET (two-step flow)
// -----------------------------------------------------------------------------
// Step 1: POST /api/auth/password-reset/request
//   User submits their email. We generate a random 32-byte token, hash it
//   with SHA-256, store the hash + 1-hour expiry on the user, then email
//   the raw token in a link.
//
//   We ALWAYS respond 200, even if the email doesn't match a user. This
//   prevents enumeration attacks (an attacker can't use this endpoint as
//   a "does this email have an account?" oracle).
//
// Step 2: POST /api/auth/password-reset/confirm
//   User clicks the link, types a new password. We hash the incoming
//   token, find the user with a matching unexpired hash, update the
//   password, and null out the reset fields (single-use).
//
// Why SHA-256 instead of bcrypt for the token hash:
//   - Tokens are already 32 cryptographically-random bytes (256 bits of
//     entropy). bcrypt's slowness is unnecessary at that entropy level
//     and would make verification needlessly expensive.
//   - SHA-256 is constant-time enough for this use case via Buffer
//     comparison; we use timingSafeEqual to be safe.
// =============================================================================

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

const resetRequestSchema = z.object({
  email: z.string().email(),
  lang: z.enum(["ar", "fr", "en"]).optional().default("fr"),
});

router.post("/password-reset/request", async (req, res, next) => {
  try {
    const { email, lang } = resetRequestSchema.parse(req.body);

    // Look up the user but do NOT reveal whether they exist. We always
    // return the same response; we only actually send an email if there
    // is a real account.
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.isActive) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetTokenHash: tokenHash,
          passwordResetExpiresAt: expiresAt,
        },
      });

      // Fire and forget — we don't block the response on email delivery,
      // and we don't surface email errors to the user (which would leak
      // whether the email-send was attempted, i.e. whether the account
      // exists). If the email fails to send the user can request again.
      setImmediate(() => {
        emailService
          .sendPasswordResetEmail({
            to: user.email,
            firstName: user.firstName,
            rawToken,
            lang: user.preferredLang || lang,
          })
          .catch((err) => {
            console.error("[password-reset] email send failed:", err.message);
          });
      });
    }

    // Always respond the same regardless of user existence.
    res.json({
      ok: true,
      message: "If an account with that email exists, a reset link has been sent.",
    });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: "Validation failed", details: err.errors });
    next(err);
  }
});

const resetConfirmSchema = z.object({
  token: z.string().min(32),
  newPassword: z.string().min(8).max(100),
});

router.post("/password-reset/confirm", async (req, res, next) => {
  try {
    const { token, newPassword } = resetConfirmSchema.parse(req.body);

    // Hash the incoming token and look up the user by that hash. We can't
    // index by hash directly without a schema migration adding an index,
    // but the unhashed search space is small (a user with a pending reset
    // is a rare state). findFirst is fine for now.
    const tokenHash = hashToken(token);
    const user = await prisma.user.findFirst({
      where: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { gt: new Date() },
        isActive: true,
      },
    });

    if (!user) {
      // Could be: unknown token, expired token, already-used (nulled) token.
      // We don't distinguish — all three look the same to the client to
      // avoid leaking any timing/state info.
      return res.status(400).json({
        error: "This reset link is invalid or has expired. Please request a new one.",
        code: "INVALID_RESET_TOKEN",
      });
    }

    // Re-verify with timingSafeEqual as a defense-in-depth against any
    // theoretical timing variations in Prisma's WHERE matching.
    const safe = crypto.timingSafeEqual(
      Buffer.from(user.passwordResetTokenHash),
      Buffer.from(tokenHash),
    );
    if (!safe) {
      return res.status(400).json({
        error: "This reset link is invalid or has expired. Please request a new one.",
        code: "INVALID_RESET_TOKEN",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Single-use: null the reset fields so the link can't be reused.
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });

    res.json({ ok: true, message: "Password updated. You can now sign in." });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: "Validation failed", details: err.errors });
    next(err);
  }
});

module.exports = router;
