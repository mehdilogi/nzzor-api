-- =============================================================================
-- Enforce: at most one primary photo per hotel
-- =============================================================================
-- We've had at least one observed instance of two rows with isPrimary=true
-- for the same hotel (Sheraton Club des Pins, 2026-05-28). The admin API
-- endpoint that sets primary is transactional and CAN'T produce this state,
-- which means it came from somewhere else — probably an older code path
-- that was patched in the May 26 admin polish bundle, or a direct DB write.
--
-- Either way, a partial unique index makes the bad state physically
-- impossible going forward: Postgres will reject any INSERT or UPDATE that
-- would result in two primaries for the same hotelId.
--
-- Two parts to this migration:
--   1. Clean up any existing violations (collapse to the lowest sortOrder)
--   2. Add the partial unique index
-- Order matters — the index creation would fail if violations remained.
-- =============================================================================

-- Step 1 — clean up: for any hotel with multiple primaries, keep only the one
-- with the lowest sortOrder as primary. Demote the rest.
--
-- We use a CTE to identify the "winner" per hotel, then update everything else
-- to isPrimary=false. Wrapping in a single statement keeps it atomic.
WITH winners AS (
  SELECT DISTINCT ON ("hotelId") id
  FROM hotel_photos
  WHERE "isPrimary" = true
  ORDER BY "hotelId", "sortOrder" ASC, "createdAt" ASC
)
UPDATE hotel_photos
SET "isPrimary" = false
WHERE "isPrimary" = true
  AND id NOT IN (SELECT id FROM winners);

-- Step 2 — partial unique index: one primary per hotel, enforced at the DB level.
-- This permits multiple isPrimary=false rows per hotel (which we need for the
-- non-primary photos) while making two isPrimary=true rows for the same
-- hotelId structurally impossible.
CREATE UNIQUE INDEX "hotel_photos_one_primary_per_hotel"
  ON hotel_photos ("hotelId")
  WHERE "isPrimary" = true;
