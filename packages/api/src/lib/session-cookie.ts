import type { CookieSerializeOptions } from '@fastify/cookie';

/**
 * The browser session cookie (M3a, owner decision D1, 2026-10-22). It holds the
 * signed JWT and is httpOnly, so no script on the page can read it.
 *
 * Over https it is `__Host-trace_session`: Secure, host-only and path `/`, so no
 * subdomain can set or shadow it. Over http (the local stack and CI, which run
 * NODE_ENV=production on localhost) it is `trace_session` without Secure,
 * because WebKit drops Secure cookies on http. WEB_URL's scheme decides, not
 * NODE_ENV.
 */
export interface SessionCookie {
  name: string;
  secure: boolean;
}

export function sessionCookie(webUrl: string): SessionCookie {
  const secure = new URL(webUrl).protocol === 'https:';
  return { name: secure ? '__Host-trace_session' : 'trace_session', secure };
}

/** Lax: sent on top-level navigations from other sites, never on their sub-requests. */
export function sessionCookieOptions(
  cookie: SessionCookie,
  maxAgeSeconds?: number,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: cookie.secure,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
  };
}
