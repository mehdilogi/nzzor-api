-- AlterTable: add supplement (DZD added to the room's basePrice for this board).
ALTER TABLE "room_board_rates" ADD COLUMN "supplement" INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing rows store an ABSOLUTE price. Convert to a supplement over
-- the room's basePrice so the new engine (basePrice + supplement) reproduces the
-- same numbers. ROOM_ONLY -> 0. Never negative.
UPDATE "room_board_rates" AS rbr
SET "supplement" = GREATEST(0, rbr."price" - r."basePrice")
FROM "rooms" AS r
WHERE rbr."roomId" = r."id"
  AND rbr."board" <> 'ROOM_ONLY';

-- ROOM_ONLY rows are pure base — supplement stays 0 (default).
