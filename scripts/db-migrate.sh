#!/bin/bash
# Run a SQL migration on both Production and Test Supabase databases.
# Usage: ./scripts/db-migrate.sh path/to/migration.sql
#
# Requires: .env.supabase with SUPABASE_ACCESS_TOKEN=...
# Project refs are hardcoded (see .claude/CLAUDE.md for details).

set -euo pipefail

PROD_REF="fdoeygfcjllrzogoymsf"
TEST_REF="ucxqfzegubessqqqbdfe"
ENV_FILE="$(dirname "$0")/../.env.supabase"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env.supabase not found. Create it with SUPABASE_ACCESS_TOKEN=..."
  exit 1
fi

source "$ENV_FILE"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "Error: SUPABASE_ACCESS_TOKEN not set in .env.supabase"
  exit 1
fi

if [ $# -eq 0 ]; then
  echo "Usage: $0 <migration.sql>"
  echo "       $0 --sql 'ALTER TABLE ...'"
  exit 1
fi

# Get SQL from file or --sql flag
if [ "$1" = "--sql" ]; then
  shift
  SQL="$*"
else
  if [ ! -f "$1" ]; then
    echo "Error: File not found: $1"
    exit 1
  fi
  SQL=$(cat "$1")
fi

echo "SQL to execute:"
echo "$SQL" | head -5
echo "..."
echo ""

run_sql() {
  local ref=$1
  local name=$2
  local result
  result=$(curl -s -X POST "https://api.supabase.com/v1/projects/${ref}/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg q "$SQL" '{query: $q}')")

  if echo "$result" | grep -q '"message"'; then
    echo "FAILED on $name: $result"
    return 1
  else
    echo "OK on $name"
    return 0
  fi
}

echo "Running on Production ($PROD_REF)..."
run_sql "$PROD_REF" "Production"

echo "Running on Test ($TEST_REF)..."
run_sql "$TEST_REF" "Test"

echo ""
echo "Done. Both databases updated."
