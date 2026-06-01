// =============================================================================
// backfillBoardRates.js — one-time seed after the board-rates migration
// -----------------------------------------------------------------------------
// Gives every existing room a ROOM_ONLY RoomBoardRate equal to its current
// basePrice, so no room shows up unpriced once the quote engine (Phase C) reads
// board rates. Idempotent: uses upsert on the (roomId, board) unique key, so
// running it twice is safe — it won't duplicate or overwrite a price you've
// since edited in the admin.
//
// Run once, locally or as a Railway one-off, AFTER the migration is applied:
//   node prisma/backfillBoardRates.js
// =============================================================================

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const rooms = await prisma.room.findMany({
    select: { id: true, basePrice: true, typeEn: true },
  });

  let created = 0;
  let skipped = 0;

  for (const room of rooms) {
    const existing = await prisma.roomBoardRate.findUnique({
      where: { roomId_board: { roomId: room.id, board: "ROOM_ONLY" } },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.roomBoardRate.create({
      data: {
        roomId: room.id,
        board: "ROOM_ONLY",
        price: room.basePrice,
        isActive: true,
      },
    });
    created++;
    console.log(`  + ROOM_ONLY @ ${room.basePrice} for "${room.typeEn}" (${room.id})`);
  }

  console.log(`\nDone. Created ${created} ROOM_ONLY rates, skipped ${skipped} that already existed.`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
