// =============================================================================
// Nzzor — Canonical tag dictionary
// One source of truth for AI-search tags. Keys are internal (English-rooted,
// snake_case). Labels are trilingual for the UI.
//
// When adding/removing tags, update this list AND re-tag existing hotels
// from the admin so the data stays consistent.
// =============================================================================

const TAGS = [
  // Location / setting
  { key: "beach",        en: "Beach",            fr: "Plage",                ar: "شاطئ" },
  { key: "sahara",       en: "Sahara",           fr: "Sahara",               ar: "صحراء" },
  { key: "city",         en: "City",             fr: "Urbain",               ar: "حضري" },
  { key: "mountain",     en: "Mountain",         fr: "Montagne",             ar: "جبل" },
  { key: "city_center",  en: "City center",      fr: "Centre-ville",         ar: "وسط المدينة" },

  // Audience / occasion
  { key: "family",       en: "Family-friendly",  fr: "Familial",             ar: "عائلي" },
  { key: "business",     en: "Business",         fr: "Affaires",             ar: "أعمال" },
  { key: "romantic",     en: "Romantic",         fr: "Romantique",           ar: "رومانسي" },
  { key: "luxury",       en: "Luxury",           fr: "Luxe",                 ar: "فاخر" },
  { key: "historic",     en: "Historic",         fr: "Historique",           ar: "تاريخي" },

  // Amenities / features
  { key: "pool",         en: "Pool",             fr: "Piscine",              ar: "حمام سباحة" },
  { key: "spa",          en: "Spa",              fr: "Spa",                  ar: "منتجع صحي" },
  { key: "breakfast_included", en: "Breakfast included", fr: "Petit-déjeuner inclus", ar: "وجبة الإفطار" },
  { key: "sea_view",     en: "Sea view",         fr: "Vue mer",              ar: "إطلالة على البحر" },
  { key: "garden_view",  en: "Garden view",      fr: "Vue jardin",           ar: "إطلالة على الحديقة" },
];

const TAG_KEYS = TAGS.map((t) => t.key);
const TAG_BY_KEY = Object.fromEntries(TAGS.map((t) => [t.key, t]));

// Aliases used by the natural-language search parser.
// Each tag can have multiple ways to express it across EN/FR/AR. The parser
// looks for ANY of these substrings in the user's query and adds the tag.
// Keep lowercase, no diacritics expected (the parser normalizes).
const TAG_ALIASES = {
  beach:       ["beach", "seaside", "by the sea", "plage", "bord de mer", "au bord de mer", "شاطئ"],
  sahara:      ["sahara", "desert", "dune", "dunes", "désert", "sahara", "صحراء", "كثبان"],
  city:        ["city", "urban", "ville", "urbain", "حضري", "مدينة"],
  mountain:    ["mountain", "mountains", "montagne", "montagnes", "جبل", "جبال"],
  city_center: ["city center", "city centre", "downtown", "centre-ville", "centre ville", "وسط المدينة", "وسط البلد"],
  family:      ["family", "family friendly", "family-friendly", "kids", "children", "with kids", "familial", "famille", "enfants", "عائل", "أطفال"],
  business:    ["business", "work", "for business", "affaires", "professionnel", "أعمال", "عمل"],
  romantic:    ["romantic", "honeymoon", "couple", "romantique", "lune de miel", "رومانسي", "شهر العسل"],
  luxury:      ["luxury", "luxurious", "5 star", "five star", "luxe", "luxueux", "فاخر", "فخم"],
  historic:    ["historic", "historical", "heritage", "old town", "historique", "patrimoine", "تاريخ", "تراث"],
  pool:        ["pool", "swimming pool", "piscine", "حمام سباحة", "مسبح"],
  spa:         ["spa", "wellness", "hammam", "spa", "منتجع صحي", "حمّام"],
  breakfast_included: ["breakfast included", "with breakfast", "breakfast", "petit-déjeuner", "petit dejeuner", "إفطار", "فطور"],
  sea_view:    ["sea view", "ocean view", "sea-view", "vue mer", "vue sur mer", "إطلالة على البحر", "إطلالة بحرية"],
  garden_view: ["garden view", "garden-view", "vue jardin", "vue sur jardin", "إطلالة على الحديقة"],
};

function localizeTag(key, lang = "en") {
  const t = TAG_BY_KEY[key];
  if (!t) return key;
  return t[lang] || t.en;
}

module.exports = { TAGS, TAG_KEYS, TAG_BY_KEY, TAG_ALIASES, localizeTag };
