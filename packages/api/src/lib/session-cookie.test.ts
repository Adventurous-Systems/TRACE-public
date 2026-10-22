import { describe, expect, it } from 'vitest';
import { sessionCookie, sessionCookieOptions } from './session-cookie.js';

describe('sessionCookie (D1)', () => {
  it('is __Host- prefixed and Secure when the web runs on https', () => {
    expect(sessionCookie('https://demo.trace.adventurous.systems')).toEqual({
      name: '__Host-trace_session',
      secure: true,
    });
  });

  it('is plain and not Secure on http, whatever NODE_ENV says', () => {
    expect(sessionCookie('http://localhost:3000')).toEqual({
      name: 'trace_session',
      secure: false,
    });
  });

  it('is httpOnly, Lax and host-only on path /', () => {
    const options = sessionCookieOptions(sessionCookie('https://demo.example'), 600);
    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    expect(options).not.toHaveProperty('domain');
  });
});
