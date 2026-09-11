import { describe, expect, test, vi } from 'vitest';
import type { Application } from 'express';
import { setupSampleLakebaseRoutes } from './todo-routes';

// Captured route handlers are invoked with plain fake req/res objects, so the
// parameters are intentionally loose (unknown) to avoid casting at call sites.
type Handler = (req: unknown, res: unknown) => unknown;

/**
 * Builds a fake AppKit + Express app that captures the registered route
 * handlers so they can be invoked directly, and records the SQL/params passed
 * to `lakebase.query`. No database or network is needed.
 */
function buildHarness(queryImpl: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) {
  const calls: { text: string; params?: unknown[] }[] = [];
  const routes = new Map<string, Handler>();

  const query = vi.fn((text: string, params?: unknown[]) => {
    calls.push({ text, params });
    return queryImpl(text, params);
  });

  // Minimal Express-app stand-in: records handlers by `${method} ${path}`.
  const appLike: unknown = {
    get: (path: string, h: Handler) => routes.set(`get ${path}`, h),
    post: (path: string, h: Handler) => routes.set(`post ${path}`, h),
    patch: (path: string, h: Handler) => routes.set(`patch ${path}`, h),
    delete: (path: string, h: Handler) => routes.set(`delete ${path}`, h),
  };
  const app = appLike as Application;

  const appkit = {
    lakebase: { query },
    server: { extend: (fn: (app: Application) => void) => fn(app) },
  };

  return { appkit, calls, routes };
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send() {
      return this;
    },
  };
}

describe('PATCH /api/lakebase/todos/:id', () => {
  test('toggles completed when no body is provided (backward compatible)', async () => {
    const row = { id: 1, title: 'a', completed: true, created_at: 'now' };
    const { appkit, calls, routes } = buildHarness(() => Promise.resolve({ rows: [row] }));
    await setupSampleLakebaseRoutes(appkit);

    const handler = routes.get('patch /api/lakebase/todos/:id')!;
    const res = mockRes();
    await handler({ params: { id: '1' }, body: {} }, res);

    const updateCall = calls.find((c) => c.text.includes('UPDATE'))!;
    expect(updateCall.text).toContain('SET completed = NOT completed');
    expect(updateCall.params).toEqual([1]);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(row);
  });

  test('updates only the title when only title is provided', async () => {
    const row = { id: 1, title: 'new', completed: false, created_at: 'now' };
    const { appkit, calls, routes } = buildHarness(() => Promise.resolve({ rows: [row] }));
    await setupSampleLakebaseRoutes(appkit);

    const handler = routes.get('patch /api/lakebase/todos/:id')!;
    const res = mockRes();
    await handler({ params: { id: '1' }, body: { title: '  new  ' } }, res);

    const updateCall = calls.find((c) => c.text.includes('UPDATE'))!;
    expect(updateCall.text).toContain('SET title = $1');
    expect(updateCall.text).toContain('WHERE id = $2');
    expect(updateCall.params).toEqual(['new', 1]); // trimmed
  });

  test('updates both title and completed when both are provided', async () => {
    const row = { id: 1, title: 'new', completed: true, created_at: 'now' };
    const { appkit, calls, routes } = buildHarness(() => Promise.resolve({ rows: [row] }));
    await setupSampleLakebaseRoutes(appkit);

    const handler = routes.get('patch /api/lakebase/todos/:id')!;
    const res = mockRes();
    await handler({ params: { id: '1' }, body: { title: 'new', completed: true } }, res);

    const updateCall = calls.find((c) => c.text.includes('UPDATE'))!;
    expect(updateCall.text).toContain('SET title = $1, completed = $2');
    expect(updateCall.text).toContain('WHERE id = $3');
    expect(updateCall.params).toEqual(['new', true, 1]);
  });

  test('rejects an invalid body with 400 and no UPDATE', async () => {
    const { appkit, calls, routes } = buildHarness(() => Promise.resolve({ rows: [] }));
    await setupSampleLakebaseRoutes(appkit);

    const handler = routes.get('patch /api/lakebase/todos/:id')!;
    const res = mockRes();
    await handler({ params: { id: '1' }, body: { title: '' } }, res);

    expect(res.statusCode).toBe(400);
    expect(calls.some((c) => c.text.includes('UPDATE'))).toBe(false);
  });

  test('returns 404 when the todo does not exist', async () => {
    const { appkit, routes } = buildHarness(() => Promise.resolve({ rows: [] }));
    await setupSampleLakebaseRoutes(appkit);

    const handler = routes.get('patch /api/lakebase/todos/:id')!;
    const res = mockRes();
    await handler({ params: { id: '999' }, body: { title: 'x' } }, res);

    expect(res.statusCode).toBe(404);
  });
});
