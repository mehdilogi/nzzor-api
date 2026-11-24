-- One-time clean-up of town names shown on the site and to Google.
-- Only display names change; the `city` key (and so every address) stays.

-- Algiers was saved as "Wilaya D'alger", which became the page title
-- "Hôtels à Wilaya D'alger" and the address /hotels/ville/wilaya-d-alger.
UPDATE "hotels" SET "cityFr" = 'Alger'
WHERE "cityFr" ILIKE 'wilaya d%alger';

-- "ولاية مستغانم" → "مستغانم" (the town name, like every other hotel).
UPDATE "hotels" SET "cityAr" = btrim(regexp_replace("cityAr", '^\s*ولاية\s+', ''))
WHERE "cityAr" ~ '^\s*ولاية\s+';

-- French names with their accents, as French speakers search and read them.
UPDATE "hotels" SET "cityFr" = 'Sétif'               WHERE lower("cityFr") = 'setif';
UPDATE "hotels" SET "cityFr" = 'Ghardaïa'            WHERE lower("cityFr") = 'ghardaia';
UPDATE "hotels" SET "cityFr" = 'Aïn Témouchent'      WHERE lower("cityFr") = 'ain temouchent';
UPDATE "hotels" SET "cityFr" = 'Saïda'               WHERE lower("cityFr") = 'saida';
UPDATE "hotels" SET "cityFr" = 'Naâma'               WHERE lower("cityFr") = 'naama';
UPDATE "hotels" SET "cityFr" = 'Bouïra'              WHERE lower("cityFr") = 'bouira';
UPDATE "hotels" SET "cityFr" = 'Béni Abbès'          WHERE lower("cityFr") = 'beni abbes';
UPDATE "hotels" SET "cityFr" = 'Sidi Bel Abbès'      WHERE lower("cityFr") = 'sidi bel abbes';
UPDATE "hotels" SET "cityFr" = 'Médéa'               WHERE lower("cityFr") = 'medea';
UPDATE "hotels" SET "cityFr" = 'Aïn Defla'           WHERE lower("cityFr") = 'ain defla';
UPDATE "hotels" SET "cityFr" = 'Boumerdès'           WHERE lower("cityFr") = 'boumerdes';
UPDATE "hotels" SET "cityFr" = 'Bordj Bou Arréridj'  WHERE lower("cityFr") = 'bordj bou arreridj';
UPDATE "hotels" SET "cityFr" = 'Béjaïa'              WHERE lower("cityFr") = 'bejaia';
UPDATE "hotels" SET "cityFr" = 'Tébessa'             WHERE lower("cityFr") = 'tebessa';
UPDATE "hotels" SET "cityFr" = 'Béchar'              WHERE lower("cityFr") = 'bechar';
