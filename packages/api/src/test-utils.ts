import { buildApp } from './server.js';
import { DEMO_PERSONAS, type DemoPersonaKey } from '@trace/core/constants/demo-personas';

export type TestApp = Awaited<ReturnType<typeof buildApp>>;

export function getTestPersona(key: DemoPersonaKey): { email: string; password: string } {
  const persona = DEMO_PERSONAS[key];
  const password = process.env[persona.passwordEnv];
  if (!password) {
    throw new Error(`${persona.passwordEnv} is required for API integration tests`);
  }
  return { email: persona.email, password };
}

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
