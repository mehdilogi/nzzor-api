// =============================================================================
// The 69 wilayas of Algeria (law on territorial organisation, Nov. 2025 —
// 58 wilayas plus 11 new ones numbered 59–69).
// -----------------------------------------------------------------------------
// A hotel's `city` is the town it is in (Tichy, Bou Saâda, Hammam Righa…), and
// a town is not a wilaya. Each hotel also stores its wilaya code (`wilaya`,
// "01"–"69"), chosen in the admin; the homepage counts DISTINCT codes.
//
// resolveWilaya() guesses the code from the names already typed in the admin
// (town first, then region). It fills the admin dropdown for older hotels and
// is the fallback when a hotel was saved without one.
// =============================================================================

// [code, French, English, Arabic, other spellings and towns of the wilaya]
const RAW = [
  ["01", "Adrar", "Adrar", "أدرار", ["Reggane", "Aoulef"]],
  ["02", "Chlef", "Chlef", "الشلف", ["El Asnam", "Ech Cheliff", "Ténès", "Tenes"]],
  ["03", "Laghouat", "Laghouat", "الأغواط", []],
  ["04", "Oum El Bouaghi", "Oum El Bouaghi", "أم البواقي", ["OEB", "Aïn Beïda", "Ain Beida", "Aïn M'lila", "Ain Mlila"]],
  ["05", "Batna", "Batna", "باتنة", ["Timgad", "Arris", "Merouana"]],
  ["06", "Béjaïa", "Bejaia", "بجاية", ["Bgayet", "Bougie", "Tichy", "Aokas", "Souk El Tenine", "Akbou", "Melbou", "Boulimat"]],
  ["07", "Biskra", "Biskra", "بسكرة", ["Tolga", "Sidi Okba", "Hammam Salihine"]],
  ["08", "Béchar", "Bechar", "بشار", ["Kenadsa", "Taghit Bechar"]],
  ["09", "Blida", "Blida", "البليدة", ["Chréa", "Chrea", "Boufarik"]],
  ["10", "Bouira", "Bouira", "البويرة", ["Bouïra", "Tikjda", "Lakhdaria"]],
  ["11", "Tamanrasset", "Tamanrasset", "تمنراست", ["Tamanghasset", "Tam", "Assekrem", "تامنغست"]],
  ["12", "Tébessa", "Tebessa", "تبسة", ["Cheria"]],
  ["13", "Tlemcen", "Tlemcen", "تلمسان", ["Ghazaouet", "Maghnia", "Marsa Ben M'Hidi", "Marsa Ben Mhidi", "Lalla Setti"]],
  ["14", "Tiaret", "Tiaret", "تيارت", ["Tihert", "Frenda"]],
  ["15", "Tizi Ouzou", "Tizi Ouzou", "تيزي وزو", ["Tigzirt", "Azeffoun", "Azazga", "Larbaa Nath Irathen", "Draa El Mizan", "Yakouren", "تيزي وز"]],
  ["16", "Alger", "Algiers", "الجزائر", ["Algiers", "Alger Centre", "El Djazair", "Dzair", "Zéralda", "Zeralda", "Sidi Fredj", "Staouéli", "Staoueli", "Bab Ezzouar", "Hydra", "Ben Aknoun", "Dely Ibrahim", "Chéraga", "Cheraga", "Aïn Benian", "Ain Benian", "Rouiba", "Dar El Beida", "Bordj El Kiffan", "El Biar", "Kouba", "Bir Mourad Rais", "Hussein Dey", "Draria", "Ouled Fayet", "Mohammadia", "الجزائر العاصمة"]],
  ["17", "Djelfa", "Djelfa", "الجلفة", ["Hassi Bahbah"]],
  ["18", "Jijel", "Jijel", "جيجل", ["Djidjelli", "Ziama Mansouriah", "El Aouana", "Taher"]],
  ["19", "Sétif", "Setif", "سطيف", ["El Eulma", "Aïn Arnat", "Ain Arnat", "Aïn Oulmene", "Ain Oulmene"]],
  ["20", "Saïda", "Saida", "سعيدة", []],
  ["21", "Skikda", "Skikda", "سكيكدة", ["Collo", "Philippeville", "Stora"]],
  ["22", "Sidi Bel Abbès", "Sidi Bel Abbes", "سيدي بلعباس", ["SBA", "Bel Abbès", "Bel Abbes"]],
  ["23", "Annaba", "Annaba", "عنابة", ["Bône", "Bone", "Seraïdi", "Seraidi", "El Bouni"]],
  ["24", "Guelma", "Guelma", "قالمة", ["Hammam Debagh", "Hammam Meskoutine", "Hammam Chellala"]],
  ["25", "Constantine", "Constantine", "قسنطينة", ["Qacentina", "Ali Mendjeli", "El Khroub", "Aïn Smara", "Ain Smara"]],
  ["26", "Médéa", "Medea", "المدية", ["Berrouaghia", "Tablat"]],
  ["27", "Mostaganem", "Mostaganem", "مستغانم", ["Sidi Lakhdar", "Salamandre"]],
  ["28", "M'Sila", "M'Sila", "المسيلة", ["Msila", "Sidi Aïssa", "Sidi Aissa"]],
  ["29", "Mascara", "Mascara", "معسكر", ["Mouaskar", "Sig", "Bou Hanifia", "Hammam Bou Hanifia"]],
  ["30", "Ouargla", "Ouargla", "ورقلة", ["Wargla", "Hassi Messaoud"]],
  ["31", "Oran", "Oran", "وهران", ["Wahran", "Aïn El Turck", "Ain El Turck", "Ain Turk", "Bir El Djir", "Es Senia", "Es Sénia", "Arzew", "Canastel", "Les Andalouses", "Bousfer", "Mers El Kébir", "Mers El Kebir"]],
  ["32", "El Bayadh", "El Bayadh", "البيض", ["El Bayed", "Bayadh"]],
  ["33", "Illizi", "Illizi", "إليزي", ["اليزي"]],
  ["34", "Bordj Bou Arréridj", "Bordj Bou Arreridj", "برج بوعريريج", ["BBA", "Bordj Bou Arreridj", "Bordj"]],
  ["35", "Boumerdès", "Boumerdes", "بومرداس", ["Zemmouri", "Corso", "Dellys", "Boudouaou"]],
  ["36", "El Tarf", "El Tarf", "الطارف", ["El Kala", "La Calle", "القالة"]],
  ["37", "Tindouf", "Tindouf", "تندوف", []],
  ["38", "Tissemsilt", "Tissemsilt", "تيسمسيلت", ["تسمسيلت", "Theniet El Had"]],
  ["39", "El Oued", "El Oued", "الوادي", ["Oued Souf", "Souf"]],
  ["40", "Khenchela", "Khenchela", "خنشلة", []],
  ["41", "Souk Ahras", "Souk Ahras", "سوق أهراس", []],
  ["42", "Tipaza", "Tipaza", "تيبازة", ["Tipasa", "Cherchell", "Bou Ismaïl", "Bou Ismail", "Fouka", "Kolea", "Koléa", "Douaouda", "Hadjout"]],
  ["43", "Mila", "Mila", "ميلة", ["Chelghoum Laïd", "Chelghoum Laid", "Ferdjioua"]],
  ["44", "Aïn Defla", "Ain Defla", "عين الدفلى", ["Hammam Righa", "Miliana", "Khemis Miliana"]],
  ["45", "Naâma", "Naama", "النعامة", ["Aïn Sefra", "Ain Sefra", "Mécheria", "Mecheria"]],
  ["46", "Aïn Témouchent", "Ain Temouchent", "عين تموشنت", ["Béni Saf", "Beni Saf", "Hammam Bouhadjar", "Terga"]],
  ["47", "Ghardaïa", "Ghardaia", "غرداية", ["Beni Isguen", "Béni Isguen", "Metlili", "Mzab", "M'zab", "Melika", "El Atteuf", "Bounoura", "Berriane"]],
  ["48", "Relizane", "Relizane", "غليزان", ["Ghilizane"]],
  ["49", "Timimoun", "Timimoun", "تيميمون", []],
  ["50", "Bordj Badji Mokhtar", "Bordj Badji Mokhtar", "برج باجي مختار", ["BBM"]],
  ["51", "Ouled Djellal", "Ouled Djellal", "أولاد جلال", ["Sidi Khaled"]],
  ["52", "Béni Abbès", "Beni Abbes", "بني عباس", ["Taghit", "Igli", "Kerzaz"]],
  ["53", "In Salah", "In Salah", "عين صالح", ["Ain Salah", "Aïn Salah", "In-Salah"]],
  ["54", "In Guezzam", "In Guezzam", "عين قزام", ["Ain Guezzam", "In-Guezzam", "عين قزّام"]],
  ["55", "Touggourt", "Touggourt", "تقرت", ["Tuggurt", "Temacine", "Témacine"]],
  ["56", "Djanet", "Djanet", "جانت", ["Tassili", "Tassili n'Ajjer"]],
  ["57", "El M'Ghair", "El M'Ghair", "المغير", ["El Meghaier", "El Mghair", "El Meghaïer", "Djamaa"]],
  ["58", "El Menia", "El Menia", "المنيعة", ["El Meniaa", "El Goléa", "El Golea"]],
  ["59", "Aflou", "Aflou", "آفلو", ["أفلو"]],
  ["60", "Barika", "Barika", "بريكة", ["Brika"]],
  ["61", "El Kantara", "El Kantara", "القنطرة", ["El Qantara"]],
  ["62", "Bir El Ater", "Bir El Ater", "بئر العاتر", ["Bir El Ather"]],
  ["63", "El Aricha", "El Aricha", "العريشة", []],
  ["64", "Ksar Chellala", "Ksar Chellala", "قصر الشلالة", ["Ksar Challala", "Ksar El Chellala"]],
  ["65", "Aïn Oussera", "Ain Oussera", "عين وسارة", ["Ain Oussara", "Aïn Oussara"]],
  ["66", "Messaad", "Messaad", "مسعد", ["Mesaad", "Mes'aad"]],
  ["67", "Ksar El Boukhari", "Ksar El Boukhari", "قصر البخاري", ["Ksar Boukhari"]],
  ["68", "Bou Saâda", "Bou Saada", "بوسعادة", ["Bousaada", "Boussaada", "Bou-Saada", "Bousaâda", "بو سعادة"]],
  ["69", "El Abiodh Sidi Cheikh", "El Abiodh Sidi Cheikh", "الأبيض سيدي الشيخ", ["El Abiod Sidi Cheikh", "Abiodh Sidi Cheikh"]],
];

