import { describe, expect, test } from 'vitest';
import { MIGRATIONS, runMigrations } from './migrations';

// A tiny in-memory stand-in for the Lakebase query helper: it records every
// statement and tracks which migration ids have been "applied" so we can assert
// the runner's behavior without a real PostgreSQL connection.
function createFakeQuery(alreadyApplied: string[] = []) {
  const applied = new Set(alreadyApplied);
  const statements: string[] = [];

  const query = (text: string, params?: unknown[]) => {
    statements.push(text);
    if (/INSERT INTO app\.schema_migrations/.test(text)) {
      applied.add(params?.[0] as string);
      return Promise.resolve({ rows: [] });
    }
    if (/SELECT id FROM app\.schema_migrations/.test(text)) {
      return Promise.resolve({ rows: [...applied].map((id) => ({ id })) });
    }
    return Promise.resolve({ rows: [] as Record<string, unknown>[] });
  };

  return { query, statements, applied };
}

describe('runMigrations', () => {
  test('applies every migration and records each id on a fresh branch', async () => {
    const fake = createFakeQuery();

    await runMigrations(fake.query);

    for (const migration of MIGRATIONS) {
      expect(fake.applied.has(migration.id)).toBe(true);
      expect(fake.statements).toContain(migration.sql);
    }
  });

  test('skips migrations that are already recorded', async () => {
    const [first] = MIGRATIONS;
    const fake = createFakeQuery([first.id]);

    await runMigrations(fake.query);

    // The already-applied migration's SQL is never re-run...
    expect(fake.statements).not.toContain(first.sql);
    // ...but the remaining migrations still get applied.
    for (const migration of MIGRATIONS.slice(1)) {
      expect(fake.statements).toContain(migration.sql);
      expect(fake.applied.has(migration.id)).toBe(true);
    }
  });

  test('is a no-op when all migrations are already applied', async () => {
    const fake = createFakeQuery(MIGRATIONS.map((m) => m.id));

    await runMigrations(fake.query);

    for (const migration of MIGRATIONS) {
      expect(fake.statements).not.toContain(migration.sql);
    }
  });

  test('migration ids are unique', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
