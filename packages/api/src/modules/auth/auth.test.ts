import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, getAuthHeader, type TestApp } from '../../test-utils.js';

// Uses credentials created by: pnpm db:seed
const SEEDED_ADMIN = {
  email: 'admin@stirlingreuse.com',
  password: 'UnitTestAdminOnly!',
};

describe('POST /api/v1/auth/login', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a JWT and user object for valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: SEEDED_ADMIN,
    });

    expect(res.statusCode).toBe(200);

    const body = res.json<{
      success: boolean;
      data: { token: string; user: { email: string; role: string } };
    }>();

    expect(body.success).toBe(true);
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.email).toBe(SEEDED_ADMIN.email);
    expect(body.data.user.role).toBe('hub_admin');
  });

  it('returns 401 for wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: SEEDED_ADMIN.email, password: 'WrongPass999!' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ success: boolean; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for unknown email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'irrelevant' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when body is missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ success: boolean; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/register', () => {
  let app: TestApp;
  // Unique email per test run to avoid conflicts on repeated runs
  const uniqueEmail = `test-register-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a new user and returns a JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: uniqueEmail,
        password: 'SecurePass1!',
        name: 'Test Registrant',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ success: boolean; data: { token: string; user: { role: string } } }>();
    expect(body.success).toBe(true);
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.role).toBe('buyer');
  });

  it('returns 409 when email is already registered', async () => {
    // Register once more with the same email
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: uniqueEmail,
        password: 'SecurePass1!',
        name: 'Duplicate',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<{ success: boolean; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('returns 400 for a weak password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'another@example.com',
        password: 'short', // < 8 chars
        name: 'Test',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('ignores attempted role and organisation assignment during public signup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `test-public-role-${Date.now()}@example.com`,
        password: 'SecurePass1!',
        name: 'Role Escalation Attempt',
        role: 'platform_admin',
        organisationId: '550e8400-e29b-41d4-a716-446655440000',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{
      success: boolean;
      data: { user: { role: string; organisationId: string | null } };
    }>();

    expect(body.success).toBe(true);
    expect(body.data.user.role).toBe('buyer');
    expect(body.data.user.organisationId).toBeNull();
  });
});

describe('GET /api/v1/auth/me', () => {
  let app: TestApp;
  let authHeader: { authorization: string };

  beforeAll(async () => {
    app = await createTestApp();
    authHeader = await getAuthHeader(app, SEEDED_ADMIN.email, SEEDED_ADMIN.password);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the current user for a valid JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { email: string; role: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.email).toBe(SEEDED_ADMIN.email);
    expect(body.data.role).toBe('hub_admin');
  });

  it('returns 401 with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with a malformed token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer not.a.valid.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });
});
