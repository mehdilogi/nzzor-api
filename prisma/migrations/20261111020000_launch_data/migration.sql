-- Launch data clean-up.
--
-- 1. Review scores that no guest wrote. Eight hotels carried demo ratings
--    (e.g. 8.6 from 523 reviews) with no review behind them. Any hotel whose
--    score has no real review in the reviews table goes back to "no reviews",
--    which hides the badge. Real reviews, when they come, recompute it.
UPDATE "hotels" h
SET "rating" = 0, "reviewCount" = 0
WHERE h."reviewCount" > 0
  AND NOT EXISTS (SELECT 1 FROM "reviews" r WHERE r."hotelId" = h."id");

-- 2. Four hotels whose web address belonged to a demo hotel. Each gets an
--    address from its own name. Skipped if that address is already taken.
UPDATE "hotels" SET "slug" = 'ferdi-lilly-hotel'
WHERE "slug" = 'sheraton-club-des-pins'
  AND NOT EXISTS (SELECT 1 FROM "hotels" WHERE "slug" = 'ferdi-lilly-hotel');

UPDATE "hotels" SET "slug" = 'complexe-touristique-les-andalouses'
WHERE "slug" = 'azur-beach-oran'
  AND NOT EXISTS (SELECT 1 FROM "hotels" WHERE "slug" = 'complexe-touristique-les-andalouses');

UPDATE "hotels" SET "slug" = 'golden-hills-hotel-setif'
WHERE "slug" = 'royal-maqam-algiers'
  AND NOT EXISTS (SELECT 1 FROM "hotels" WHERE "slug" = 'golden-hills-hotel-setif');

UPDATE "hotels" SET "slug" = 'rusica-park-skikda'
WHERE "slug" = 'tassili-sands-djanet'
  AND NOT EXISTS (SELECT 1 FROM "hotels" WHERE "slug" = 'rusica-park-skikda');
