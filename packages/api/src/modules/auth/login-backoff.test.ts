import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, users } from '@trace/db';
import { createTestApp, type TestApp } from '../../test-utils.js';
import { waitMinutes } from './login-backoff.js';

describe('waitMinutes (D5)', () => {
  it('lets the first four failures through, then waits 1, 2, 4, 8, and at most 15 minutes', () => {
    expect([1, 2, 3, 4].map(waitMinutes)).toEqual([0, 0, 0, 0]);
    expect([5, 6, 7, 8, 9, 10, 20].map(waitMinutes)).toEqual([1, 2, 4, 8, 15, 15, 15]);
  });
});

describe('login backoff per account', () => {
  let app: TestApp;
  const password = 'SecurePass1!';

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // Its own account each time: the seeded personas sign in across test files.
  async function signUp(label: string): Promise<{ id: string; email: string }> {
    const email = `test-backoff-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password, name: 'Backoff Test' },
    });
    expect(res.statusCode).toBe(201);
    return { id: res.json<{ data: { user: { id: string } } }>().data.user.id, email };
  }

  const login = (email: string, pass: string) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: pass } });

  const row = async (id: string) => (await db.query.users.findFirst({ where: eq(users.id, id) }))!;

  it('waits after 5 failures, even for the right password, and says how long', async () => {
    const { id, email } = await signUp('five');
    for (let i = 0; i < 5; i++) expect((await login(email, 'WrongPass999!')).statusCode).toBe(401);

    const refused = await login(email, password);
    expect(refused.statusCode).toBe(429);
    expect(refused.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many failed sign-ins for this account. Try again in 1 minute.',
    });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(50);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);

    const after = await row(id);
    expect(after.failedLoginCount).toBe(5);
    const waitMs = after.loginBackoffUntil!.getTime() - after.failedLoginAt!.getTime();
    expect(waitMs).toBeGreaterThan(59_000);
    expect(waitMs).toBeLessThanOrEqual(60_000);
  });

  it('lets the right password in once the wait is over, and ends the run', async () => {
    const { id, email } = await signUp('over');
    await db
      .update(users)
      .set({
        failedLoginCount: 5,
        failedLoginAt: new Date(Date.now() - 2 * 60_000),
        loginBackoffUntil: new Date(Date.now() - 60_000),
      })
      .where(eq(users.id, id));

    expect((await login(email, password)).statusCode).toBe(200);
    expect(await row(id)).toMatchObject({
      failedLoginCount: 0,
      failedLoginAt: null,
      loginBackoffUntil: null,
    });
  });

  it('doubles the wait for a failure soon after the last wait ends', async () => {
    const { id, email } = await signUp('double');
    await db
      .update(users)
      .set({
        failedLoginCount: 5,
        failedLoginAt: new Date(Date.now() - 61_000),
        loginBackoffUntil: new Date(Date.now() - 1_000),
      })
      .where(eq(users.id, id));

    expect((await login(email, 'WrongPass999!')).statusCode).toBe(401);
    const after = await row(id);
    expect(after.failedLoginCount).toBe(6);
    const waitMs = after.loginBackoffUntil!.getTime() - after.failedLoginAt!.getTime();
    expect(waitMs).toBeGreaterThan(119_000);
    expect(waitMs).toBeLessThanOrEqual(120_000);
  });

  it('waits in SQL exactly as waitMinutes says, however long the run (no int overflow)', async () => {
    const { id, email } = await signUp('schedule');
    for (const failures of [1, 4, 5, 6, 7, 8, 9, 10, 35, 36, 40]) {
      await db
        .update(users)
        .set({
          failedLoginCount: failures - 1,
          failedLoginAt: new Date(Date.now() - 10_000),
          loginBackoffUntil: null,
        })
        .where(eq(users.id, id));

      expect((await login(email, 'WrongPass999!')).statusCode, `failure ${failures}`).toBe(401);
      const after = await row(id);
      expect(after.failedLoginCount).toBe(failures);
      const waited = after.loginBackoffUntil
        ? after.loginBackoffUntil.getTime() - after.failedLoginAt!.getTime()
        : 0;
      expect(Math.round(waited / 60_000), `wait after failure ${failures}`).toBe(
        waitMinutes(failures),
      );
    }
  });

  it('starts a new run after 15 quiet minutes', async () => {
    const { id, email } = await signUp('quiet');
    await db
      .update(users)
      .set({ failedLoginCount: 4, failedLoginAt: new Date(Date.now() - 16 * 60_000) })
      .where(eq(users.id, id));

    expect((await login(email, 'WrongPass999!')).statusCode).toBe(401);
    expect(await row(id)).toMatchObject({ failedLoginCount: 1, loginBackoffUntil: null });
  });

  it('never waits for an unknown email, as the deploy probe signs in with one', async () => {
    for (let i = 0; i < 7; i++) {
      expect((await login('nobody-backoff@example.com', 'WrongPass999!')).statusCode).toBe(401);
    }
  });
});
