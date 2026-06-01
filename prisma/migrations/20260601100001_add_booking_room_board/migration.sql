-- AlterTable
-- board records the chosen meal plan for each booked room. Uses the existing
-- BoardType enum (from the Phase B migration). Nullable so all existing
-- booking_rooms remain valid as NULL.
ALTER TABLE "booking_rooms" ADD COLUMN "board" "BoardType";
