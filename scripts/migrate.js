// Applies pending database migrations against a Lakebase Postgres branch.
//
// This is the `npm run migrate` entry point referenced by the CI workflows
// (`lakebase-preview.yml` runs it against the per-PR branch; `lakebase-
// migrate-prod.yml` runs it against `production` on merge to main). It uses
// `@databricks/lakebase`, which resolves the connection from the standard
// PG* / LAKEBASE_ENDPOINT env vars and refreshes the short-lived database
// token itself, so the same script works locally and in CI.
//
// Migrations live in `migrations/` and are tracked in the `pgmigrations`
// table in the `app` schema (owned by the app's service principal), so this
// never needs write access to the `public` schema.

import { createLakebasePool } from '@databricks/lakebase';
import runner from 'node-pg-migrate';

const MIGRATIONS_SCHEMA = 'app';

async function main() {
  const pool = createLakebasePool();
  // node-pg-migrate runs everything on a single connection (advisory lock +
  // per-migration transactions), so hand it one client rather than the pool.
  const client = await pool.connect();
  try {
    const applied = await runner({
      dbClient: client,
      dir: 'migrations',
      direction: 'up',
      count: Infinity,
      migrationsTable: 'pgmigrations',
      migrationsSchema: MIGRATIONS_SCHEMA,
      createMigrationsSchema: true,
      verbose: true,
    });
    if (applied.length === 0) {
      console.log('[migrate] No pending migrations.');
    } else {
      console.log(`[migrate] Applied ${applied.length} migration(s):`);
      for (const m of applied) console.log(`  - ${m.name}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Migration failed:', err);
  process.exit(1);
});
