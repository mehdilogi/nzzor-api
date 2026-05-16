function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (err.code === "P2002") {
    return res.status(409).json({ error: "A record with this data already exists" });
  }
  if (err.code === "P2025") {
    return res.status(404).json({ error: "Record not found" });
  }
  if (err.name === "ZodError") {
    return res.status(400).json({
      error: "Validation failed",
      details: err.errors.map(e => ({ field: e.path.join("."), message: e.message })),
    });
  }
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ error: "Invalid token" });
  }
  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ error: "Token expired" });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
}

module.exports = { errorHandler };
