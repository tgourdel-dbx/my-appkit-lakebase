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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const CreateTodoBody = z.object({ title: z.string().min(1) });

// Partial update: any subset of editable fields. An empty body is allowed and
// is treated as a `completed` toggle (backward-compatible with the checkbox).
const UpdateTodoBody = z.object({
  title: z.string().min(1).optional(),
  completed: z.boolean().optional(),
});

export async function setupSampleLakebaseRoutes(appkit: AppKitWithLakebase) {
  try {
    const { rows } = await appkit.lakebase.query(TABLE_EXISTS_SQL);
    if (rows.length > 0) {
      console.log('[lakebase] Table app.todos already exists, skipping setup');
    } else {
      await appkit.lakebase.query(SETUP_SCHEMA_SQL);
      await appkit.lakebase.query(CREATE_TABLE_SQL);
      console.log('[lakebase] Created schema and table app.todos');
    }
  } catch (err) {
    console.warn('[lakebase] Database setup failed:', (err as Error).message);
    console.warn('[lakebase] Routes will be registered but may return errors');
    console.warn('[lakebase] See https://developers.databricks.com/docs/appkit/v0/plugins/lakebase#database-permissions for troubleshooting');
  }

  appkit.server.extend((app) => {
    app.get('/api/lakebase/todos', async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(
          'SELECT id, title, completed, created_at FROM app.todos ORDER BY created_at DESC',
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
          'INSERT INTO app.todos (title) VALUES ($1) RETURNING id, title, completed, created_at',
          [parsed.data.title.trim()],
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
        const parsed = UpdateTodoBody.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid fields' });
          return;
        }

        const { title, completed } = parsed.data;

        let result;
        if (title === undefined && completed === undefined) {
          // No fields provided: toggle completion (checkbox behavior).
          result = await appkit.lakebase.query(
            'UPDATE app.todos SET completed = NOT completed WHERE id = $1 RETURNING id, title, completed, created_at',
            [id],
          );
        } else {
          // Update only the fields that were provided.
          const sets: string[] = [];
          const values: unknown[] = [];
          if (title !== undefined) {
            values.push(title.trim());
            sets.push(`title = $${values.length}`);
          }
          if (completed !== undefined) {
            values.push(completed);
            sets.push(`completed = $${values.length}`);
          }
          values.push(id);
          result = await appkit.lakebase.query(
            `UPDATE app.todos SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id, title, completed, created_at`,
            values,
          );
        }

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
        const result = await appkit.lakebase.query(
          'DELETE FROM app.todos WHERE id = $1 RETURNING id',
          [id],
        );
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
