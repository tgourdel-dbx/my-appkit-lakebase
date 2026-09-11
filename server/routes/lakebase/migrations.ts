// Schema migrations for the Lakebase (PostgreSQL) `app` schema.
//
// Each migration is applied exactly once per Lakebase branch and recorded in
// `app.schema_migrations`. Migrations must be append-only: never edit or remove
// an existing entry once it has shipped — add a new one instead. Statements
// should be idempotent so a partially-applied migration can be re-run safely.

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '0001_create_todos',
    sql: `
      CREATE TABLE IF NOT EXISTS app.todos (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        completed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    id: '0002_add_priority_and_due_date',
    sql: `
      ALTER TABLE app.todos ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';
      ALTER TABLE app.todos DROP CONSTRAINT IF EXISTS todos_priority_check;
      ALTER TABLE app.todos ADD CONSTRAINT todos_priority_check CHECK (priority IN ('low', 'medium', 'high'));
      ALTER TABLE app.todos ADD COLUMN IF NOT EXISTS due_date DATE;
    `,
  },
];

type QueryFn = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Ensure the `app` schema exists and apply any migrations not yet recorded in
 * `app.schema_migrations`. Safe to call on every startup.
 */
export async function runMigrations(query: QueryFn): Promise<void> {
  await query('CREATE SCHEMA IF NOT EXISTS app');
  await query(`
    CREATE TABLE IF NOT EXISTS app.schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await query('SELECT id FROM app.schema_migrations');
  const applied = new Set(rows.map((r) => r.id as string));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    await query(migration.sql);
    await query('INSERT INTO app.schema_migrations (id) VALUES ($1)', [migration.id]);
    console.log(`[lakebase] Applied migration ${migration.id}`);
  }
}
