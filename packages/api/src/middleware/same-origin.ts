import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError } from '@trace/core';
import { env } from '../env.js';
import { sessionCookie } from '../lib/session-cookie.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SESSION_COOKIE = sessionCookie(env.WEB_URL).name;
const WEB_ORIGIN = new URL(env.WEB_URL).origin;

/**
 * Whether a request must be refused as a possible cross-site request forgery
 * (M3a). A browser attaches the session cookie to requests that other sites
 * cause, so a write that carries it must come from the web app's own origin:
 * browsers send `Origin` on every such write, and other sites cannot forge it.
 * A missing Origin is refused too. A write without the cookie is not checked:
 * Bearer callers (scripts, the deploy probes) authenticate explicitly, and an
 * anonymous write has no session to borrow.
 */
export function isCrossSiteCookieWrite(
  method: string,
  hasSessionCookie: boolean,
  origin: string | undefined,
  webOrigin: string,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase()) || !hasSessionCookie) return false;
  return origin !== webOrigin;
}

export async function refuseCrossSiteCookieWrites(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const hasSessionCookie = Boolean(request.cookies[SESSION_COOKIE]);
  if (isCrossSiteCookieWrite(request.method, hasSessionCookie, request.headers.origin, WEB_ORIGIN)) {
    throw new ForbiddenError('Cross-site request refused');
  }
}
