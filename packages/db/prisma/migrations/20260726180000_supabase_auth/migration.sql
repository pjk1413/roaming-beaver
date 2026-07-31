-- Drop Better Auth tables
DROP TABLE IF EXISTS "Session";
DROP TABLE IF EXISTS "Account";
DROP TABLE IF EXISTS "Verification";

-- Align User with Supabase auth.users.id (no default cuid)
ALTER TABLE "User" ALTER COLUMN "name" DROP NOT NULL;
-- Clear legacy Better Auth users (ids won't match Supabase UUIDs)
DELETE FROM "User";
