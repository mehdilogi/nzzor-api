// =============================================================================
// recaptchaService — Google reCAPTCHA token verification
// -----------------------------------------------------------------------------
// Required by SATIM's cahier de recette: "Protection anti-bot : Un Captcha doit
// être présent sur la page contenant le bouton de paiement pour éviter les
// transactions automatisées."
//
// DESIGN NOTE — fails OPEN when unconfigured.
//
// If RECAPTCHA_SECRET is not set, verification is skipped and bookings proceed
// normally. That is deliberate: the alternative is that deploying this bundle
// before the keys exist takes the whole booking flow down. The moment the
// secret lands in Railway, enforcement switches on with no code change.
//
// It fails CLOSED on a genuine rejection — a present-but-invalid token is
// refused. The open path is only for "no secret configured at all".
//
// Check isEnforced() if you need to know which mode you are in; /api/health
// reports it so this can never be silently off in production.
// =============================================================================

const SECRET = process.env.RECAPTCHA_SECRET || "";
const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const TIMEOUT_MS = Number(process.env.RECAPTCHA_TIMEOUT_MS || 8000);

function isEnforced() {
  return Boolean(SECRET);
}

// Returns { ok: true } | { ok: false, reason }
async function verifyToken(token, remoteIp) {
  if (!SECRET) {
    return { ok: true, skipped: true };
  }
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "missing-token" };
  }

  const body = new URLSearchParams({ secret: SECRET, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  let res;
  try {
    res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Google unreachable. Let the booking through rather than blocking a real
    // customer because of a third-party outage — the captcha is anti-bot
    // hardening, not an authorization check, and the payment itself is still
    // gated by SATIM and 3-D Secure.
    console.error("[recaptcha] verification unreachable:", err.message);
    return { ok: true, degraded: true };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    console.error("[recaptcha] non-JSON response from Google");
    return { ok: true, degraded: true };
  }

  if (json.success) return { ok: true };

  const codes = Array.isArray(json["error-codes"]) ? json["error-codes"].join(",") : "unknown";
  // timeout-or-duplicate means the customer sat on the page too long or the
  // token was already spent. That is a retry, not an attack.
  return { ok: false, reason: codes };
}

module.exports = { verifyToken, isEnforced };
