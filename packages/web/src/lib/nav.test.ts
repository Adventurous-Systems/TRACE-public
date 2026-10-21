import { describe, expect, it } from 'vitest';
import { navBreakpoint, navLinksFor } from './nav';

const user = (role: string, organisationId: string | null = 'org-1') => ({
  id: 'u1',
  email: `${role}@example.com`,
  role,
  organisationId,
});
const labels = (role: string, org?: string | null) =>
  navLinksFor(user(role, org)).map((link) => link.label);

describe('navLinksFor', () => {
  it('gives hub staff no Quality link: the quality API refuses them', () => {
    expect(labels('hub_staff')).toEqual([
      'Dashboard',
      'Passports',
      'Listings',
      'Orders',
      'Scan QR',
    ]);
  });

  it('gives hub admins Feedback, but not the platform-only admin pages', () => {
    expect(labels('hub_admin')).toEqual([
      'Dashboard',
      'Passports',
      'Listings',
      'Orders',
      'Quality',
      'Scan QR',
      'Feedback',
    ]);
  });

  it('gives the platform admin everything', () => {
    expect(labels('platform_admin', null)).toEqual([
      'Dashboard',
      'Passports',
      'Listings',
      'Orders',
      'Quality',
      'Scan QR',
      'Flagged orders',
      'Access Requests',
      'Feedback',
      'Activity & VTHO',
    ]);
  });

  it('keeps the buyer, supplier and inspector links', () => {
    expect(labels('buyer', null)).toEqual(['Marketplace', 'Orders', 'Seller access', 'Scan QR']);
    expect(labels('supplier')).toEqual([
      'Passports',
      'Listings',
      'Orders',
      'Marketplace',
      'Scan QR',
    ]);
    expect(labels('inspector', null)).toEqual([
      'Dashboard',
      'Quality reports',
      'Marketplace',
      'Scan QR',
    ]);
  });
});

describe('navBreakpoint', () => {
  it('moves the links into the bar only where they fit', () => {
    expect(navBreakpoint(5)).toBe('md');
    expect(navBreakpoint(7)).toBe('lg');
    expect(navBreakpoint(10)).toBe('xl');
  });
});
