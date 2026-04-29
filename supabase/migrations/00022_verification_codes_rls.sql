-- Enable RLS on verification_codes and deny all access via anon/authenticated roles.
-- Only the service role (used by server actions) can read/write this table.
-- This prevents authenticated users from reading verification codes of other users.

ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;

-- No policies = deny all for anon and authenticated roles.
-- Service role bypasses RLS automatically.
