import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Badge,
  Skeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';
import { useState, useEffect, useRef } from 'react';
import { Check, X, Pencil, CalendarClock } from 'lucide-react';

type Priority = 'low' | 'medium' | 'high';

interface Todo {
  id: number;
  title: string;
  completed: boolean;
  priority: Priority;
  due_date: string | null;
  created_at: string;
}

const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const PRIORITY_BADGE: Record<Priority, { variant: 'destructive' | 'secondary' | 'outline'; className?: string }> = {
  high: { variant: 'destructive' },
  medium: { variant: 'secondary' },
  low: { variant: 'outline' },
};

// Today's local calendar date as YYYY-MM-DD, for comparing against due dates.
function todayStr(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

// Format a YYYY-MM-DD due date for display without introducing timezone drift.
function formatDueDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function LakebasePage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [newDueDate, setNewDueDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/lakebase/todos')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch todos: ${res.statusText}`);
        return res.json() as Promise<Todo[]>;
      })
      .then(setTodos)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load todos'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (editingId !== null) editInputRef.current?.focus();
  }, [editingId]);

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/lakebase/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          priority: newPriority,
          due_date: newDueDate || null,
        }),
      });
      if (!res.ok) throw new Error(`Failed to create todo: ${res.statusText}`);
      const created = (await res.json()) as Todo;
      setTodos((prev) => [created, ...prev]);
      setNewTitle('');
      setNewPriority('medium');
      setNewDueDate('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add todo');
    } finally {
      setSubmitting(false);
    }
  };

  // Patch one or more fields on a todo and merge the result into state.
  const patchTodo = async (id: number, body: Partial<Pick<Todo, 'title' | 'completed' | 'priority' | 'due_date'>>) => {
    try {
      const res = await fetch(`/api/lakebase/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Failed to update todo: ${res.statusText}`);
      const updated = (await res.json()) as Todo;
      setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update todo');
    }
  };

  const toggleTodo = (id: number, completed: boolean) => patchTodo(id, { completed: !completed });

  const startEditing = (todo: Todo) => {
    setEditingId(todo.id);
    setEditingTitle(todo.title);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingTitle('');
  };

  const saveEditing = async (id: number) => {
    const title = editingTitle.trim();
    if (!title) {
      cancelEditing();
      return;
    }
    const original = todos.find((t) => t.id === id);
    if (original && original.title !== title) {
      await patchTodo(id, { title });
    }
    cancelEditing();
  };

  const deleteTodo = async (id: number) => {
    try {
      const res = await fetch(`/api/lakebase/todos/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete todo: ${res.statusText}`);
      setTodos((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete todo');
    }
  };

  const completedCount = todos.filter((t) => t.completed).length;
  const today = todayStr();

  return (
    <div className="space-y-6 w-full max-w-2xl mx-auto">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Todo List</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            A simple CRUD example powered by Databricks Lakebase (PostgreSQL).
          </p>

          <form onSubmit={(e) => void addTodo(e)} className="space-y-2 mb-6">
            <div className="flex gap-2">
              <Input
                placeholder="What needs to be done?"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                disabled={submitting}
                className="flex-1"
              />
              <Button type="submit" disabled={submitting || !newTitle.trim()}>
                {submitting ? 'Adding...' : 'Add'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select
                value={newPriority}
                onValueChange={(value) => setNewPriority(value as Priority)}
                disabled={submitting}
              >
                <SelectTrigger size="sm" className="w-32" aria-label="Priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                disabled={submitting}
                aria-label="Due date"
                className="w-40"
              />
            </div>
          </form>

          {error && (
            <div className="text-destructive bg-destructive/10 p-3 rounded-md mb-4">
              {error}
            </div>
          )}

          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={`skeleton-${i}`} className="flex items-center gap-3">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          )}

          {!loading && todos.length === 0 && (
            <p className="text-muted-foreground text-center py-8">
              No todos yet. Add one above to get started.
            </p>
          )}

          {!loading && todos.length > 0 && (
            <div className="space-y-2">
              {todos.map((todo) => {
                const overdue = !todo.completed && todo.due_date !== null && todo.due_date < today;
                return (
                  <div
                    key={todo.id}
                    className="flex flex-col gap-2 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void toggleTodo(todo.id, todo.completed)}
                        className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          todo.completed
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/30 hover:border-primary'
                        }`}
                        aria-label={todo.completed ? 'Mark as incomplete' : 'Mark as complete'}
                      >
                        {todo.completed && <Check className="h-3 w-3" />}
                      </button>

                      {editingId === todo.id ? (
                        <Input
                          ref={editInputRef}
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => void saveEditing(todo.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void saveEditing(todo.id);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEditing();
                            }
                          }}
                          className="flex-1 h-8"
                          aria-label="Edit title"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditing(todo)}
                          className={`flex-1 text-left group inline-flex items-center gap-2 ${
                            todo.completed ? 'line-through text-muted-foreground' : ''
                          }`}
                          aria-label="Edit title"
                        >
                          <span>{todo.title}</span>
                          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 shrink-0" />
                        </button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void deleteTodo(todo.id)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        aria-label="Delete todo"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pl-8">
                      <Badge variant={PRIORITY_BADGE[todo.priority].variant}>
                        {PRIORITY_LABEL[todo.priority]}
                      </Badge>
                      <Select
                        value={todo.priority}
                        onValueChange={(value) => void patchTodo(todo.id, { priority: value as Priority })}
                      >
                        <SelectTrigger size="sm" className="h-7 w-28" aria-label="Change priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {PRIORITY_LABEL[p]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="inline-flex items-center gap-1.5 text-sm">
                        <CalendarClock className={`h-4 w-4 ${overdue ? 'text-destructive' : 'text-muted-foreground'}`} />
                        <Input
                          type="date"
                          value={todo.due_date ?? ''}
                          onChange={(e) => void patchTodo(todo.id, { due_date: e.target.value || null })}
                          aria-label="Due date"
                          className="h-7 w-40"
                        />
                        {todo.due_date && (
                          <span className={overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                            {overdue ? `Overdue · ${formatDueDate(todo.due_date)}` : formatDueDate(todo.due_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <p className="text-xs text-muted-foreground pt-2">
                {completedCount} of {todos.length} completed
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
