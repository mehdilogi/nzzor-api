-- AlterEnum
-- ON_REQUEST powers the "Sur Demande" flow: a booking placed when units aren't
-- free, awaiting hotel/agency confirmation. Isolated in its own migration so
-- the ADD VALUE commits before any later migration could reference it
-- (Postgres forbids using a freshly-added enum value in the same transaction).
ALTER TYPE "BookingStatus" ADD VALUE 'ON_REQUEST';
