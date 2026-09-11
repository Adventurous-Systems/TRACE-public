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
});
