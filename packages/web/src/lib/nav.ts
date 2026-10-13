/**
 * The dashboard's links for each role. Every link leads somewhere the role
 * can use: each admin link follows the predicate that mirrors its API
 * (lib/auth.ts). Hub admins were shown Access Requests and Activity (the API
 * refuses them) and hub staff Quality (likewise), journey audit 2026-10-13.
 */
import {
  canViewAdmin,
  canViewFeedback,
  canViewQuality,
  isPlatformAdmin,
  type StoredUser,
} from './auth';

export interface NavLink {
  href: string;
  label: string;
  /** How many things here wait for this person. */
  count?: number;
  /** Something here changed since they last looked. */
  changed?: boolean;
}

export function navLinksFor(user: StoredUser): NavLink[] {
  if (user.role === 'buyer') {
    return [
      { href: '/marketplace', label: 'Marketplace' },
      { href: '/transactions', label: 'Orders' },
      { href: '/access-request', label: 'Seller access' },
      { href: '/scan', label: 'Scan QR' },
    ];
  }
  if (user.role === 'supplier') {
    // Workshop sellers: create + sell materials. No hub-admin or quality tooling.
    return [
      { href: '/passports', label: 'Passports' },
      { href: '/listings', label: 'Listings' },
      { href: '/transactions', label: 'Orders' },
      { href: '/marketplace', label: 'Marketplace' },
      { href: '/scan', label: 'Scan QR' },
    ];
  }
  if (user.role === 'inspector') {
    // An inspector audits other organisations' materials and holds none: no
    // passports, listings or orders of their own to show.
    return [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/quality', label: 'Quality reports' },
      { href: '/marketplace', label: 'Marketplace' },
      { href: '/scan', label: 'Scan QR' },
    ];
  }

  const links: NavLink[] = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/passports', label: 'Passports' },
    { href: '/listings', label: 'Listings' },
    { href: '/transactions', label: 'Orders' },
  ];
  if (canViewQuality(user)) links.push({ href: '/quality', label: 'Quality' });
  links.push({ href: '/scan', label: 'Scan QR' });
  // The platform admin resolves orders with a reported problem.
  if (isPlatformAdmin(user)) links.push({ href: '/admin/flagged-orders', label: 'Flagged orders' });
  if (canViewAdmin(user)) links.push({ href: '/admin/access-requests', label: 'Access Requests' });
  if (canViewFeedback(user)) links.push({ href: '/admin/feedback', label: 'Feedback' });
  if (canViewAdmin(user)) links.push({ href: '/admin/activity', label: 'Activity & VTHO' });
  return links;
}

/**
 * The width from which the links fit in the bar; below it they sit behind
 * the menu button. Up to six fit from md (768px), seven or eight from lg;
 * nine or more only from xl, without the email beside them (owner's test O3:
 * the hub admin's nine links ran into the email at 1366px).
 */
export type NavBreakpoint = 'md' | 'lg' | 'xl';

export function navBreakpoint(count: number): NavBreakpoint {
  return count <= 6 ? 'md' : count <= 8 ? 'lg' : 'xl';
}
