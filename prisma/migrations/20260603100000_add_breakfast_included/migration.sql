-- Add per-room "breakfast included" flag. Default true => existing rooms offer
-- free breakfast (supplement 0) automatically; admin can turn it off per room.
ALTER TABLE "rooms" ADD COLUMN "breakfastIncluded" BOOLEAN NOT NULL DEFAULT true;
