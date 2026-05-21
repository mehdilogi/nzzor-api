// =============================================================================
// One-time backfill: add tags to the 10 launch hotels.
// Run once on Railway after deploying Phase B:
//   railway run node prisma/backfillTags.js
// Or trigger via Railway shell. Safe to re-run — uses upsert-style update.
// =============================================================================

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TAGS_BY_SLUG = {
  "royal-maqam-algiers":     ["city", "city_center", "luxury", "business", "pool", "spa", "sea_view"],
  "tassili-sands-djanet":    ["sahara", "luxury", "romantic", "historic"],
  "constantine-palace":      ["city", "city_center", "historic", "business", "luxury"],
  "casbah-heritage-inn":     ["city", "city_center", "historic", "romantic", "garden_view"],
  "azur-beach-oran":         ["beach", "sea_view", "family", "pool", "city"],
  "timgad-heritage-lodge":   ["historic", "mountain", "family"],
  "ghardaia-oasis":          ["sahara", "historic", "romantic", "garden_view"],
  "sheraton-club-des-pins":  ["beach", "sea_view", "luxury", "business", "pool", "family", "spa"],
  "tipaza-seaside-boutique": ["beach", "sea_view", "romantic", "historic", "pool"],
  "meridien-bejaia":         ["beach", "sea_view", "city", "family", "pool", "garden_view"],
};

async function main() {
  console.log("Backfilling tags on launch hotels…");
  let updated = 0;
  for (const [slug, tags] of Object.entries(TAGS_BY_SLUG)) {
    const hotel = await prisma.hotel.findUnique({ where: { slug } });
    if (!hotel) {
      console.log(`  • SKIP ${slug} (not found)`);
      continue;
    }
    // only set tags if the hotel doesn't already have them — don't overwrite
    // any tags Allouni may have set in the admin in the meantime
    if (Array.isArray(hotel.tags) && hotel.tags.length > 0) {
      console.log(`  • SKIP ${slug} (already has ${hotel.tags.length} tags)`);
      continue;
    }
    await prisma.hotel.update({ where: { slug }, data: { tags } });
    console.log(`  ✓ ${slug}  ←  ${tags.join(", ")}`);
    updated++;
  }
  console.log(`Done — ${updated} hotels tagged.`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
