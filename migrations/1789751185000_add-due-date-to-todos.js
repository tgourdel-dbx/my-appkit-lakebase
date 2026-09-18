// Adds an optional due date (deadline) to todos.
//
// `due_date` is a plain calendar DATE (no time-of-day) and is nullable — a
// todo without a deadline simply has no due date. Written with ifNotExists /
// ifExists so it is idempotent alongside the app's startup schema setup in
// server/routes/lakebase/todo-routes.ts.

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

const TABLE = { schema: 'app', name: 'todos' };

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn(TABLE, { due_date: { type: 'date', notNull: false } }, { ifNotExists: true });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropColumn(TABLE, 'due_date', { ifExists: true });
};
