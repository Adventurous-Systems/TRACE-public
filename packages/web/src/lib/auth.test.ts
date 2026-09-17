import { describe, it, expect } from 'vitest';
import {
  hasOrganisation,
  isPlatformAdmin,
  canRegisterMaterial,
  canCreateListing,
  canViewQuality,
  canViewAdmin,
  isSupplier,
  isHubStaff,
  safeNextPath,
  type StoredUser,
} from './auth';

// J-11 / J-12: these predicates exist so the UI hides or gates an action a
// user's own account cannot perform, rather than showing a CTA that leads to
// a 400/403. Each mirrors a real API route's authorize(...) role list plus
// its NO_ORGANISATION guard (read from the route files — see auth.ts), so
// this suite is effectively asserting the UI and API stay in agreement.
// Every role in ROLES is exercised, both with and without an organisation,
// so a role added later that is accidentally omitted from a predicate shows
// up as a gap here rather than as a dead-end CTA in the product.

const ROLES = [
  'buyer',
  'supplier',
  'hub_staff',
  'hub_admin',
  'platform_admin',
  'inspector',
] as const;

function user(role: (typeof ROLES)[number], organisationId: string | null): StoredUser {
  return { id: 'u1', email: 'u@example.com', role, organisationId };
}

describe('hasOrganisation', () => {
  it('is true only when organisationId is a non-null string', () => {
    expect(hasOrganisation(user('buyer', 'org-1'))).toBe(true);
    expect(hasOrganisation(user('buyer', null))).toBe(false);
    expect(hasOrganisation(null)).toBe(false);
  });
});

describe('isPlatformAdmin', () => {
  it('is true only for platform_admin', () => {
    expect(isPlatformAdmin(user('platform_admin', null))).toBe(true);
    expect(isPlatformAdmin(user('hub_admin', 'org-1'))).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });
});

// Mirrors POST /api/v1/passports's authorize() list plus its NO_ORGANISATION
// guard, and POST /api/v1/marketplace/listings — identical role set and
// guard in this codebase today, so both predicates are exercised together.
describe('canRegisterMaterial / canCreateListing', () => {
  const allowedRoles = ['hub_staff', 'hub_admin', 'platform_admin', 'supplier'] as const;

  it('requires both an allowed role and an organisation', () => {
    for (const role of ROLES) {
      const withOrg = allowedRoles.includes(role as (typeof allowedRoles)[number]);
      expect(canRegisterMaterial(user(role, 'org-1'))).toBe(withOrg);
      expect(canCreateListing(user(role, 'org-1'))).toBe(withOrg);
      // Never true without an organisation, even for an allowed role — this
      // is the exact case J-02/J-11 exist for: platform_admin, inspector and
      // the demo buyer all carry organisationId: null.
      expect(canRegisterMaterial(user(role, null))).toBe(false);
      expect(canCreateListing(user(role, null))).toBe(false);
    }
  });

  it('is false for no user', () => {
    expect(canRegisterMaterial(null)).toBe(false);
    expect(canCreateListing(null)).toBe(false);
  });
});

// Mirrors GET /api/v1/quality/reports/mine's authorize() list. Deliberately
// does NOT include hub_staff, even though hub_staff shares the dashboard
// nav's "Quality" link — that nav/API mismatch predates this predicate.
describe('canViewQuality', () => {
  const allowedRoles = ['inspector', 'hub_admin', 'platform_admin'] as const;

  it('matches the API role list exactly, organisation-independent', () => {
    for (const role of ROLES) {
      const expected = allowedRoles.includes(role as (typeof allowedRoles)[number]);
      expect(canViewQuality(user(role, null))).toBe(expected);
      expect(canViewQuality(user(role, 'org-1'))).toBe(expected);
    }
  });

  it('is false for no user', () => {
    expect(canViewQuality(null)).toBe(false);
  });
});

// Mirrors the platform-admin-only audit routes and DashboardLayout's
// existing admin-nav condition (platform_admin || hub_admin).
describe('canViewAdmin', () => {
  it('is true only for platform_admin and hub_admin', () => {
    expect(canViewAdmin(user('platform_admin', null))).toBe(true);
    expect(canViewAdmin(user('hub_admin', 'org-1'))).toBe(true);
    for (const role of ['buyer', 'supplier', 'hub_staff', 'inspector'] as const) {
      expect(canViewAdmin(user(role, 'org-1'))).toBe(false);
    }
    expect(canViewAdmin(null)).toBe(false);
  });
});

// Pre-existing predicates — not touched by this batch, included here only so
// this file is the single place that documents every role's capabilities.
describe('isSupplier / isHubStaff (pre-existing)', () => {
  it('isSupplier is true only for supplier', () => {
    expect(isSupplier(user('supplier', 'org-1'))).toBe(true);
    expect(isSupplier(user('buyer', null))).toBe(false);
  });

  it('isHubStaff is true for hub_staff, hub_admin and platform_admin', () => {
    for (const role of ['hub_staff', 'hub_admin', 'platform_admin'] as const) {
      expect(isHubStaff(user(role, 'org-1'))).toBe(true);
    }
    expect(isHubStaff(user('inspector', 'org-1'))).toBe(false);
  });
});

// Guards the `?next=` value from Slice 5's login-return fix before it is
// ever passed to router.push/replace. A bare `startsWith('//')` check (the
// version this replaced) still lets `/\evil.example` and `/\t/evil.example`
// through — the WHATWG URL parser folds a leading backslash into a second
// forward slash, so the browser treats it as an off-origin absolute URL.
describe('safeNextPath', () => {
  it('accepts an in-app path, with or without a query string', () => {
    expect(safeNextPath('/transactions')).toBe('/transactions');
    expect(safeNextPath('/transactions?tab=open')).toBe('/transactions?tab=open');
  });

  it('rejects missing, empty, or relative values', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('')).toBeNull();
    expect(safeNextPath('transactions')).toBeNull();
  });

  it('rejects protocol-relative and backslash-disguised off-origin targets', () => {
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath('/\t/evil.example')).toBeNull();
  });

  it('rejects absolute URLs and non-http(s) schemes', () => {
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('javascript:alert(1)')).toBeNull();
  });
});
