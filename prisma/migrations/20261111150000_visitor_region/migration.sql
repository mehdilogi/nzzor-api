-- Visitor region / city from Cloudflare location headers (approximate, IP-based).
ALTER TABLE "analytics_sessions" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "analytics_sessions" ADD COLUMN IF NOT EXISTS "regionCode" TEXT;
ALTER TABLE "analytics_sessions" ADD COLUMN IF NOT EXISTS "city" TEXT;
CREATE INDEX IF NOT EXISTS "analytics_sessions_country_regionCode_idx" ON "analytics_sessions"("country", "regionCode");
