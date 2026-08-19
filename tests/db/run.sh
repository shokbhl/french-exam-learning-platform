#!/usr/bin/env bash
#
# Applies the migrations to a throwaway database and runs the RLS assertions.
#
# Connection settings come from the standard libpq environment variables, so
# this works against a local server, a container, or a CI service:
#
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres ./tests/db/run.sh
#
# The target database is dropped and recreated on every run. It must not be a
# database that holds anything you care about; the name is deliberately
# distinct from any application database.
#
# Requires a PostgreSQL server with the pgvector extension available.

set -euo pipefail

TEST_DB="${TEST_DB:-french_exam_rls_test}"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"

# Allow a caller to point at a specific PostgreSQL installation.
if [ -n "${PG_BIN:-}" ]; then
  export PATH="$PG_BIN:$PATH"
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

echo "==> Recreating ${TEST_DB} on ${PGHOST}:${PGPORT}"
psql -q -d postgres -c "drop database if exists ${TEST_DB};"
psql -q -d postgres -c "create database ${TEST_DB};"

echo "==> Applying Supabase compatibility shim"
psql -v ON_ERROR_STOP=1 -q -d "$TEST_DB" -f tests/db/00_supabase_shim.sql

echo "==> Applying migrations"
for migration in supabase/migrations/*.sql; do
  echo "    $(basename "$migration")"
  psql -v ON_ERROR_STOP=1 -q -d "$TEST_DB" -f "$migration"
done

echo "==> Running RLS assertions"
psql -v ON_ERROR_STOP=1 -d "$TEST_DB" -f tests/db/10_rls.test.sql

echo "==> Running function assertions"
psql -v ON_ERROR_STOP=1 -d "$TEST_DB" -f tests/db/20_functions.test.sql

echo "==> Running progress assertions"
psql -v ON_ERROR_STOP=1 -d "$TEST_DB" -f tests/db/30_progress.test.sql

echo "==> Running library assertions"
psql -v ON_ERROR_STOP=1 -d "$TEST_DB" -f tests/db/40_library.test.sql

echo "==> Passed"
