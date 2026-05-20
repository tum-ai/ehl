# Pre-Event Checklist

Mandatory preparation before every EHL live event. 15k prize money is distributed via the platform, so availability and data integrity are critical.

## Timeline

| When | What | Who | Verify |
|------|------|-----|--------|
| T-14 | Code freeze on registration, auth, scoring | Dev | No PRs to critical paths |
| T-7 | Manual drill: 5-10 people register with various timings (5min+ on form) | Team | All complete successfully |
| T-7 | Verify DB backup is working (Supabase Dashboard) | Dev | PITR enabled, recent backup exists |
| T-3 | k6 load test against staging (200 concurrent registrations) | Dev | p95 < 3s, error rate < 1% |
| T-3 | Check Cloudflare/Turnstile settings (not too aggressive) | Dev | Test from university WiFi |
| T-1 | Health endpoint returns 200 | Dev | `curl https://ehl.gg/api/health` |
| T-1 | Sentry alerts working (test error) | Dev | Discord notification received |
| T-1 | Rate limits appropriate for event size | Dev | Review Upstash + Supabase auth limits |
| T-1 | SMTP quota sufficient | Dev | Check provider dashboard |
| T-0 | Monitoring dashboard open during registration window | Dev | Real-time error + funnel visibility |
| T-0 +30min | Check funnel conversion vs expected participant count | Dev | No unexpected drop-offs |

## Score Finalization (Financial Integrity)

| Step | What | Who |
|------|------|-----|
| 1 | All jury votes submitted | Admin verifies in panel |
| 2 | Scores calculated and reviewed | Primary admin |
| 3 | Second admin confirms scores (4-eyes principle) | Second admin |
| 4 | Scores published | Primary admin |
| 5 | Audit log export (CSV with hash verification) | Dev |
| 6 | Winners notified out-of-band (email outside platform) | Admin |
| 7 | Bank details verified before payout | Finance |

## If Something Breaks at T-0

1. **Registration down**: Check `/api/health`. If Supabase unhealthy, check Supabase status page. Fallback: Google Form for manual registration.
2. **Turnstile blocking legitimate users**: Temporarily set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to test key `1x00000000000000000000AA` (disables challenge). Re-enable after event.
3. **Rate limiting too aggressive**: Increase limits in Upstash dashboard or set `RATE_LIMIT_DISABLED=true` temporarily.
4. **Scoring bug discovered before announcement**: Delay announcement. Never announce wrong results. Fix first, announce second.
5. **Scoring bug discovered after announcement**: Document everything in audit log, communicate transparently with teams, correct publicly.

## Post-Event

- [ ] Export audit log for the event period
- [ ] Verify hash-chain integrity (`/admin/logs` > Verify Chain button)
- [ ] Store audit export in ehl-ops repo (offline backup)
- [ ] Review Sentry errors from event
- [ ] Document any incidents in post-mortem
- [ ] Update this checklist with lessons learned
