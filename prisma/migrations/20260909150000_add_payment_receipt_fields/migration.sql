-- Receipt fields required by the SATIM cahier de recette.
-- Present in schema.prisma since the certification work but never migrated.
-- IF NOT EXISTS makes this safe whatever the database already has.

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "approvalCode" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "respCode" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "respCodeDesc" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "pan" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cardBrand" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
