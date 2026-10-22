import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, marketplace, passports, SESSION_ENDED_EVENT } from './api-client';

/** A fetch that answers every call with this status and the API's error shape. */
function answer(status: number) {
  const body =
    status < 400 ? { success: true, data: [] } : { success: false, error: { code: 'X' } };
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('api-client and the session cookie (M3a)', () => {
  let ended: number;
  let target: EventTarget;

  beforeEach(() => {
    ended = 0;
    target = new EventTarget();
    target.addEventListener(SESSION_ENDED_EVENT, () => ended++);
    vi.stubGlobal('window', Object.assign(target, { location: new URL('https://demo.example/') }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the cookie with every call, and never an Authorization header', async () => {
    const fetchMock = answer(200);
    vi.stubGlobal('fetch', fetchMock);

    await marketplace.transactions();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://demo.example/api/v1/marketplace/transactions');
    expect(init.credentials).toBe('include');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('labels a body as JSON, and sends no Content-Type without one (sign-out)', async () => {
    const fetchMock = answer(200);
    vi.stubGlobal('fetch', fetchMock);

    await auth.logout();
    await auth.login('a@example.com', 'a-password');

    const [logout, login] = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(logout![1].headers).not.toHaveProperty('Content-Type');
    expect(login![1].headers).toHaveProperty('Content-Type', 'application/json');
  });

  it('announces a session that ended when the API refuses a call with 401', async () => {
    vi.stubGlobal('fetch', answer(401));
    await expect(passports.stats()).rejects.toMatchObject({ status: 401 });
    expect(ended).toBe(1);
  });

  it('does not for a wrong password, which is a 401 on the sign-in route', async () => {
    vi.stubGlobal('fetch', answer(401));
    await expect(auth.login('a@example.com', 'wrong-password')).rejects.toMatchObject({
      status: 401,
    });
    expect(ended).toBe(0);
  });

  it('does not for a 403: the session is fine, the action is not allowed', async () => {
    vi.stubGlobal('fetch', answer(403));
    await expect(passports.stats()).rejects.toMatchObject({ status: 403 });
    expect(ended).toBe(0);
  });
});
