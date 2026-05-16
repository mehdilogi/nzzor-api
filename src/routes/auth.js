const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../utils/prisma");
const { requireAuth } = require("../middleware/auth");

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().min(5).max(20).optional(),
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

module.exports = router;
