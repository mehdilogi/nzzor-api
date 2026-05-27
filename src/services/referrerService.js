// =============================================================================
// Nzzor — Referrer Source Classification
// =============================================================================
// Maps an arbitrary referrer URL to a human-readable "source bucket" for the
// traffic-sources card on the analytics dashboard. Examples:
//
//   https://www.google.com/search?q=algeria+hotels    → "google"
//   https://l.facebook.com/l.php?u=...                → "facebook"
//   https://t.co/AbCdEf                               → "twitter"
//   (empty)                                           → "direct"
//   https://nzzor.com/hotels                          → "internal"
//
// Buckets are deliberately coarse — finer than this and the chart becomes a
// long-tail mess. Add new patterns as we see them in the data.
// =============================================================================

// Ordered list of (regex, bucket) pairs. First match wins.
// Hostnames only; we don't care about the path for classification.
const PATTERNS = [
  // Search engines
  [/^(www\.)?(google|googleusercontent)\./i,           "google"],
  [/^(www\.)?bing\./i,                                  "bing"],
  [/^(www\.)?(yahoo|search\.yahoo)\./i,                 "yahoo"],
  [/^(www\.)?duckduckgo\./i,                            "duckduckgo"],
  [/^(www\.)?yandex\./i,                                "yandex"],
  [/^(www\.)?baidu\./i,                                 "baidu"],
  [/^(www\.)?ecosia\./i,                                "ecosia"],

  // Social
  [/^(.+\.)?facebook\.|^fb\./i,                         "facebook"],
  [/^(www\.)?instagram\./i,                             "instagram"],
  [/^(www\.)?(twitter|x)\.|^t\.co$/i,                   "twitter"],
  [/^(www\.)?linkedin\.|^lnkd\.in$/i,                   "linkedin"],
  [/^(www\.)?(tiktok|vm\.tiktok)\./i,                   "tiktok"],
  [/^(www\.)?reddit\.|^old\.reddit\./i,                 "reddit"],
  [/^(www\.)?pinterest\./i,                             "pinterest"],
  [/^(www\.)?snapchat\./i,                              "snapchat"],
  [/^(.+\.)?youtube\.|^youtu\.be$/i,                    "youtube"],
  [/^(.+\.)?threads\.net$/i,                            "threads"],

  // Messaging — surprisingly common as travel referrers
  [/^(.+\.)?whatsapp\.|^api\.whatsapp\.com$/i,          "whatsapp"],
  [/^(.+\.)?telegram\./i,                               "telegram"],
  [/^(.+\.)?messenger\.com$/i,                          "messenger"],

  // Email — when somebody opens a link in their webmail
  [/^(mail\.google\.com|outlook\.live\.com|mail\.yahoo)/i, "email"],
];

/**
 * Classify a referrer URL into a source bucket.
 *
 * @param {string|null|undefined} referrer  Raw document.referrer string
 * @param {string} ownDomain  Our own hostname, to detect internal navigation
 * @returns {string}  Bucket like "google", "direct", "internal", "other"
 */
function classifyReferrer(referrer, ownDomain = "nzzor.com") {
  if (!referrer || referrer.length === 0) return "direct";

  let host;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "other";  // Malformed referrer
  }

  // Our own domain → internal navigation (don't double-count as traffic)
  if (host === ownDomain || host.endsWith(`.${ownDomain}`)) return "internal";

  for (const [re, bucket] of PATTERNS) {
    if (re.test(host)) return bucket;
  }

  // Unknown external referrer — keep the bare domain for the dashboard, but
  // also bucket as "other" for the high-level card. The dashboard query can
  // pivot on either.
  return "other";
}

/**
 * Extract the bare hostname (without 'www.') for the dashboard's "specific
 * referrers" detail view. Returns null when no host can be parsed.
 */
function referrerHost(referrer) {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

module.exports = { classifyReferrer, referrerHost };
