import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, getTestPersona, type TestApp } from '../test-utils.js';
import { isCrossSiteCookieWrite } from './same-origin.js';

const WEB = 'https://demo.example';

describe('isCrossSiteCookieWrite', () => {
  it('refuses a cookie write from another origin, or with none', () => {
    expect(isCrossSiteCookieWrite('POST', true, 'https://evil.example', WEB)).toBe(true);
    expect(isCrossSiteCookieWrite('DELETE', true, undefined, WEB)).toBe(true);
    expect(isCrossSiteCookieWrite('PATCH', true, 'null', WEB)).toBe(true);
  });

  it('allows a cookie write from the web app itself', () => {
    expect(isCrossSiteCookieWrite('POST', true, WEB, WEB)).toBe(false);
  });

  it('never checks reads, or writes without the cookie', () => {
    expect(isCrossSiteCookieWrite('GET', true, 'https://evil.example', WEB)).toBe(false);
    expect(isCrossSiteCookieWrite('options', true, undefined, WEB)).toBe(false);
    expect(isCrossSiteCookieWrite('POST', false, undefined, WEB)).toBe(false);
  });
});

describe('cross-site writes against the API', () => {
  let app: TestApp;
  let token: string;
  const feedback = { rating: 4, category: 'general', message: 'same-origin test' };

  beforeAll(async () => {
    app = await createTestApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: getTestPersona('buyer'),
    });
    token = login.json<{ data: { token: string } }>().data.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a cookie write from a foreign origin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      cookies: { trace_session: token },
      headers: { origin: 'https://evil.example' },
      payload: feedback,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
  });

  it('refuses a cookie write with no Origin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      cookies: { trace_session: token },
      payload: feedback,
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepts a cookie write from the web app (WEB_URL)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      cookies: { trace_session: token },
      headers: { origin: 'http://localhost:3000' },
      payload: feedback,
    });
    expect(res.statusCode).toBe(201);
  });

  it('accepts a Bearer write with no Origin, as the probes send', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/feedback',
      headers: { authorization: `Bearer ${token}` },
      payload: feedback,
    });
    expect(res.statusCode).toBe(201);
  });

  it('lets a cookie read through from anywhere', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { trace_session: token },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(200);
  });
});
