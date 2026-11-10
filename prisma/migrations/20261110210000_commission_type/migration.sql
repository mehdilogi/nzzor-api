-- Commission per hotel can be a percent of the gross or a fixed amount per
-- room per night.
ALTER TABLE "hotels" ADD COLUMN IF NOT EXISTS "commissionType" TEXT NOT NULL DEFAULT 'PERCENT';
ALTER TABLE "hotels" ADD COLUMN IF NOT EXISTS "commissionFixed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "commissionBasis" TEXT;
