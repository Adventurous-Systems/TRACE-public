import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestApp } from '../../test-utils.js';

describe('GET /health', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds with a valid shape regardless of DB state', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect([200, 503]).toContain(res.statusCode);

    const body = res.json<{
      success: boolean;
      data: { status: string; db: boolean; timestamp: string };
    }>();

    expect(typeof body.success).toBe('boolean');
    expect(['ok', 'degraded']).toContain(body.data.status);
    expect(typeof body.data.db).toBe('boolean');
    expect(typeof body.data.timestamp).toBe('string');
  });

  it('returns success: true when DB is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    if (res.statusCode === 200) {
      const body = res.json<{ success: boolean; data: { db: boolean } }>();
      expect(body.success).toBe(true);
      expect(body.data.db).toBe(true);
    }
  });

  it('provides a dependency-free liveness endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: { status: 'live' },
    });
  });

  it('reports dependency checks on the readiness endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect([200, 503]).toContain(res.statusCode);

    const body = res.json<{
      success: boolean;
      data: {
        status: string;
        checks: Record<string, boolean>;
      };
    }>();
    expect(typeof body.success).toBe('boolean');
    expect(['ready', 'degraded']).toContain(body.data.status);
    expect(body.data.checks).toEqual({
      database: expect.any(Boolean),
      redis: expect.any(Boolean),
      storage: expect.any(Boolean),
      storageHasRoom: expect.any(Boolean),
      thor: expect.any(Boolean),
    });
  });

  // F6 (2026-09-29 rehearsal): a chain outage must not make the API unready.
  // Readiness is database + redis + object storage, whatever the chain's state.
  it('does not gate readiness on the chain', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    const { checks } = res.json<{ data: { checks: Record<string, boolean> } }>().data;
    const coreUp = checks['database'] && checks['redis'] && checks['storage'];
    expect(res.statusCode).toBe(coreUp ? 200 : 503);
  });
});
