'use client';

/**
 * Client-side auth helpers. The session itself is an httpOnly cookie the API
 * sets (M3a); no script can read it. Who is signed in comes from the session
 * provider (lib/session.tsx), which asks the API.
 */

/** Where the token lived before M3a. Cleared once, on the first load after the upgrade (D4). */
const LEGACY_TOKEN_KEY = 'trace_token';
const LEGACY_USER_KEY = 'trace_user';
const LEGACY_COOKIE = 'trace_auth';

export interface StoredUser {
  id: string;
  email: string;
  role: string;
  organisationId: string | null;
}

export function getPostAuthRedirect(user: StoredUser): string {
  if (user.role === 'buyer') return '/marketplace';
  // Suppliers (workshop sellers) start on their materials — the clearest next step.
  if (user.role === 'supplier') return '/passports';
  return '/dashboard';
}

// Validates a `?next=` value before it is ever passed to router.push/replace.
// A bare `startsWith('/') && !startsWith('//')` check (the old inline version
// on the login/register pages) still lets through paths like `/\evil.example`
// or `/\t/evil.example` — the WHATWG URL parser treats a leading backslash
// like a second forward slash, so the browser navigates cross-origin. Parsing
// against a fixed placeholder origin and checking the origin survived intact
// catches that, plus `javascript:`/absolute URLs, in one place.
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/')) return null;
  try {
    const url = new URL(value, 'http://trace.invalid');
    if (url.origin !== 'http://trace.invalid') return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function isSupplier(user: StoredUser | null): boolean {
  return user?.role === 'supplier';
}

/**
 * Removes the pre-M3a session: the token and user in localStorage, and the
 * script-written `trace_auth` cookie. They no longer sign anyone in; this
 * just stops a readable token lingering in the browser.
 */
export function clearLegacySession(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
  } catch {
    // Storage blocked (private mode, settings): nothing was stored either.
  }
  if (document.cookie.includes(`${LEGACY_COOKIE}=`)) {
    document.cookie = `${LEGACY_COOKIE}=; path=/; max-age=0`;
  }
}

export function isHubStaff(user: StoredUser | null): boolean {
  return (
    user?.role === 'hub_staff' || user?.role === 'hub_admin' || user?.role === 'platform_admin'
  );
}

// ─── Capability predicates (J-11 / J-12) ───────────────────────────────────
// These exist so the UI can hide or gate an action a user's own account
// cannot perform, rather than showing it and letting the API 400/403. Each
// one mirrors the actual `authorize(...)` role list and NO_ORGANISATION
// guard in the corresponding API route — read from the route file, not
// transcribed from an error string — so the UI cannot promise more than the
// API will grant. If a route's requirements change, these must change with
// it; they are deliberately not derived automatically because that coupling
// would be invisible at review time.

export function hasOrganisation(user: StoredUser | null): boolean {
  return user?.organisationId != null;
}

export function isPlatformAdmin(user: StoredUser | null): boolean {
  return user?.role === 'platform_admin';
}

// Mirrors POST /api/v1/passports — packages/api/.../passport.routes.ts:22
// (authorize hub_staff|hub_admin|platform_admin|supplier) plus its
// NO_ORGANISATION guard at line 26-30.
export function canRegisterMaterial(user: StoredUser | null): boolean {
  if (!user) return false;
  const roleOk = ['hub_staff', 'hub_admin', 'platform_admin', 'supplier'].includes(user.role);
  return roleOk && hasOrganisation(user);
}

// Mirrors POST /api/v1/marketplace/listings — .../marketplace.routes.ts:48,
// same role list and the same NO_ORGANISATION guard.
export function canCreateListing(user: StoredUser | null): boolean {
  if (!user) return false;
  const roleOk = ['hub_staff', 'hub_admin', 'platform_admin', 'supplier'].includes(user.role);
  return roleOk && hasOrganisation(user);
}

// Mirrors GET /api/v1/quality/reports/mine — .../quality.routes.ts:53
// (authorize inspector|hub_admin|platform_admin; hub_staff is not included,
// so the nav gives hub staff no Quality link).
export function canViewQuality(user: StoredUser | null): boolean {
  return !!user && ['inspector', 'hub_admin', 'platform_admin'].includes(user.role);
}

// Mirrors the platform-admin-only audit and access-request routes —
// .../audit.routes.ts and .../access-request.routes.ts. It let hub admins in
// too, whose Activity page then showed nothing but two 403s (audit,
// 2026-10-13).
export function canViewAdmin(user: StoredUser | null): boolean {
  return isPlatformAdmin(user);
}

// Mirrors GET /api/v1/feedback — .../feedback.routes.ts (authorize
// platform_admin|hub_admin).
export function canViewFeedback(user: StoredUser | null): boolean {
  return !!user && (user.role === 'platform_admin' || user.role === 'hub_admin');
}
