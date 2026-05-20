const jwt = require("jsonwebtoken");
const prisma = require("../utils/prisma");

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const token = header.split(" ")[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, firstName: true, lastName: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: "User not found or inactive" });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") return res.status(401).json({ error: "Token expired" });
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      const token = header.split(" ")[1];
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, email: true, role: true, firstName: true, lastName: true },
      });
      if (user) req.user = user;
    }
  } catch (e) { /* ignore */ }
  next();
}

function requireAdmin(req, res, next) {
  if (!["ADMIN", "SUPER_ADMIN"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// requires the user be either a hotel partner OR an admin (admins can see
// any hotel's data; partners only their own — handled inside each route)
function requirePartner(req, res, next) {
  const role = req.user?.role;
  if (!["HOTEL_MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role)) {
    return res.status(403).json({ error: "Hotel partner access required" });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin, requirePartner };
