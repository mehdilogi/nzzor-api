-- Bookkeeping: commission per hotel, payout tracking per booking.
ALTER TABLE "hotels" ADD COLUMN IF NOT EXISTS "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 10;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "commissionRate" DOUBLE PRECISION;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "commissionAmount" INTEGER;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "hotelPayoutStatus" TEXT NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "hotelPaidAt" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "hotelPayoutRef" TEXT;
CREATE INDEX IF NOT EXISTS "bookings_hotelPayoutStatus_idx" ON "bookings"("hotelPayoutStatus");
