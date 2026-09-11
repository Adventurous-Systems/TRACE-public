'use client';

/**
 * Client-side auth utilities.
 * Token is stored in localStorage (simple for now; use httpOnly cookie in prod).
 */

const TOKEN_KEY = 'trace_token';
const USER_KEY = 'trace_user';

export interface StoredUser {
  id: string;
  email: string;
  role: string;
  organisationId: string | null;
}

export interface SessionState {
  token: string | null;
  user: StoredUser | null;
}

export function getPostAuthRedirect(user: StoredUser): string {
  if (user.role === 'buyer') return '/marketplace';
  // Suppliers (workshop sellers) start on their materials — the clearest next step.
  if (user.role === 'supplier') return '/passports';
  return '/dashboard';
}

export function isSupplier(user: StoredUser | null): boolean {
  return user?.role === 'supplier';
}

function isJwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  if (isJwtExpired(token)) {
    clearSession();
    return null;
  }
  return token;
}

export function getUser(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function getSession(): SessionState {
  return {
    token: getToken(),
    user: getUser(),
  };
}

export function saveSession(token: string, user: StoredUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  // Also persist to a cookie so Next.js middleware can enforce server-side auth
  document.cookie = `trace_auth=${token}; path=/; SameSite=Strict`;
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  document.cookie = 'trace_auth=; path=/; max-age=0';
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
// (authorize inspector|hub_admin|platform_admin — note hub_staff is NOT
// included, even though it shares the dashboard nav's "else" branch with
// this set; that nav/API mismatch predates this predicate and is unrelated
// to it).
export function canViewQuality(user: StoredUser | null): boolean {
  return !!user && ['inspector', 'hub_admin', 'platform_admin'].includes(user.role);
}

// Mirrors the platform-admin-only audit routes — .../audit.routes.ts:70,80
// — and matches DashboardLayout's existing admin-nav condition.
export function canViewAdmin(user: StoredUser | null): boolean {
  return !!user && (user.role === 'platform_admin' || user.role === 'hub_admin');
}
