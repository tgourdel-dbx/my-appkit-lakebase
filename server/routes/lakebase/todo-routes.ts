// For per-user connections (OBO) with Row-Level Security, see:
// https://developers.databricks.com/docs/appkit/v0/plugins/lakebase#on-behalf-of-obo--per-user-connections

import { z } from 'zod';
import { Application } from 'express';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const TABLE_EXISTS_SQL = `
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'app' AND table_name = 'todos'
`;

const SETUP_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS app`;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app.todos (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT false,
    url TEXT,
    due_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

// Idempotent migration so a pre-existing todos table gains the url column.
const ADD_URL_COLUMN_SQL = `ALTER TABLE app.todos ADD COLUMN IF NOT EXISTS url TEXT`;

// Idempotent migration so a pre-existing todos table gains the due_date column.
const ADD_DUE_DATE_COLUMN_SQL = `ALTER TABLE app.todos ADD COLUMN IF NOT EXISTS due_date DATE`;

// Empty strings from the client are treated as "no value" rather than a
// validation error; any non-empty url must be a valid URL, and any non-empty
// due date must be an ISO calendar date (YYYY-MM-DD).
const CreateTodoBody = z.object({
  title: z.string().min(1),
  url: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().url().optional()
  ),
  due_date: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().date().optional()
  ),
});

export async function setupSampleLakebaseRoutes(appkit: AppKitWithLakebase) {
  try {
    const { rows } = await appkit.lakebase.query(TABLE_EXISTS_SQL);
    if (rows.length > 0) {
      console.log('[lakebase] Table app.todos already exists, skipping create');
    } else {
      await appkit.lakebase.query(SETUP_SCHEMA_SQL);
      await appkit.lakebase.query(CREATE_TABLE_SQL);
      console.log('[lakebase] Created schema and table app.todos');
    }
    // Runs for both new and pre-existing tables; safe to repeat.
    await appkit.lakebase.query(ADD_URL_COLUMN_SQL);
    await appkit.lakebase.query(ADD_DUE_DATE_COLUMN_SQL);
  } catch (err) {
    console.warn('[lakebase] Database setup failed:', (err as Error).message);
    console.warn('[lakebase] Routes will be registered but may return errors');
    console.warn(
      '[lakebase] See https://developers.databricks.com/docs/appkit/v0/plugins/lakebase#database-permissions for troubleshooting'
    );
  }

  appkit.server.extend((app) => {
    app.get('/api/lakebase/todos', async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(
          'SELECT id, title, completed, url, due_date::text AS due_date, created_at FROM app.todos ORDER BY due_date ASC NULLS LAST, created_at DESC'
        );
        res.json(result.rows);
      } catch (err) {
        console.error('Failed to list todos:', err);
        res.status(500).json({ error: 'Failed to list todos' });
      }
    });

    app.post('/api/lakebase/todos', async (req, res) => {
      try {
        const parsed = CreateTodoBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'title is required' });
          return;
        }
        const result = await appkit.lakebase.query(
          'INSERT INTO app.todos (title, url, due_date) VALUES ($1, $2, $3) RETURNING id, title, completed, url, due_date::text AS due_date, created_at',
          [parsed.data.title.trim(), parsed.data.url ?? null, parsed.data.due_date ?? null]
        );
        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error('Failed to create todo:', err);
        res.status(500).json({ error: 'Failed to create todo' });
      }
    });

    app.patch('/api/lakebase/todos/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          res.status(400).json({ error: 'Invalid id' });
          return;
        }
        const result = await appkit.lakebase.query(
          'UPDATE app.todos SET completed = NOT completed WHERE id = $1 RETURNING id, title, completed, url, due_date::text AS due_date, created_at',
          [id]
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Todo not found' });
          return;
        }
        res.json(result.rows[0]);
      } catch (err) {
        console.error('Failed to update todo:', err);
        res.status(500).json({ error: 'Failed to update todo' });
      }
    });

    app.delete('/api/lakebase/todos/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          res.status(400).json({ error: 'Invalid id' });
          return;
        }
        const result = await appkit.lakebase.query('DELETE FROM app.todos WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Todo not found' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error('Failed to delete todo:', err);
        res.status(500).json({ error: 'Failed to delete todo' });
      }
    });
  });
}
