#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# lakebase-connect-env.sh
#
# Resolve the Postgres connection environment for a Lakebase branch and print
# it as `export` lines, so callers can load it with:
#
#   eval "$(bash scripts/lakebase-connect-env.sh projects/<proj>/branches/<id>)"
#
# It prints PGHOST, PGPORT, PGDATABASE, PGSSLMODE and LAKEBASE_ENDPOINT. The
# short-lived OAuth database token is NOT resolved here — @databricks/lakebase
# mints and refreshes it at connect time from Databricks auth (a profile /
# DATABRICKS_TOKEN locally, or DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET
# in CI). Nothing secret is printed or written to disk.
#
# The Databricks CLI honours DATABRICKS_CONFIG_PROFILE / DATABRICKS_* env, so
# no --profile flag is passed here; set the profile in your environment.
#
# Usage: scripts/lakebase-connect-env.sh <branch-resource-name>
# ---------------------------------------------------------------------------
set -euo pipefail

BRANCH="${1:-}"
if [[ -z "$BRANCH" ]]; then
  echo "usage: lakebase-connect-env.sh <projects/<proj>/branches/<id>>" >&2
  exit 1
fi

# Pick the read-write endpoint of the branch and read its host + resource name.
ENDPOINTS_JSON="$(databricks postgres list-endpoints "$BRANCH" -o json)"
read -r LAKEBASE_ENDPOINT PGHOST <<EOF
$(printf '%s' "$ENDPOINTS_JSON" | python3 -c '
import json, sys
eps = json.load(sys.stdin)
rw = [e for e in eps if e.get("status", {}).get("endpoint_type") == "ENDPOINT_TYPE_READ_WRITE"]
ep = (rw or eps)[0]
print(ep["name"], ep["status"]["hosts"]["host"])
')
EOF

# Read the Postgres database name from the branch (usually databricks_postgres).
DATABASES_JSON="$(databricks postgres list-databases "$BRANCH" -o json)"
PGDATABASE="$(printf '%s' "$DATABASES_JSON" | python3 -c '
import json, sys
dbs = json.load(sys.stdin)
print(dbs[0]["status"]["postgres_database"])
')"

if [[ -z "${PGHOST:-}" || -z "${LAKEBASE_ENDPOINT:-}" || -z "${PGDATABASE:-}" ]]; then
  echo "Failed to resolve connection details for branch: $BRANCH" >&2
  exit 1
fi

printf 'export PGHOST=%q\n' "$PGHOST"
printf 'export PGPORT=%q\n' "${PGPORT:-5432}"
printf 'export PGDATABASE=%q\n' "$PGDATABASE"
printf 'export PGSSLMODE=%q\n' "${PGSSLMODE:-require}"
printf 'export LAKEBASE_ENDPOINT=%q\n' "$LAKEBASE_ENDPOINT"
