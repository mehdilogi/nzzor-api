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
  // SATIM gateway failures. These are upstream problems (unreachable host,
  // refused registration, malformed response), not the caller's fault, so they
  // must not be flattened into a generic 500 — the code is what tells you
  // whether to retry, re-register, or call SATIM support.
  if (err.name === "SatimError") {
    console.error(`[satim] ${err.stage || "?"} failed: ${err.code || "-"} ${err.message}`);
    return res.status(err.status || 502).json({
      error: err.message,
      code: err.code || "SATIM_ERROR",
      stage: err.stage || null,
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
