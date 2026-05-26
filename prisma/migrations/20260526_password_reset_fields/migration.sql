-- AlterTable: add password reset fields to the users table
-- These power the two-step password reset flow:
--   1. User requests reset → backend writes a hashed token + expiry here
--   2. User clicks email link → backend verifies the token, sets new
--      password, nulls these fields back out (single-use)

ALTER TABLE "users"
  ADD COLUMN "passwordResetTokenHash" TEXT,
  ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);
