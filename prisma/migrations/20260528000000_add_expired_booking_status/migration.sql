-- =============================================================================
-- Add EXPIRED status to BookingStatus enum
-- =============================================================================
--
-- Used by the availability expiry cron job. When a PENDING booking sits
-- unpaid for >30 min, the cron marks it EXPIRED, which frees its inventory
-- immediately (the availability service only counts non-expired bookings).
--
-- EXPIRED is semantically distinct from CANCELLED:
--   CANCELLED — customer or admin chose to cancel a real reservation
--   EXPIRED   — customer abandoned the checkout flow, never paid
--
-- Keeping them separate lets us report on abandonment rate (a key UX
-- health metric) without polluting cancellation numbers.
-- =============================================================================

ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
