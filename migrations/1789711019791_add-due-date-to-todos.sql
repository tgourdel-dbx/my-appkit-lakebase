-- Up Migration
ALTER TABLE app.todos ADD COLUMN IF NOT EXISTS due_date DATE;

-- Down Migration
ALTER TABLE app.todos DROP COLUMN IF EXISTS due_date;