const WILAYAS = RAW.map(([code, fr, en, ar]) => ({ code, fr, en, ar }));
const CODES = new Set(WILAYAS.map((w) => w.code));
const BY_CODE = Object.fromEntries(WILAYAS.map((w) => [w.code, w]));

// Compare names on letters only: no accents, case, spaces, hyphens or
// apostrophes ("Aïn El-Türck" = "ain el turck"); Arabic alef / ta marbuta /
// ya variants unified.
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*(wilaya|willaya|province)\s+(de|d'|of)?\s*/i, "")
    .replace(/^\s*ولاية\s+/, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ً-ْـ]/g, "") // harakat, tatweel
    .replace(/[^a-z0-9ء-ي]/g, "");
}

const INDEX = new Map();
for (const [code, fr, en, ar, other] of RAW) {
  for (const name of [fr, en, ar, ...other]) {
    const k = norm(name);
    if (k && !INDEX.has(k)) INDEX.set(k, code);
  }
}

/**
 * Wilaya code for a hotel from the names typed in the admin, or null.
 * Town names are tried first, then the region fields.
 */
function resolveWilaya(h) {
  if (!h) return null;
  if (h.wilaya && CODES.has(h.wilaya)) return h.wilaya;
  const tries = [h.cityFr, h.cityEn, h.city, h.cityAr, h.regionFr, h.regionEn, h.regionAr];
  for (const t of tries) {
    const code = INDEX.get(norm(t));
    if (code) return code;
  }
  return null;
}

const isWilayaCode = (c) => CODES.has(String(c || ""));

module.exports = { WILAYAS, BY_CODE, resolveWilaya, isWilayaCode, norm };
