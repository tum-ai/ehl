-- Event Log: Append-only audit trail with hash-chain integrity.
-- All critical mutations are logged here. Supports forensic investigation
-- and financial compliance for prize money distribution (15k€).
--
-- Design: Transaction-based logging (like a bank ledger).
-- Deltas are logged, not full state. State recovery comes from DB backups.
-- Hash-chain makes tampering detectable.

CREATE TABLE event_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- What happened
  action TEXT NOT NULL,              -- e.g. 'application.submitted', 'score.published'
  entity_type TEXT NOT NULL,         -- e.g. 'application', 'team', 'chapter', 'score'
  entity_id TEXT NOT NULL,           -- UUID or identifier of affected entity
  -- Who did it
  actor_id UUID REFERENCES profiles(id),  -- NULL for system actions (cron, automated)
  actor_type TEXT NOT NULL DEFAULT 'admin', -- 'admin', 'participant', 'jury', 'system'
  -- What changed (delta, not full state)
  delta JSONB NOT NULL DEFAULT '{}',
  -- Integrity: hash-chain for tamper detection
  prev_hash TEXT,                    -- entry_hash of the previous log entry
  entry_hash TEXT NOT NULL,          -- SHA-256 of (action + entity + delta + prev_hash + created_at)
  -- Context
  metadata JSONB DEFAULT '{}',       -- IP, batch_id, snapshot (for critical locks)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Performance indexes
CREATE INDEX idx_event_log_entity ON event_log(entity_type, entity_id);
CREATE INDEX idx_event_log_action ON event_log(action);
CREATE INDEX idx_event_log_actor ON event_log(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_event_log_created ON event_log(created_at DESC);
CREATE INDEX idx_event_log_actor_type ON event_log(actor_type);

-- Append-only enforcement: prevent UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_event_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'event_log is append-only. UPDATE and DELETE are not allowed.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_log_no_update
  BEFORE UPDATE OR DELETE ON event_log
  FOR EACH ROW EXECUTE FUNCTION prevent_event_log_mutation();

-- RLS: service-role can insert (all logEvent calls use admin client),
-- admins can read via the admin panel log viewer.
ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON event_log
  FOR ALL USING (true) WITH CHECK (true);

-- Backwards-compatible view replacing admin_audit_log
-- (existing admin_audit_log table will be dropped after data migration)
CREATE OR REPLACE VIEW admin_audit_log_v2 AS
SELECT
  id,
  action,
  entity_type,
  entity_id::uuid AS entity_id,
  actor_id AS performed_by,
  delta AS details,
  created_at
FROM event_log
WHERE actor_type IN ('admin', 'system');
