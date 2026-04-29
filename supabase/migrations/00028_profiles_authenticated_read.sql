-- Fix: Add policy allowing any authenticated user to read profiles.
-- Migration 00027 was too restrictive: team search, join requests, and
-- event hub member lists all need to read other users' profiles.
-- The critical protection is blocking UNAUTHENTICATED (anon) access,
-- which 00027 already achieved by dropping "Public read profiles".
-- This policy restores functionality for logged-in users while keeping
-- anonymous API consumers locked out.

create policy "Authenticated users read profiles" on profiles
  for select using (auth.uid() is not null);

-- The more granular policies from 00027 (own profile, teammates, admin,
-- jury) are now redundant since this broader policy covers them all,
-- but keeping them is harmless (Postgres OR's all SELECT policies).
