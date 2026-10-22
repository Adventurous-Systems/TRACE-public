/**
 * The browser session cookie (M3a, owner decision D1, 2026-10-22), shared by
 * the API that sets it, the web middleware that looks for it and the e2e
 * fixtures that place it.
 *
 * Over https it is `__Host-trace_session`: Secure, host-only and path `/`, so
 * no subdomain can set or shadow it. Over http (the local stack and CI, which
 * run NODE_ENV=production on localhost) it is `trace_session` without Secure,
 * because WebKit drops Secure cookies on http. The web's URL scheme decides,
 * not NODE_ENV.
 */
export const SECURE_SESSION_COOKIE = '__Host-trace_session';
export const PLAIN_SESSION_COOKIE = 'trace_session';

/** Both names, for a reader that doesn't know the scheme (the web middleware). */
export const SESSION_COOKIE_NAMES = [SECURE_SESSION_COOKIE, PLAIN_SESSION_COOKIE] as const;

export function isHttpsUrl(url: string): boolean {
  return new URL(url).protocol === 'https:';
}

export function sessionCookieName(webUrl: string): string {
  return isHttpsUrl(webUrl) ? SECURE_SESSION_COOKIE : PLAIN_SESSION_COOKIE;
}
