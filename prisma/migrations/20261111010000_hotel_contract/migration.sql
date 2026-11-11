-- Contract with Nzzor (Hotel.onlineBooking).
--   true  = contract: online booking + SATIM payment
--   false = no contract: listed, booked and paid over WhatsApp
--
-- 1. New hotels start without a contract.
ALTER TABLE "hotels" ALTER COLUMN "onlineBooking" SET DEFAULT false;

-- 2. Starting point: a hotel can only be under contract if it has at least
--    one active room with a price. Everything else goes to WhatsApp.
--    Priced hotels without a contract are then switched off in the admin.
UPDATE "hotels" h
SET "onlineBooking" = EXISTS (
  SELECT 1 FROM "rooms" r
  WHERE r."hotelId" = h."id" AND r."isActive" = true AND r."basePrice" > 0
);
