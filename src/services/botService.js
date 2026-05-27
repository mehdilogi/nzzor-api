// =============================================================================
// Nzzor — Bot / non-human traffic detection
// =============================================================================
// Used by the analytics beacon to drop bot pageviews before they pollute the
// numbers. We err toward false-positives (mark suspicious traffic as bot)
// rather than letting bots through — a bot in the data is more harmful to
// decision-making than an under-count.
//
// Sources for the patterns:
//   - https://github.com/monperrus/crawler-user-agents (most-comprehensive list)
//   - Cloudflare's own bot signatures (well-documented common ones)
//   - Empirical observations: missing UA, headless markers, suspicious headers
// =============================================================================

// Single regex covering the vast majority of real-world bots. Kept terse;
// false positives on rare human UAs are acceptable. Updated when we see
// noise in the data.
const BOT_UA_RE = /bot|crawl|spider|slurp|fetch|http(?!.+mozilla)|wget|curl|python-requests|libwww|java\/|httpunit|nutch|jakarta|httpclient|axios|scrapy|playwright|puppeteer|headlesschrome|phantomjs|selenium|webdriver|lighthouse|google\s?page|googlebot|adsbot|bingpreview|yandex|baiduspider|duckduckbot|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview|applebot|pinterest|pingdom|gtmetrix|datadog|uptimerobot|monitor|prerender|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|exabot|sogou|ia_archiver|archive\.org_bot/i;

// Headless markers in the UA (set by some automated tools).
const HEADLESS_UA_RE = /HeadlessChrome|PhantomJS|Puppeteer|Playwright/i;

/**
 * Decide whether this request looks like a bot.
 *
 * @param {object} signals
 * @param {string|null} signals.ua            User-Agent header
 * @param {string|null} signals.accept        Accept header
 * @param {string|null} signals.acceptLang    Accept-Language header
 * @param {boolean}     signals.webdriver     navigator.webdriver from the client
 * @returns {boolean}
 */
function isBot({ ua, accept, acceptLang, webdriver } = {}) {
  // 1. Client-reported automation marker — strongest signal.
  if (webdriver === true) return true;

  // 2. Missing UA — no real browser omits this. Likely script.
  if (!ua || ua.length < 10) return true;

  // 3. UA matches known bot string.
  if (BOT_UA_RE.test(ua)) return true;
  if (HEADLESS_UA_RE.test(ua)) return true;

  // 4. Missing Accept header — browsers always send it; scripts often don't.
  //    (We send this from the client beacon explicitly to avoid false-flagging
  //    fetch() calls. Real browsers requesting an HTML page would have it.)
  if (!accept) return true;

  // 5. Missing Accept-Language — also very rare for real browsers, common
  //    for scripts. Not 100% conclusive, so combined with other hints rather
  //    than used alone. Skipping for now to avoid false-positives on
  //    legitimate users with unusual setups.

  return false;
}

/**
 * Crude device-type classification from UA. Returns:
 *   - "mobile" — phones
 *   - "tablet" — tablets (when distinguishable; iPad masquerades as desktop
 *               on iPadOS 13+ so we can't always tell)
 *   - "desktop" — everything else
 *   - "bot" — when the UA looks bot-shaped (defensive duplicate of isBot)
 */
function deviceFromUA(ua) {
  if (!ua) return "desktop";
  if (BOT_UA_RE.test(ua) || HEADLESS_UA_RE.test(ua)) return "bot";
  if (/mobile|iphone|ipod|android(?!.+tablet)|blackberry|windows phone/i.test(ua)) return "mobile";
  if (/tablet|ipad|playbook|silk/i.test(ua)) return "tablet";
  return "desktop";
}

module.exports = { isBot, deviceFromUA };
