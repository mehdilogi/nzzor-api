-- Group requests (10+ travellers), handled by the agency as quotes.
CREATE TABLE IF NOT EXISTS "group_requests" (
  "id"           TEXT NOT NULL,
  "reference"    TEXT NOT NULL,
  "groupType"    TEXT NOT NULL,
  "destination"  TEXT,
  "checkIn"      DATE,
  "checkOut"     DATE,
  "people"       INTEGER NOT NULL,
  "rooms"        INTEGER,
  "budget"       TEXT,
  "organization" TEXT,
  "contactName"  TEXT NOT NULL,
  "phone"        TEXT NOT NULL,
  "email"        TEXT,
  "message"      TEXT,
  "lang"         TEXT NOT NULL DEFAULT 'fr',
  "status"       TEXT NOT NULL DEFAULT 'NEW',
  "quoteAmount"  INTEGER,
  "adminNotes"   TEXT,
  "country"      TEXT,
  "region"       TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "group_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "group_requests_reference_key" ON "group_requests"("reference");
CREATE INDEX IF NOT EXISTS "group_requests_status_createdAt_idx" ON "group_requests"("status", "createdAt");
