-- AlterTable: Add permissions column to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "permissions" JSONB DEFAULT NULL;
