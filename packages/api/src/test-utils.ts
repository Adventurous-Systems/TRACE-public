import { buildApp } from './server.js';

export type TestApp = Awaited<ReturnType<typeof buildApp>>;

/**
 * Creates a fully initialised Fastify app for integration tests.
 * Requires the Docker stack to be running (PostgreSQL, Redis).
 *
 * @example
 * let app: TestApp;
 * beforeAll(async () => { app = await createTestApp(); });
 * afterAll(async () => { await app.close(); });
 */
export async function createTestApp(): Promise<TestApp> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/**
 * Helper to log in with test credentials and return an auth header.
 */
export async function getAuthHeader(
  app: TestApp,
  email: string,
  password: string,
): Promise<{ authorization: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });

  if (res.statusCode !== 200) {
    throw new Error(`Login failed (${res.statusCode}): ${res.body}`);
  }

  const body = res.json<{ data: { token: string } }>();
  return { authorization: `Bearer ${body.data.token}` };
}
