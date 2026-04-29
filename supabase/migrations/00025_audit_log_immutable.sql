-- Make audit log immutable: replace permissive ALL policy with INSERT-only + SELECT-only
DROP POLICY IF EXISTS "Admin full access audit log" ON admin_audit_log;

-- Admins can insert audit log entries
CREATE POLICY "Admin insert audit log" ON admin_audit_log
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can read audit log entries
CREATE POLICY "Admin read audit log" ON admin_audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- No UPDATE or DELETE policies: audit log entries are immutable
