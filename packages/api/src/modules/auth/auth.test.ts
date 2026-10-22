import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, users } from '@trace/db';
import { createTestApp, getAuthHeader, getTestPersona, type TestApp } from '../../test-utils.js';

// Uses credentials created by: pnpm db:seed
const SEEDED_ADMIN = getTestPersona('hubAdmin');

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

describe('the session cookie', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('login sets an httpOnly, Lax, host-only cookie that lives as long as the token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: SEEDED_ADMIN,
    });

    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'trace_session');
    expect(cookie).toBeDefined();
    expect(cookie!.value).toBe(res.json<{ data: { token: string } }>().data.token);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 3600 });
    // WEB_URL is http in the tests, so no Secure (D1); never a Domain.
    expect(cookie!.secure).toBeFalsy();
    expect(cookie!.domain).toBeUndefined();
  });

  it('register sets the cookie too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `test-cookie-${Date.now()}@example.com`,
        password: 'SecurePass1!',
        name: 'Cookie Registrant',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.cookies.some((c) => c.name === 'trace_session' && c.httpOnly)).toBe(true);
  });

  it('the cookie alone authenticates a request', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: SEEDED_ADMIN,
    });
    const token = login.json<{ data: { token: string } }>().data.token;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { trace_session: token },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { email: string } }>().data.email).toBe(SEEDED_ADMIN.email);
  });

  it('a bad cookie is a 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { trace_session: 'not.a.valid.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('revocation', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // Each test signs up its own account: bumping a seeded persona would end the
  // sessions of the other test files running alongside.
  async function signUp(label: string): Promise<{ id: string; token: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
        password: 'SecurePass1!',
        name: 'Revocation Test',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { token: string; user: { id: string } } }>();
    return { id: body.data.user.id, token: body.data.token };
  }

  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { trace_session: token } });

  it("a token carries the user's token version", async () => {
    const { token } = await signUp('tv');
    expect(app.jwt.decode<{ tv?: number }>(token)?.tv).toBe(0);
  });

  it('raising token_version ends the session at once, cookie or Bearer', async () => {
    const { id, token } = await signUp('bump');
    expect((await me(token)).statusCode).toBe(200);

    await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id));

    expect((await me(token)).statusCode).toBe(401);
    const bearer = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bearer.statusCode).toBe(401);
  });

  it('refuses a validly signed token without a version (one issued before 0015)', async () => {
    const { id } = await signUp('no-tv');
    const legacy = app.jwt.sign({ sub: id, email: 'legacy@example.com', role: 'buyer' });
    expect((await me(legacy)).statusCode).toBe(401);
  });

  it('refuses a token for a user that no longer exists', async () => {
    const ghost = app.jwt.sign({
      sub: '00000000-0000-4000-8000-000000000000',
      email: 'ghost@example.com',
      role: 'platform_admin',
      tv: 0,
    });
    expect((await me(ghost)).statusCode).toBe(401);
  });

  it('reads role and organisation from the database, not the token', async () => {
    const { id, token } = await signUp('role');
    await db.update(users).set({ role: 'hub_staff' }).where(eq(users.id, id));

    const res = await me(token);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { role: string } }>().data.role).toBe('hub_staff');
  });

  it('a database failure is a 500, never a signed-out 401', async () => {
    const { token } = await signUp('db-down');
    const failing = vi
      .spyOn(db.query.users, 'findFirst')
      .mockRejectedValue(new Error('connection terminated'));
    try {
      expect((await me(token)).statusCode).toBe(500);
      const session = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        cookies: { trace_session: token },
      });
      expect(session.statusCode).toBe(500);
    } finally {
      failing.mockRestore();
    }
    expect((await me(token)).statusCode).toBe(200);
  });

  it('logout clears the session cookie, with or without a session', async () => {
    const { token } = await signUp('logout');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { trace_session: token },
      headers: { origin: 'http://localhost:3000' },
    });

    expect(res.statusCode).toBe(200);
    const cleared = res.cookies.find((c) => c.name === 'trace_session');
    expect(cleared).toMatchObject({ value: '', path: '/', httpOnly: true, sameSite: 'Lax' });
    expect(cleared!.expires!.getTime()).toBeLessThanOrEqual(Date.now());

    const anonymous = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(anonymous.statusCode).toBe(200);
  });
});

describe('GET /api/v1/auth/session', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is the signed-in user for a valid session cookie', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: SEEDED_ADMIN,
    });
    const token = login.json<{ data: { token: string } }>().data.token;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: { trace_session: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { email: string; role: string } }>().data).toMatchObject({
      email: SEEDED_ADMIN.email,
      role: 'hub_admin',
    });
  });

  it('is null, not a 401, for anyone without one', async () => {
    for (const cookies of [{}, { trace_session: 'not.a.valid.jwt' }]) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ success: boolean; data: unknown }>()).toEqual({
        success: true,
        data: null,
      });
    }
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
