-- Link a group request to the booking created from it.
ALTER TABLE "group_requests" ADD COLUMN IF NOT EXISTS "bookingId" TEXT;
ALTER TABLE "group_requests" ADD COLUMN IF NOT EXISTS "bookingRef" TEXT;
