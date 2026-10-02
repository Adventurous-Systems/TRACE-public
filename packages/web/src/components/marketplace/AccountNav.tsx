'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { StoredUser } from '@/lib/auth';

/**
 * The account links in the header of the public marketplace pages: where a
 * signed-in person goes next (their orders, their materials, their
 * dashboard), and signing in or out.
 *
 * One component for the marketplace and the listing page. The listing page
 * used to have no account links at all, so a buyer who had just ordered had
 * to go back to the marketplace to find "Orders".
 */
export function AccountNav({
  user,
  onSignOut,
  loginNext,
}: {
  user: StoredUser | null;
  onSignOut: () => void;
  /** Where to return to after signing in from this page. */
  loginNext?: string;
}) {
  return (
    <div className="trace-self-hosted-only flex items-center gap-2 sm:gap-3">
      {user?.role === 'buyer' && (
        <>
          <Link href="/transactions">
            <Button variant="outline" size="sm">
              Orders
            </Button>
          </Link>
          <Link href="/access-request">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
              Request seller access
            </Button>
          </Link>
        </>
      )}
      {user?.role === 'supplier' && (
        <Link href="/passports">
          <Button variant="outline" size="sm">
            My materials
          </Button>
        </Link>
      )}
      {user && user.role !== 'buyer' && user.role !== 'supplier' && (
        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            Dashboard
          </Button>
        </Link>
      )}
      {user ? (
        <Button variant="ghost" size="sm" onClick={onSignOut}>
          Sign out
        </Button>
      ) : (
        <Link href={loginNext ? `/login?next=${encodeURIComponent(loginNext)}` : '/login'}>
          <Button variant="outline" size="sm">
            Sign in
          </Button>
        </Link>
      )}
    </div>
  );
}
