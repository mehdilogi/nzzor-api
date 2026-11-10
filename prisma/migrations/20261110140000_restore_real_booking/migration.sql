-- Restore the one real booking that the test clean-up caught:
-- NZR-BJ6L-USLR. It goes back to being real and CONFIRMED, and counts in
-- every admin number again.
UPDATE "bookings"
SET "isTest" = false,
    "status" = 'CONFIRMED',
    "cancelledAt" = NULL,
    "confirmedAt" = COALESCE("confirmedAt", NOW())
WHERE "reference" = 'NZR-BJ6L-USLR';
