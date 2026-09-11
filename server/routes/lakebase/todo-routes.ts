// For per-user connections (OBO) with Row-Level Security, see:
// https://developers.databricks.com/docs/appkit/v0/plugins/lakebase#on-behalf-of-obo--per-user-connections

import { z } from 'zod';
import { Application } from 'express';
import { runMigrations } from './migrations';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

// Columns returned by every todo endpoint. `due_date` is a DATE; format it as a
// plain YYYY-MM-DD string so the client isn't handed a timezone-shifted Date.
const TODO_COLUMNS = `id, title, completed, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, created_at`;

const Priority = z.enum(['low', 'medium', 'high']);
// A calendar date (YYYY-MM-DD) or null to clear it.
const DueDate = z.iso.date().nullable();

const CreateTodoBody = z.object({
  title: z.string().trim().min(1),
  priority: Priority.optional(),
  due_date: DueDate.optional(),
});

const UpdateTodoBody = z.object({
  title: z.string().trim().min(1).optional(),
  completed: z.boolean().optional(),
  priority: Priority.optional(),
  due_date: DueDate.optional(),
});

export async function setupSampleLakebaseRoutes(appkit: AppKitWithLakebase) {
  try {
    await runMigrations((text, params) => appkit.lakebase.query(text, params));
    console.log('[lakebase] Schema migrations up to date');
  } catch (err) {
    console.warn('[lakebase] Database setup failed:', (err as Error).message);
    console.warn('[lakebase] Routes will be registered but may return errors');
    console.warn('[lakebase] See https://developers.databricks.com/docs/appkit/v0/plugins/lakebase#database-permissions for troubleshooting');
  }

  appkit.server.extend((app) => {
    app.get('/api/lakebase/todos', async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(
          `SELECT ${TODO_COLUMNS} FROM app.todos ORDER BY completed ASC, due_date ASC NULLS LAST, created_at DESC`,
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
        const { title, priority, due_date } = parsed.data;
        const result = await appkit.lakebase.query(
          `INSERT INTO app.todos (title, priority, due_date)
           VALUES ($1, COALESCE($2, 'medium'), $3)
           RETURNING ${TODO_COLUMNS}`,
          [title, priority ?? null, due_date ?? null],
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
          res.status(400).json({ error: 'Invalid update' });
          return;
        }

        const sets: string[] = [];
        const values: unknown[] = [];
        for (const [column, value] of Object.entries(parsed.data)) {
          if (value === undefined) continue;
          sets.push(`${column} = $${values.length + 1}`);
          values.push(value);
        }

        // No fields provided: toggle completion (keeps the checkbox working with
        // an empty PATCH body).
        if (sets.length === 0) {
          sets.push('completed = NOT completed');
        }

        values.push(id);
        const result = await appkit.lakebase.query(
          `UPDATE app.todos SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${TODO_COLUMNS}`,
          values,
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
