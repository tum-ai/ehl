#!/usr/bin/env bash
#
# Full-UI hackathon simulation runner.
#
# Boots the complete live stack and runs the all-UI simulation against it:
#   1. Verifies test DB is at the repo schema (applies migrations to the TEST DB)
#   2. Starts Mailpit (SMTP sink + HTTP API) for deterministic email capture
#   3. Builds + starts a PRODUCTION build on :3001 against .env.e2e-live
#   4. Runs the Playwright simulation (real UI, every role, every phase)
#   5. Tears everything down
#
# This is the "run it again" routine. It NEVER touches production (it guards on
# SUPABASE_TEST_MODE=true in .env.test, the same guard scripts/setup-test-db.ts uses).
#
# Usage:
#   ./scripts/sim-run.sh                 # full run (build + migrate + sim)
#   ./scripts/sim-run.sh --no-build      # skip prod rebuild (reuse .next)
#   ./scripts/sim-run.sh --no-migrate    # skip test-DB migration step
#   ./scripts/sim-run.sh --keep-up       # leave server + mailpit running after
#
set -euo pipefail
cd "$(dirname "$0")/.."

DO_BUILD=1; DO_MIGRATE=1; KEEP_UP=0
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --no-migrate) DO_MIGRATE=0 ;;
    --keep-up) KEEP_UP=1 ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

LIVE_ENV=".env.e2e-live"
PORT=3001
MAILPIT_HTTP=8025
MAILPIT_SMTP=1025
SERVER_PID=""; MAILPIT_PID=""

# ── Safety: never run against a non-test instance ─────────────
if ! grep -q '^SUPABASE_TEST_MODE=true' .env.test 2>/dev/null; then
  echo "FATAL: .env.test missing SUPABASE_TEST_MODE=true. Refusing to run (prod-safety guard)."
  exit 1
fi
if [ ! -f "$LIVE_ENV" ]; then
  echo "FATAL: $LIVE_ENV not found. It must derive from .env.test with SMTP -> mailpit."
  echo "Create it: copy .env.test, set SMTP_HOST=localhost SMTP_PORT=1025, add ADMIN_FALLBACK_EMAILS for the test admin."
  exit 1
fi

cleanup() {
  echo ""
  if [ "$KEEP_UP" = "1" ]; then
    echo "--keep-up: leaving server (pid ${SERVER_PID:-?}) and mailpit (pid ${MAILPIT_PID:-?}) running."
    echo "  App:     http://localhost:${PORT}"
    echo "  Mailpit: http://localhost:${MAILPIT_HTTP}"
    return
  fi
  echo "Tearing down..."
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "$MAILPIT_PID" ] && kill "$MAILPIT_PID" 2>/dev/null || true
  # also clean any stragglers on our ports
  lsof -ti:${PORT} 2>/dev/null | xargs kill 2>/dev/null || true
}
trap cleanup EXIT

DOTENV="node_modules/.bin/dotenv"

# ── 1. Test DB schema ─────────────────────────────────────────
if [ "$DO_MIGRATE" = "1" ]; then
  echo "==> Ensuring test DB is at repo schema (migrations)..."
  pnpm tsx scripts/setup-test-db.ts || { echo "Migration step failed"; exit 1; }
fi

# ── 2. Mailpit ────────────────────────────────────────────────
if ! command -v mailpit >/dev/null 2>&1; then
  echo "FATAL: mailpit not installed. Run: brew install mailpit"
  exit 1
fi
echo "==> Starting Mailpit (SMTP :${MAILPIT_SMTP}, HTTP :${MAILPIT_HTTP})..."
lsof -ti:${MAILPIT_HTTP} 2>/dev/null | xargs kill 2>/dev/null || true
mailpit --smtp 0.0.0.0:${MAILPIT_SMTP} --listen 0.0.0.0:${MAILPIT_HTTP} --database /tmp/mailpit-sim.db >/tmp/mailpit-sim.log 2>&1 &
MAILPIT_PID=$!
sleep 2
curl -sf "http://localhost:${MAILPIT_HTTP}/api/v1/messages" >/dev/null || { echo "Mailpit failed to start"; exit 1; }
curl -s -X DELETE "http://localhost:${MAILPIT_HTTP}/api/v1/messages" >/dev/null

# ── 3. Production build + server ───────────────────────────────
if [ "$DO_BUILD" = "1" ]; then
  echo "==> Building production bundle (live env)..."
  $DOTENV -e "$LIVE_ENV" -- pnpm build
fi
echo "==> Starting production server on :${PORT}..."
lsof -ti:${PORT} 2>/dev/null | xargs kill 2>/dev/null || true
$DOTENV -e "$LIVE_ENV" -- pnpm start --port ${PORT} >/tmp/ehl-sim-server.log 2>&1 &
SERVER_PID=$!
# wait for ready
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:${PORT}/"; then break; fi
  sleep 1
  [ "$i" = "60" ] && { echo "Server did not come up"; tail -20 /tmp/ehl-sim-server.log; exit 1; }
done
echo "    Server ready."

# ── 4. Run the simulation ─────────────────────────────────────
echo "==> Running full-UI simulation..."
set +e
$DOTENV -e "$LIVE_ENV" -- npx playwright test --config=playwright.sim.config.ts
SIM_EXIT=$?
set -e

echo ""
if [ "$SIM_EXIT" = "0" ]; then
  echo "==> SIMULATION PASSED"
else
  echo "==> SIMULATION FAILED (exit $SIM_EXIT). Report: playwright-report-sim/  Server log: /tmp/ehl-sim-server.log"
fi
exit $SIM_EXIT
