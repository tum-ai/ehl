-- Fix: Drop all granular profiles SELECT policies from migration 00027.
--
-- The "Admins read all profiles" policy references the profiles table
-- itself (exists (select 1 from profiles p where ...)), causing Postgres
-- error 42P17 (infinite recursion) on every query that touches profiles
-- or any table whose RLS admin policy sub-queries profiles.
--
-- Migration 00028 already provides a broad authenticated-read policy
-- (auth.uid() is not null) that covers all legitimate access. The
-- granular own-profile, teammate, admin, and jury policies from 00027
-- are fully redundant and can be safely removed. Application-level
-- authorization (requireAdmin, requireAdminAction, team membership
-- checks) handles fine-grained access control.
--
-- After this migration, profiles SELECT policies are:
--   1. "Authenticated users read profiles" (00028): any logged-in user
--   2. "Users can update own profile" (00001): self-update only
-- Anonymous (anon key without session) access remains blocked.

drop policy if exists "Users read own profile" on profiles;
drop policy if exists "Users read teammate profiles" on profiles;
drop policy if exists "Admins read all profiles" on profiles;
drop policy if exists "Jury read assigned profiles" on profiles;
