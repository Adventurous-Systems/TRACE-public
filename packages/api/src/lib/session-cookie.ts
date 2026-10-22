import type { CookieSerializeOptions } from '@fastify/cookie';
import { isHttpsUrl, sessionCookieName } from '@trace/core/constants/session';
import { env } from '../env.js';

/**
 * The browser session cookie (M3a). It holds the signed JWT and is httpOnly,
 * so no script on the page can read it. Its name and Secure flag follow
 * WEB_URL's scheme (D1; @trace/core/constants/session).
 */
export interface SessionCookie {
  name: string;
  secure: boolean;
}

export function sessionCookie(webUrl: string): SessionCookie {
  return { name: sessionCookieName(webUrl), secure: isHttpsUrl(webUrl) };
}

/** This deployment's session cookie. */
export const SESSION_COOKIE = sessionCookie(env.WEB_URL);

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
