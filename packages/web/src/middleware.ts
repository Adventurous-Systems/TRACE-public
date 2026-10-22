import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
// The session cookie the API sets (M3a): its name depends on the scheme. It is
// httpOnly, which hides it from scripts, not from this server.
import { SESSION_COOKIE_NAMES } from '@trace/core/constants/session';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/passports',
  '/listings',
  '/quality',
  '/transactions',
  '/admin',
  '/access-request',
];

function isJwtExpired(token: string): boolean {
  try {
    const base64 = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!isProtected) return NextResponse.next();

  // Only a quick, unverified look: the API checks the signature and the
  // token version, and the page signs out if it refuses.
  const token = SESSION_COOKIE_NAMES.map((name) => request.cookies.get(name)?.value).find(Boolean);

  if (!token || isJwtExpired(token)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    const search = request.nextUrl.search;
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/passports/:path*',
    '/listings/:path*',
    '/quality/:path*',
    '/transactions/:path*',
    '/admin/:path*',
    '/access-request/:path*',
  ],
};
