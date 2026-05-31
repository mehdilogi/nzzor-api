// =============================================================================
// cleanText middleware
// =============================================================================
// Strips invisible Unicode characters from every string in `req.body`.
//
// Why this exists:
//   Arabic input from mobile keyboards (and from copy-paste through some
//   editors and browsers) frequently smuggles in directional formatting
//   characters that render as nothing but make Postgres treat
//   "سطيف" and "سطيف<LRM>" as different strings. That broke our wilaya
//   groupBy queries until we cleaned them up. This middleware prevents
//   the same data from re-entering the DB via the admin/partner write
//   path.
//
// Stripped code points:
//   U+200E  LEFT-TO-RIGHT MARK         (LRM)         <-- the actual culprit
//   U+200F  RIGHT-TO-LEFT MARK         (RLM)
//   U+202A  LEFT-TO-RIGHT EMBEDDING    (LRE)
//   U+202B  RIGHT-TO-LEFT EMBEDDING    (RLE)
//   U+202C  POP DIRECTIONAL FORMATTING (PDF)
//   U+202D  LEFT-TO-RIGHT OVERRIDE     (LRO)
//   U+202E  RIGHT-TO-LEFT OVERRIDE     (RLO)
//   U+2066-U+2069  modern directional isolates (LRI / RLI / FSI / PDI)
//   U+FEFF  ZERO WIDTH NO-BREAK SPACE  (BOM)
//   U+200B  ZERO WIDTH SPACE
//   U+200C  ZERO WIDTH NON-JOINER
//   U+200D  ZERO WIDTH JOINER  (kept-IN: see comment below)
//
// On U+200D (ZWJ): we INTENTIONALLY do NOT strip this. ZWJ is required
// for some emoji sequences and for legitimate Arabic ligature joining.
// The bug we observed used U+200E specifically, and U+200E has zero
// legitimate use in plain text input.

const INVISIBLE_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u200B\u200C]/g;

function stripInvisibles(value) {
  if (typeof value !== "string") return value;
  // Cheap fast-path: if no invisibles, return the same reference (no allocation)
  if (!INVISIBLE_RE.test(value)) return value;
  return value.replace(INVISIBLE_RE, "");
}

// Recursively clean a parsed JSON body. Mutates in place — the body is
// already a fresh object built by Express's json parser, so we own it.
function cleanDeep(obj) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i];
      if (typeof v === "string") obj[i] = stripInvisibles(v);
      else if (v && typeof v === "object") cleanDeep(v);
    }
    return obj;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string") obj[k] = stripInvisibles(v);
      else if (v && typeof v === "object") cleanDeep(v);
    }
    return obj;
  }
  return obj;
}

function cleanTextMiddleware(req, _res, next) {
  if (req.body && typeof req.body === "object") {
    cleanDeep(req.body);
  }
  next();
}

module.exports = {
  cleanTextMiddleware,
  stripInvisibles, // exported so admin SQL utils / migrations can use it too
};
