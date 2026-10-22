import { sessionCookieName } from '@trace/core/constants/session';

/**
 * The browser state of a signed-in user: the session cookie the API sets at
 * sign-in, holding a token from a real sign-in (global-setup, the rehearsal
 * harness). It is httpOnly, as the API sets it; host-only, so on localhost it
 * reaches the API's port as well as the web's. Nothing is in localStorage.
 */
export function buildStorageState(token: string, baseUrl: string) {
  const url = new URL(baseUrl);
  return {
    cookies: [
      {
        name: sessionCookieName(baseUrl),
        value: token,
        domain: url.hostname,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: url.protocol === 'https:',
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };
}

/** Hosts the writing suites may target without an explicit override. */
export function isLocalTarget(baseUrl: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(new URL(baseUrl).hostname);
}
