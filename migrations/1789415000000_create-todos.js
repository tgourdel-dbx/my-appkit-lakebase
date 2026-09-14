/**
 * Initial schema: the `app.todos` table.
 *
 * This is the same schema the app used to create at boot time in
 * server/routes/lakebase/todo-routes.ts. It now lives in a versioned,
 * committed migration so the change is reproducible across every Lakebase
 * branch (preview and production) and reviewable as a diff.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param {MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createSchema('app', { ifNotExists: true });

  pgm.createTable(
    { schema: 'app', name: 'todos' },
    {
      id: 'id', // serial PRIMARY KEY
      title: { type: 'text', notNull: true },
      completed: { type: 'boolean', notNull: true, default: false },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    // Idempotent baseline: production (and every preview branch cloned from it)
    // already has app.todos from the old boot-time creation, so this must be a
    // no-op where the table already exists rather than fail on "relation
    // already exists".
    { ifNotExists: true }
  );
};

/** @param {MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable({ schema: 'app', name: 'todos' }, { ifExists: true });
  pgm.dropSchema('app', { ifExists: true });
};
