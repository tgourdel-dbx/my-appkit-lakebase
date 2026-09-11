import { describe, expect, test, vi } from 'vitest';
import type { Application, Request, Response } from 'express';
import { setupSampleLakebaseRoutes } from './todo-routes';

type Handler = (req: Partial<Request>, res: Partial<Response>) => unknown;

/**
 * Builds a fake AppKit + Express app that captures the registered route
 * handlers so they can be invoked directly, and records the SQL/params passed
 * to `lakebase.query`. No database or network is needed.
 */
function buildHarness(queryImpl: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) {
  const calls: { text: string; params?: unknown[] }[] = [];
  const routes = new Map<string, Handler>();

  const query = vi.fn(async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    return queryImpl(text, params);
  });

  const app = {
    get: (path: string, h: Handler) => routes.set(`get ${path}`, h),
    post: (path: string, h: Handler) => routes.set(`post ${path}`, h),
    patch: (path: string, h: Handler) => routes.set(`patch ${path}`, h),
    delete: (path: string, h: Handler) => routes.set(`delete ${path}`, h),
  } as unknown as Application;

  const appkit = {
    lakebase: { query },
    server: { extend: (fn: (app: Application) => void) => fn(app) },
  };

  return { appkit, calls, routes };
}

function mockRes() {
  const res = {
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
  return res;
}

describe('PATCH /api/lakebase/todos/:id', () => {
  test('toggles completed when no body is provided (backward compatible)', async () => {
    const row = { id: 1, title: 'a', completed: true, created_at: 'now' };
    const { appkit, calls, routes } = buildHarness(() => Promise.resolve({ rows: [row] }));
    await setupSampleLakebaseRoutes(appkit);

    const handler = routes.get('patch /api/lakebase/todos/:id')!;
    const res = mockRes();
    await handler({ params: { id: '1' }, body: {} }, res as unknown as Response);

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
    await handler({ params: { id: '1' }, body: { title: '  new  ' } }, res as unknown as Response);

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
    await handler(
      { params: { id: '1' }, body: { title: 'new', completed: true } },
      res as unknown as Response,
    );

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
    await handler({ params: { id: '1' }, body: { title: '' } }, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect(calls.some((c) => c.text.includes('UPDATE'))).toBe(false);
  });

  test('returns 404 when the todo does not exist', async () => {
    const { appkit, routes } = buildHarness(() => Promise.resolve({ rows: [] }));
    await setupSampleLakebaseRoutes(appkit);

    const handler = routes.get('patch /api/lakebase/todos/:id')!;
    const res = mockRes();
    await handler({ params: { id: '999' }, body: { title: 'x' } }, res as unknown as Response);

    expect(res.statusCode).toBe(404);
  });
});
