-- Atomic advisory-style lock for the deadline-check cron, stored in app_settings.
--
-- The cron now runs every minute (vercel.json). The submissions_open -> pitching
-- branch forks/syncs GitHub repos via lockSubmissionsCore and can exceed 60s, so a
-- minute-cadence schedule can start a second run while the first is still working.
-- This function lets a run atomically claim a lock with a TTL; overlapping runs see
-- the lock held and exit as a no-op. The lock self-heals: once `expires_at` passes,
-- the next run reclaims it even if a prior run crashed without releasing.
--
-- Implemented as a single INSERT ... ON CONFLICT DO UPDATE guarded by a WHERE on the
-- existing expiry. The whole statement is atomic, so two concurrent callers cannot
-- both observe the lock as free: exactly one row write wins, and only that caller
-- sees a returned row.

create or replace function try_acquire_cron_lock(
  lock_key text,
  ttl_seconds integer
)
returns boolean
language plpgsql
as $$
declare
  acquired boolean;
begin
  insert into app_settings (key, value, expires_at, updated_at)
  values (lock_key, 'locked', now() + make_interval(secs => ttl_seconds), now())
  on conflict (key) do update
    set value = 'locked',
        expires_at = now() + make_interval(secs => ttl_seconds),
        updated_at = now()
    -- Only steal the lock if the current holder's lease has expired.
    where app_settings.expires_at is null
       or app_settings.expires_at < now()
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

-- Release is best-effort: clear the expiry so the next run can reclaim immediately
-- instead of waiting out the full TTL after a fast, clean run.
create or replace function release_cron_lock(lock_key text)
returns void
language sql
as $$
  update app_settings set expires_at = now() where key = lock_key;
$$;
