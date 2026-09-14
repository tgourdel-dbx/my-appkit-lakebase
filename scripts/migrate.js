// ---------------------------------------------------------------------------
// migrate.js
//
// Applies node-pg-migrate migrations against a Lakebase Postgres branch.
//
// Connection is resolved by @databricks/lakebase from standard environment
// variables (PGHOST, PGDATABASE, LAKEBASE_ENDPOINT, PGUSER) plus Databricks
// auth (a profile / DATABRICKS_TOKEN locally, or DATABRICKS_CLIENT_ID +
// DATABRICKS_CLIENT_SECRET for OAuth M2M in CI). The pool refreshes the
// short-lived OAuth database token automatically, so no token is ever written
// to disk. Populate the connection env for a branch with:
//
//   eval "$(bash scripts/lakebase-connect-env.sh <branch-resource-name>)"
//
// Usage:
//   node scripts/migrate.js up      # apply all pending migrations (default)
//   node scripts/migrate.js down    # roll back the most recent migration
//
// This NEVER targets production directly from a developer machine. Production
// is migrated only by the lakebase-migrate-prod GitHub Actions workflow on
// merge to main. See CLAUDE.md.
// ---------------------------------------------------------------------------
import { runner } from 'node-pg-migrate';
import { createLakebasePool } from '@databricks/lakebase';

const arg = process.argv[2] ?? 'up';
if (arg !== 'up' && arg !== 'down') {
  console.error(`Unknown direction "${arg}". Use "up" or "down".`);
  process.exit(1);
}

const direction = arg;
const count = direction === 'down' ? 1 : Infinity;

const pool = createLakebasePool();
const client = await pool.connect();

try {
  const applied = await runner({
    dbClient: client,
    dir: 'migrations',
    direction,
    count,
    migrationsTable: 'pgmigrations',
    verbose: true,
  });

  if (applied.length === 0) {
    console.log('No migrations to run — database is up to date.');
  } else {
    console.log(`Ran ${applied.length} migration(s) ${direction}:`);
    for (const m of applied) {
      console.log(`  - ${m.name}`);
    }
  }
} catch (err) {
  console.error('Migration failed:', err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
