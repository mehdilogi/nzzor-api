// =============================================================================
// Nzzor — Database Seed
// 10 launch hotels with full multilingual data
// Run: npm run db:seed
// =============================================================================

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

async function main() {
  console.log("🇩🇿 Seeding Nzzor database (by Allouni Travel Agency)...\n");

  console.log("  → Amenities...");
  const amenityData = [
    { key: "wifi", nameEn: "Free Wi-Fi", nameFr: "Wi-Fi Gratuit", nameAr: "واي فاي مجاني", icon: "🌐", category: "facilities" },
    { key: "pool", nameEn: "Swimming Pool", nameFr: "Piscine", nameAr: "مسبح", icon: "🏊", category: "wellness" },
    { key: "spa", nameEn: "Spa & Hammam", nameFr: "Spa & Hammam", nameAr: "سبا وحمام", icon: "🧖", category: "wellness" },
    { key: "restaurant", nameEn: "Restaurant", nameFr: "Restaurant", nameAr: "مطعم", icon: "🍽️", category: "dining" },
    { key: "gym", nameEn: "Fitness Center", nameFr: "Salle de Sport", nameAr: "صالة رياضة", icon: "💪", category: "wellness" },
    { key: "parking", nameEn: "Free Parking", nameFr: "Parking Gratuit", nameAr: "موقف مجاني", icon: "🅿️", category: "facilities" },
    { key: "room_service", nameEn: "24h Room Service", nameFr: "Service en Chambre 24h", nameAr: "خدمة غرف 24 ساعة", icon: "🛎️", category: "facilities" },
    { key: "bar", nameEn: "Bar / Lounge", nameFr: "Bar / Salon", nameAr: "بار / صالة", icon: "🍸", category: "dining" },
    { key: "business", nameEn: "Business Center", nameFr: "Centre d'Affaires", nameAr: "مركز أعمال", icon: "💼", category: "facilities" },
    { key: "beach", nameEn: "Beach Access", nameFr: "Accès Plage", nameAr: "وصول للشاطئ", icon: "🏖️", category: "activities" },
    { key: "golf", nameEn: "Golf Course", nameFr: "Terrain de Golf", nameAr: "ملعب غولف", icon: "⛳", category: "activities" },
    { key: "water_sports", nameEn: "Water Sports", nameFr: "Sports Nautiques", nameAr: "رياضات مائية", icon: "🚤", category: "activities" },
    { key: "tours", nameEn: "Guided Tours", nameFr: "Visites Guidées", nameAr: "جولات مرشدة", icon: "🗺️", category: "activities" },
    { key: "stargazing", nameEn: "Stargazing", nameFr: "Observation Étoiles", nameAr: "مراقبة النجوم", icon: "🌌", category: "activities" },
    { key: "courtyard", nameEn: "Inner Courtyard", nameFr: "Cour Intérieure", nameAr: "فناء داخلي", icon: "🏛️", category: "facilities" },
    { key: "rooftop", nameEn: "Rooftop Terrace", nameFr: "Terrasse Toit", nameAr: "شرفة السطح", icon: "🌇", category: "facilities" },
    { key: "garden", nameEn: "Garden", nameFr: "Jardin", nameAr: "حديقة", icon: "🌿", category: "facilities" },
    { key: "library", nameEn: "Library", nameFr: "Bibliothèque", nameAr: "مكتبة", icon: "📚", category: "facilities" },
    { key: "camel_treks", nameEn: "Camel Treks", nameFr: "Randonnées Chameau", nameAr: "رحلات الجمال", icon: "🐪", category: "activities" },
    { key: "kayaking", nameEn: "Kayaking", nameFr: "Kayak", nameAr: "التجديف", icon: "🚣", category: "activities" },
    { key: "tea_ceremony", nameEn: "Traditional Tea", nameFr: "Thé Traditionnel", nameAr: "شاي تقليدي", icon: "☕", category: "dining" },
  ];

  for (const a of amenityData) {
    await prisma.amenity.upsert({ where: { key: a.key }, update: a, create: a });
  }

  console.log("  → Hotels...");
  const hotels = [
    {
      slug: "royal-maqam-algiers",
      nameEn: "Royal Maqam Hotel & Spa", nameFr: "Royal Maqam Hôtel & Spa", nameAr: "فندق رويال مقام والسبا",
      descEn: "Perched on the hills of Algiers with sweeping Mediterranean views, Royal Maqam combines Ottoman grandeur with contemporary luxury. Hand-carved cedar details and marble from the Fil-Fila quarries.",
      descFr: "Perché sur les collines d'Alger avec vue méditerranéenne, alliant grandeur ottomane et luxe contemporain. Cèdre sculpté et marbre de Fil-Fila.",
      descAr: "يقع على تلال الجزائر العاصمة مع إطلالات خلابة على المتوسط. يجمع بين الفخامة العثمانية والرفاهية المعاصرة.",
      stars: 5, city: "algiers", cityEn: "Algiers", cityFr: "Alger", cityAr: "الجزائر العاصمة",
      regionEn: "Algiers Province", regionFr: "Wilaya d'Alger", regionAr: "ولاية الجزائر",
      latitude: 36.7538, longitude: 3.0588, rating: 9.2, reviewCount: 342, isFeatured: true,
      amenityKeys: ["wifi", "pool", "spa", "restaurant", "gym", "parking", "room_service", "bar", "business", "beach"],
      rooms: [
        { typeEn: "Deluxe Sea View", typeFr: "Deluxe Vue Mer", typeAr: "ديلوكس بحرية", basePrice: 28000, capacity: 2, sizeSqm: 35, bedType: "King", totalUnits: 8 },
        { typeEn: "Premium Suite", typeFr: "Suite Premium", typeAr: "جناح بريميوم", basePrice: 42000, capacity: 3, sizeSqm: 55, bedType: "King", totalUnits: 4 },
        { typeEn: "Royal Suite", typeFr: "Suite Royale", typeAr: "الجناح الملكي", basePrice: 68000, capacity: 4, sizeSqm: 90, bedType: "King + Twin", totalUnits: 2 },
      ],
      photos: [
        "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=85",
        "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=1200&q=85",
        "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200&q=85",
        "https://images.unsplash.com/photo-1590490360182-c33d7f9d02e0?w=1200&q=85",
      ],
    },
    {
      slug: "tassili-sands-djanet",
      nameEn: "Tassili Sands Resort", nameFr: "Tassili Sands Resort", nameAr: "منتجع تاسيلي ساندز",
      descEn: "An oasis at the gateway to the Tassili n'Ajjer. Tuareg-inspired luxury with stargazing terraces and excursions to 12,000-year-old UNESCO rock art.",
      descFr: "Oasis aux portes du Tassili n'Ajjer. Luxe touareg avec terrasses d'observation des étoiles.",
      descAr: "واحة عند بوابة طاسيلي ناجر. فخامة مستوحاة من التوارق مع شرفات لمراقبة النجوم.",
      stars: 4, city: "djanet", cityEn: "Djanet", cityFr: "Djanet", cityAr: "جانت",
      regionEn: "Illizi Province", regionFr: "Wilaya d'Illizi", regionAr: "ولاية إليزي",
      latitude: 24.5547, longitude: 9.4863, rating: 9.5, reviewCount: 187, isFeatured: true,
      checkInTime: "15:00", checkOutTime: "11:00",
      amenityKeys: ["wifi", "pool", "restaurant", "parking", "tours", "stargazing", "camel_treks", "tea_ceremony"],
      rooms: [
        { typeEn: "Desert View Room", typeFr: "Chambre Vue Désert", typeAr: "غرفة صحراوية", basePrice: 22000, capacity: 2, sizeSqm: 30, bedType: "King", totalUnits: 10 },
        { typeEn: "Tassili Suite", typeFr: "Suite Tassili", typeAr: "جناح تاسيلي", basePrice: 35000, capacity: 2, sizeSqm: 50, bedType: "King", totalUnits: 4 },
        { typeEn: "Sahara Villa", typeFr: "Villa Sahara", typeAr: "فيلا الصحراء", basePrice: 55000, capacity: 4, sizeSqm: 80, bedType: "2 Kings", totalUnits: 2 },
      ],
      photos: [
        "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1200&q=85",
        "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1200&q=85",
        "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200&q=85",
        "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=85",
      ],
    },
    {
      slug: "constantine-palace",
      nameEn: "Constantine Palace Hotel", nameFr: "Constantine Palace Hôtel", nameAr: "فندق قصر قسنطينة",
      descEn: "Overlooking the dramatic Rhumel gorges, a tribute to the City of Bridges. Andalusian architecture meets modern comfort with panoramic views.",
      descFr: "Surplombant les gorges du Rhumel, hommage à la ville des ponts. Architecture andalouse et confort moderne.",
      descAr: "يطل على أخاديد وادي الرمال. عمارة أندلسية مع إطلالات بانورامية.",
      stars: 5, city: "constantine", cityEn: "Constantine", cityFr: "Constantine", cityAr: "قسنطينة",
      regionEn: "Constantine Province", regionFr: "Wilaya de Constantine", regionAr: "ولاية قسنطينة",
      latitude: 36.365, longitude: 6.6147, rating: 8.9, reviewCount: 256, isFeatured: true,
      amenityKeys: ["wifi", "restaurant", "gym", "parking", "room_service", "bar", "business", "spa"],
      rooms: [
        { typeEn: "Classic Room", typeFr: "Chambre Classique", typeAr: "غرفة كلاسيكية", basePrice: 25000, capacity: 2, sizeSqm: 28, bedType: "Queen", totalUnits: 12 },
        { typeEn: "Gorge View Suite", typeFr: "Suite Vue Gorge", typeAr: "جناح الأخدود", basePrice: 38000, capacity: 2, sizeSqm: 48, bedType: "King", totalUnits: 4 },
        { typeEn: "Presidential Suite", typeFr: "Suite Présidentielle", typeAr: "الجناح الرئاسي", basePrice: 72000, capacity: 4, sizeSqm: 100, bedType: "King + Twin", totalUnits: 1 },
      ],
      photos: [
        "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1200&q=85",
        "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=1200&q=85",
        "https://images.unsplash.com/photo-1584132967334-10e028bd69f7?w=1200&q=85",
        "https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=1200&q=85",
      ],
    },
    {
      slug: "casbah-heritage-inn",
      nameEn: "Casbah Heritage Inn", nameFr: "Casbah Heritage Inn", nameAr: "نزل تراث القصبة",
      descEn: "Restored Ottoman riad in the UNESCO Casbah. Zellige tilework, carved stucco, and centuries-old courtyard fountains.",
      descFr: "Riad ottoman restauré dans la Casbah UNESCO. Zellige, stuc sculpté et fontaines centenaires.",
      descAr: "رياض عثماني مرمم في قصبة الجزائر. زليج وجبس منحوت ونوافير عمرها قرون.",
      stars: 4, city: "algiers", cityEn: "Algiers", cityFr: "Alger", cityAr: "الجزائر العاصمة",
      regionEn: "Algiers Province", regionFr: "Wilaya d'Alger", regionAr: "ولاية الجزائر",
      latitude: 36.7852, longitude: 3.0597, rating: 8.7, reviewCount: 198,
      checkInTime: "15:00", checkOutTime: "11:00",
      amenityKeys: ["wifi", "restaurant", "room_service", "courtyard", "rooftop", "library"],
      rooms: [
        { typeEn: "Heritage Room", typeFr: "Chambre Patrimoine", typeAr: "غرفة تراثية", basePrice: 18000, capacity: 2, sizeSqm: 25, bedType: "Queen", totalUnits: 6 },
        { typeEn: "Courtyard Suite", typeFr: "Suite Cour", typeAr: "جناح الفناء", basePrice: 28000, capacity: 2, sizeSqm: 40, bedType: "King", totalUnits: 3 },
      ],
      photos: [
        "https://images.unsplash.com/photo-1590490360182-c33d7f9d02e0?w=1200&q=85",
        "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=85",
        "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200&q=85",
        "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=1200&q=85",
      ],
    },
    {
      slug: "azur-beach-oran",
      nameEn: "Azur Beach Hotel", nameFr: "Azur Beach Hôtel", nameAr: "فندق أزور بيتش",
      descEn: "Five-star Mediterranean luxury on Oran's golden coast. Infinity pools, private beach, and the finest Oranaise cuisine.",
      descFr: "Luxe méditerranéen 5 étoiles sur la côte dorée d'Oran. Piscines à débordement et plage privée.",
      descAr: "فخامة متوسطية على ساحل وهران الذهبي. مسابح لا متناهية وشاطئ خاص.",
      stars: 5, city: "oran", cityEn: "Oran", cityFr: "Oran", cityAr: "وهران",
      regionEn: "Oran Province", regionFr: "Wilaya d'Oran", regionAr: "ولاية وهران",
      latitude: 35.6969, longitude: -0.6331, rating: 9.0, reviewCount: 412, isFeatured: true,
      amenityKeys: ["wifi", "pool", "spa", "restaurant", "gym", "parking", "room_service", "bar", "beach", "water_sports"],
      rooms: [
        { typeEn: "Ocean View Room", typeFr: "Chambre Vue Océan", typeAr: "غرفة بحرية", basePrice: 32000, capacity: 2, sizeSqm: 35, bedType: "King", totalUnits: 10 },
        { typeEn: "Beach Suite", typeFr: "Suite Plage", typeAr: "جناح الشاطئ", basePrice: 48000, capacity: 3, sizeSqm: 60, bedType: "King", totalUnits: 4 },
        { typeEn: "Penthouse", typeFr: "Penthouse", typeAr: "بنتهاوس", basePrice: 85000, capacity: 4, sizeSqm: 120, bedType: "2 Kings", totalUnits: 1 },
      ],
      photos: [
        "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200&q=85",
        "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1200&q=85",
        "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=1200&q=85",
        "https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=1200&q=85",
      ],
    },
    {
      slug: "timgad-heritage-lodge",
      nameEn: "Timgad Heritage Lodge", nameFr: "Timgad Heritage Lodge", nameAr: "نزل تيمقاد التراثي",
      descEn: "Steps from Timgad, Africa's Pompeii. Stone rooms with two millennia of character and every modern comfort.",
      descFr: "À côté de Timgad, la Pompéi d'Afrique. Chambres en pierre avec confort moderne.",
      descAr: "بجوار تيمقاد، بومبي أفريقيا. غرف حجرية بطابع ألفي عام مع راحة عصرية.",
      stars: 3, city: "batna", cityEn: "Batna", cityFr: "Batna", cityAr: "باتنة",
      regionEn: "Batna Province", regionFr: "Wilaya de Batna", regionAr: "ولاية باتنة",
      latitude: 35.4849, longitude: 6.4683, rating: 8.3, reviewCount: 96,
      amenityKeys: ["wifi", "restaurant", "parking", "tours", "garden"],
      rooms: [
        { typeEn: "Standard Room", typeFr: "Chambre Standard", typeAr: "غرفة قياسية", basePrice: 12000, capacity: 2, sizeSqm: 22, bedType: "Double", totalUnits: 8 },
        { typeEn: "Superior Room", typeFr: "Chambre Supérieure", typeAr: "غرفة متفوقة", basePrice: 16000, capacity: 2, sizeSqm: 30, bedType: "King", totalUnits: 4 },
      ],
      photos: [
        "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=85",
        "https://images.unsplash.com/photo-1584132967334-10e028bd69f7?w=1200&q=85",
        "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200&q=85",
        "https://images.unsplash.com/photo-1590490360182-c33d7f9d02e0?w=1200&q=85",
      ],
    },
    {
      slug: "ghardaia-oasis",
      nameEn: "Ghardaia Oasis Hotel", nameFr: "Ghardaïa Oasis Hôtel", nameAr: "فندق واحة غرداية",
      descEn: "In the M'zab Valley UNESCO site. Ibadite architecture with pastel facades and cascading terraces.",
      descFr: "Dans la vallée du M'zab UNESCO. Architecture ibadite avec façades pastel.",
      descAr: "في وادي مزاب اليونسكو. عمارة إباضية بواجهات باستيلية.",
      stars: 4, city: "ghardaia", cityEn: "Ghardaia", cityFr: "Ghardaïa", cityAr: "غرداية",
      regionEn: "Ghardaia Province", regionFr: "Wilaya de Ghardaïa", regionAr: "ولاية غرداية",
      latitude: 32.4903, longitude: 3.6736, rating: 8.6, reviewCount: 134,
      amenityKeys: ["wifi", "restaurant", "parking", "tours", "rooftop", "garden"],
      rooms: [
        { typeEn: "M'zab Room", typeFr: "Chambre M'zab", typeAr: "غرفة مزاب", basePrice: 16000, capacity: 2, sizeSqm: 26, bedType: "Double", totalUnits: 8 },
        { typeEn: "Oasis Suite", typeFr: "Suite Oasis", typeAr: "جناح الواحة", basePrice: 26000, capacity: 3, sizeSqm: 45, bedType: "King", totalUnits: 3 },
      ],
      photos: [
        "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1200&q=85",
        "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=85",
        "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=1200&q=85",
        "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200&q=85",
      ],
    },
    {
      slug: "sheraton-club-des-pins",
      nameEn: "Sheraton Club des Pins", nameFr: "Sheraton Club des Pins", nameAr: "شيراتون نادي الصنوبر",
      descEn: "Algiers' iconic resort in Mediterranean pine forests. Private beach, championship golf, and 5 signature restaurants.",
      descFr: "Resort iconique d'Alger parmi les forêts de pins. Plage privée, golf et 5 restaurants.",
      descAr: "المنتجع الأيقوني في الجزائر وسط غابات الصنوبر. شاطئ خاص وغولف و5 مطاعم.",
      stars: 5, city: "algiers", cityEn: "Algiers", cityFr: "Alger", cityAr: "الجزائر العاصمة",
      regionEn: "Algiers Province", regionFr: "Wilaya d'Alger", regionAr: "ولاية الجزائر",
      latitude: 36.7448, longitude: 2.8884, rating: 8.6, reviewCount: 523, isFeatured: true,
      checkInTime: "15:00",
      amenityKeys: ["wifi", "pool", "spa", "restaurant", "gym", "parking", "room_service", "bar", "business", "beach", "golf"],
      rooms: [
        { typeEn: "Deluxe Room", typeFr: "Chambre Deluxe", typeAr: "غرفة ديلوكس", basePrice: 35000, capacity: 2, sizeSqm: 38, bedType: "King", totalUnits: 15 },
        { typeEn: "Executive Suite", typeFr: "Suite Exécutive", typeAr: "جناح تنفيذي", basePrice: 52000, capacity: 3, sizeSqm: 65, bedType: "King", totalUnits: 6 },
        { typeEn: "Presidential Suite", typeFr: "Suite Présidentielle", typeAr: "الجناح الرئاسي", basePrice: 95000, capacity: 4, sizeSqm: 130, bedType: "2 Kings", totalUnits: 1 },
      ],
      photos: [
        "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=1200&q=85",
        "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1200&q=85",
        "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1200&q=85",
        "https://images.unsplash.com/photo-1584132967334-10e028bd69f7?w=1200&q=85",
      ],
    },
    {
      slug: "tipaza-seaside-boutique",
      nameEn: "Tipaza Seaside Boutique", nameFr: "Tipaza Boutique Bord de Mer", nameAr: "تيبازة بوتيك",
      descEn: "Where Roman ruins meet the Mediterranean. Sunsets over ancient Punic archaeological sites.",
      descFr: "Ruines romaines et Méditerranée. Couchers de soleil sur les sites archéologiques.",
      descAr: "حيث تلتقي الآثار الرومانية بالمتوسط. غروب فوق المواقع الأثرية القديمة.",
      stars: 4, city: "tipaza", cityEn: "Tipaza", cityFr: "Tipaza", cityAr: "تيبازة",
      regionEn: "Tipaza Province", regionFr: "Wilaya de Tipaza", regionAr: "ولاية تيبازة",
      latitude: 36.5892, longitude: 2.4484, rating: 8.8, reviewCount: 167,
      amenityKeys: ["wifi", "restaurant", "parking", "pool", "garden", "tours"],
      rooms: [
        { typeEn: "Garden Room", typeFr: "Chambre Jardin", typeAr: "غرفة الحديقة", basePrice: 20000, capacity: 2, sizeSqm: 28, bedType: "Queen", totalUnits: 6 },
        { typeEn: "Sea View Suite", typeFr: "Suite Vue Mer", typeAr: "جناح بإطلالة بحرية", basePrice: 30000, capacity: 2, sizeSqm: 42, bedType: "King", totalUnits: 3 },
      ],
      photos: [
        "https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=1200&q=85",
        "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200&q=85",
        "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1200&q=85",
        "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=85",
      ],
    },
    {
      slug: "meridien-bejaia",
      nameEn: "Le Méridien Béjaïa", nameFr: "Le Méridien Béjaïa", nameAr: "لو ميريديان بجاية",
      descEn: "Between Gouraya mountains and turquoise bay. Kabylie-inspired décor honoring Amazigh heritage.",
      descFr: "Entre Gouraya et baie de Béjaïa. Décor kabyle honorant le patrimoine amazigh.",
      descAr: "بين جبال قورايا وخليج بجاية الفيروزي. ديكور قبائلي يكرم التراث الأمازيغي.",
      stars: 4, city: "bejaia", cityEn: "Bejaia", cityFr: "Béjaïa", cityAr: "بجاية",
      regionEn: "Bejaia Province", regionFr: "Wilaya de Béjaïa", regionAr: "ولاية بجاية",
      latitude: 36.7508, longitude: 5.0567, rating: 8.5, reviewCount: 289,
      amenityKeys: ["wifi", "pool", "restaurant", "gym", "parking", "spa", "beach", "kayaking"],
      rooms: [
        { typeEn: "Mountain View Room", typeFr: "Chambre Vue Montagne", typeAr: "غرفة إطلالة جبلية", basePrice: 24000, capacity: 2, sizeSqm: 32, bedType: "King", totalUnits: 10 },
        { typeEn: "Bay Suite", typeFr: "Suite Baie", typeAr: "جناح الخليج", basePrice: 38000, capacity: 3, sizeSqm: 55, bedType: "King", totalUnits: 4 },
      ],
      photos: [
        "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=1200&q=85",
        "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200&q=85",
        "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=85",
        "https://images.unsplash.com/photo-1590490360182-c33d7f9d02e0?w=1200&q=85",
      ],
    },
  ];

  for (const h of hotels) {
    const { amenityKeys, rooms, photos, ...hotelData } = h;

    const amenities = await prisma.amenity.findMany({ where: { key: { in: amenityKeys } } });

    const hotel = await prisma.hotel.upsert({
      where: { slug: hotelData.slug },
      update: hotelData,
      create: hotelData,
    });

    for (const amenity of amenities) {
      await prisma.hotelAmenity.upsert({
        where: { hotelId_amenityId: { hotelId: hotel.id, amenityId: amenity.id } },
        update: {},
        create: { hotelId: hotel.id, amenityId: amenity.id },
      });
    }

    for (let i = 0; i < rooms.length; i++) {
      const existing = await prisma.room.findFirst({ where: { hotelId: hotel.id, typeEn: rooms[i].typeEn } });
      if (!existing) {
        await prisma.room.create({ data: { ...rooms[i], hotelId: hotel.id, sortOrder: i } });
      }
    }

    for (let i = 0; i < photos.length; i++) {
      const existing = await prisma.hotelPhoto.findFirst({ where: { hotelId: hotel.id, url: photos[i] } });
      if (!existing) {
        await prisma.hotelPhoto.create({ data: { hotelId: hotel.id, url: photos[i], isPrimary: i === 0, sortOrder: i } });
      }
    }

    console.log(`    ✓ ${hotelData.nameEn}`);
  }

  console.log("  → Admin user...");
  const adminHash = await bcrypt.hash("admin123", 12);
  await prisma.user.upsert({
    where: { email: "admin@nzzor.com" },
    update: {},
    create: {
      email: "admin@nzzor.com",
      passwordHash: adminHash,
      role: "SUPER_ADMIN",
      firstName: "Admin",
      lastName: "Nzzor",
      preferredLang: "fr",
      emailVerified: true,
    },
  });
  console.log("    ✓ admin@nzzor.com (password: admin123)");

  console.log("\n✅ Seed complete!\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
