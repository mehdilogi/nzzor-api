// =============================================================================
// cleanText middleware
// =============================================================================
// Normalizes every string in `req.body` before it reaches route handlers and
// Zod validation. Two passes per string:
//
//   1. STRIP invisible Unicode characters (LRM, RLM, BOM, ZWSP, etc.)
//   2. TRIM leading/trailing whitespace
//
// Both passes are needed because they catch different bugs we hit in
// production:
//
//   - Bug #1 (LRM, 2026-05-31): Arabic input from mobile keyboards smuggled
//     in U+200E LEFT-TO-RIGHT MARK. Postgres treated "سطيف" and "سطيف<LRM>"
//     as different strings, so groupBy queries returned the same wilaya as
//     two separate groups. Picker showed "Sétif · 1 hotel" instead of 9.
//
//   - Bug #2 (leading space, 2026-05-31): Mermoura Hotel was saved with
//     city = " guelma" (leading space). `WHERE city = 'guelma'` never
//     matched. Hotel was invisible in search even though it was active.
//
// Both bugs were impossible to spot visually in the admin UI — the
// rendered text looked identical to clean input. Catching them at the
// API edge means future records can't suffer the same fate, regardless
// of where the partner's input came from (phone keyboard, copy-paste,
// stripped-down editor, etc.).
//
// =============================================================================
// What gets STRIPPED (invisible characters):
//
//   U+200E  LEFT-TO-RIGHT MARK         (LRM)   <- Bug #1
//   U+200F  RIGHT-TO-LEFT MARK         (RLM)
//   U+202A  LEFT-TO-RIGHT EMBEDDING    (LRE)
//   U+202B  RIGHT-TO-LEFT EMBEDDING    (RLE)
//   U+202C  POP DIRECTIONAL FORMATTING (PDF)
//   U+202D  LEFT-TO-RIGHT OVERRIDE     (LRO)
//   U+202E  RIGHT-TO-LEFT OVERRIDE     (RLO)
//   U+2066-U+2069  directional isolates (LRI / RLI / FSI / PDI)
//   U+FEFF  ZERO WIDTH NO-BREAK SPACE  (BOM)
//   U+200B  ZERO WIDTH SPACE
//   U+200C  ZERO WIDTH NON-JOINER
//
// U+200D ZERO WIDTH JOINER is INTENTIONALLY preserved — required for some
// emoji sequences (e.g. family emojis) and legitimate Arabic ligatures.
//
// =============================================================================
// What gets TRIMMED:
//
//   Only leading and trailing whitespace (.trim() semantics). Interior
//   whitespace is preserved — "Sidi Bel Abbès" stays "Sidi Bel Abbès",
//   multi-line descriptions keep their line breaks.
//
// =============================================================================

const INVISIBLE_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u200B\u200C]/g;

function cleanString(value) {
  if (typeof value !== "string") return value;

  // Fast path: short-circuit when no work is needed. Saves an allocation
  // on the common case where the field is already clean.
  const hasInvisibles = INVISIBLE_RE.test(value);
  const needsTrim = value !== value.trim();
  if (!hasInvisibles && !needsTrim) return value;

  let out = value;
  if (hasInvisibles) out = out.replace(INVISIBLE_RE, "");
  if (out !== out.trim()) out = out.trim();
  return out;
}

// Recursively walk a parsed JSON body. Mutates in place — the body is
// already a fresh object built by Express's json parser, so we own it.
function cleanDeep(obj) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i];
      if (typeof v === "string") obj[i] = cleanString(v);
      else if (v && typeof v === "object") cleanDeep(v);
    }
    return obj;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string") obj[k] = cleanString(v);
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
  cleanString,        // exported so admin SQL utils / migrations can use it too
  stripInvisibles: cleanString, // back-compat alias (older code may import this)
};
