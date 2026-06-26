-- Make participant deletion possible without destroying the audit trail.
--
-- Problem: event_log.actor_id REFERENCES profiles(id) with NO on-delete clause
-- (NO ACTION / RESTRICT). Any user who ever logged an event (logEvent with their
-- actor_id) could not be deleted: deleting their profile raised an FK violation.
-- deleteParticipant() swallowed that error and returned success, so the admin
-- saw "deleted" but the user reappeared in search.
--
-- Fix: change the FK to ON DELETE SET NULL so deleting a profile NULLs out
-- actor_id on historical log rows (the row's `delta` already records the actor's
-- email/name for the deletion event, and actor_id is documented as "NULL for
-- system actions" — so nulling it preserves the immutable audit entry and is
-- GDPR-aligned).
--
-- Complication: ON DELETE SET NULL performs an UPDATE on event_log, and the
-- append-only trigger (prevent_event_log_mutation) blocks ALL updates. So we
-- rewrite that trigger to permit EXACTLY ONE narrow mutation — actor_id going
-- from non-null to NULL with every other column unchanged — and keep blocking
-- everything else (any other UPDATE, and all DELETEs).

-- 1) Rewrite the append-only guard to allow only the FK-driven actor_id -> NULL.
CREATE OR REPLACE FUNCTION prevent_event_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'event_log is append-only; DELETE is not permitted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Permit only: actor_id non-null -> null, all other columns identical.
    IF OLD.actor_id IS NOT NULL
       AND NEW.actor_id IS NULL
       AND (to_jsonb(NEW) - 'actor_id') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'actor_id')
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'event_log is append-only; UPDATE is not permitted except actor_id -> NULL';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) Ensure actor_id is nullable (it already is, but be explicit/idempotent).
ALTER TABLE event_log ALTER COLUMN actor_id DROP NOT NULL;

-- 3) Drop the existing actor_id -> profiles FK (whatever its generated name) and
--    re-add it with ON DELETE SET NULL.
DO $$
DECLARE
  fk_name name;
BEGIN
  SELECT c.conname
  INTO fk_name
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.conrelid = 'public.event_log'::regclass
    AND c.confrelid = 'public.profiles'::regclass
    AND c.conkey = ARRAY[
      (SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid = 'public.event_log'::regclass
          AND a.attname = 'actor_id' AND NOT a.attisdropped)
    ]::smallint[]
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.event_log DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE event_log
  ADD CONSTRAINT event_log_actor_id_fkey
  FOREIGN KEY (actor_id)
  REFERENCES profiles(id)
  ON DELETE SET NULL;
