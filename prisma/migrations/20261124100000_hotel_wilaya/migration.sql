-- Each hotel's wilaya code ("01"–"69"). `city` stays the town the hotel is in.
ALTER TABLE "hotels" ADD COLUMN IF NOT EXISTS "wilaya" TEXT;
CREATE INDEX IF NOT EXISTS "hotels_wilaya_idx" ON "hotels"("wilaya");
