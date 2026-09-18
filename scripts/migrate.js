// Applies node-pg-migrate migrations against a Lakebase Postgres branch.
//
// Connection + auth come entirely from the environment, so the same script
// works locally and in CI:
//   PGHOST, PGPORT, PGDATABASE, PGUSER, LAKEBASE_ENDPOINT  (connection)
//   local: a Databricks profile / DATABRICKS_TOKEN
//   CI:    OAuth M2M (DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET / DATABRICKS_HOST)
//
// @databricks/lakebase's createLakebasePool is a drop-in pg.Pool that mints and
// refreshes the short-lived database credential for us — never point this at
// the `production` branch by hand; production is migrated only by the
// `Migrate Lakebase Production` GitHub Action when a PR merges.
//
// Usage: `npm run migrate` (up) or `npm run migrate -- down`.

import { runner } from 'node-pg-migrate';
import { createLakebasePool } from '@databricks/lakebase';

const direction = process.argv[2] === 'down' ? 'down' : 'up';

const pool = createLakebasePool();

try {
  const migrations = await runner({
    dbClient: pool,
    dir: 'migrations',
    direction,
    count: Infinity,
    // Keep the migration ledger in the app-owned `app` schema rather than
    // `public`, so it works under the app SP's CAN_CONNECT_AND_CREATE grant.
    migrationsSchema: 'app',
    migrationsTable: 'pgmigrations',
    createMigrationsSchema: true,
  });

  if (migrations.length === 0) {
    console.log(`[migrate] No pending migrations (${direction}).`);
  } else {
    console.log(`[migrate] Applied ${migrations.length} migration(s) (${direction}):`);
    for (const m of migrations) console.log(`  - ${m.name}`);
  }
} catch (err) {
  console.error('[migrate] Migration failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
