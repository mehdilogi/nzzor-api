-- Re-run of 20261110120000_booking_is_test, which was applied while its file
-- was still empty. Safe to run on a database where it did work: every step
-- checks first.
--
-- Test bookings: keep them, but take them out of every number.
--
-- 1. New column, false for every future booking.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "isTest" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "bookings_isTest_idx" ON "bookings"("isTest");

-- 2. Every booking that exists when this runs is a test booking.
--    A REAL booking to keep? Put its reference inside ARRAY[...] below,
--    e.g. ARRAY['NZR-AB12-CD34','NZR-EF56-GH78']::text[]  (twice: both lines).
UPDATE "bookings"
SET "isTest" = true
WHERE "createdAt" < NOW()
  AND "reference" <> ALL (ARRAY[]::text[]);

-- 3. Test bookings that still hold a room are cancelled, so no test can ever
--    block a real customer again (this is what blocked El Hidhab).
UPDATE "bookings"
SET "status" = 'CANCELLED',
    "cancelledAt" = COALESCE("cancelledAt", NOW())
WHERE "isTest" = true
  AND "status" IN ('PENDING', 'PENDING_PAYMENT', 'ON_REQUEST', 'CONFIRMED')
  AND "reference" <> ALL (ARRAY[]::text[]);
