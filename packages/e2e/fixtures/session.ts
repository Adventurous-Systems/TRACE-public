/**
 * The browser state of a logged-in user. The web app authenticates from
 * `localStorage` (trace_token / trace_user) plus a `trace_auth` cookie used by
 * the Next.js middleware, so a session needs both.
 */
export function buildStorageState(token: string, user: unknown, baseUrl: string) {
  const url = new URL(baseUrl);
  return {
    cookies: [
      {
        name: 'trace_auth',
        value: token,
        domain: url.hostname,
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: url.protocol === 'https:',
        sameSite: 'Strict' as const,
      },
    ],
    origins: [
      {
        origin: url.origin,
        localStorage: [
          { name: 'trace_token', value: token },
          { name: 'trace_user', value: JSON.stringify(user) },
        ],
      },
    ],
  };
}

/** Hosts the writing suites may target without an explicit override. */
export function isLocalTarget(baseUrl: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(new URL(baseUrl).hostname);
}
