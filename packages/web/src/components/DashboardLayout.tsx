'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { navBreakpoint, navLinksFor, type NavLink } from '@/lib/nav';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/Logo';
import FeedbackWidget from '@/components/FeedbackWidget';
import { useOrdersSummary } from '@/lib/use-orders-summary';

/** A link's label, with what waits behind it. */
function NavLabel({ link }: { link: NavLink }) {
  return (
    <>
      {link.label}
      {link.count ? (
        <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
          {link.count}
          <span className="sr-only"> waiting for you</span>
        </span>
      ) : link.changed ? (
        <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-brand-600 align-middle">
          <span className="sr-only">changed since you last looked</span>
        </span>
      ) : null}
    </>
  );
}

interface Props {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, status, signOut } = useSession();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const orders = useOrdersSummary(user);

  useEffect(() => {
    if (status === 'signed-out') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  // Close the mobile menu on navigation.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await signOut();
    router.push('/login');
  }

  if (!user) return null;

  let navLinks = navLinksFor(user);

  if (orders) {
    navLinks = navLinks.map((link) =>
      link.href === '/transactions'
        ? { ...link, count: orders.needsAction, changed: orders.changed > 0 }
        : link.href === '/admin/flagged-orders'
          ? { ...link, count: orders.flagged }
          : link,
    );
  }

  // Where the links fit in the bar (lib/nav.ts). With nine or more, the
  // email never fits beside them (the bar is at most 1280px wide), so it
  // moves to Sign out's tooltip.
  const breakpoint = navBreakpoint(navLinks.length);
  const manyLinks = breakpoint === 'xl';
  // Whole class names, so Tailwind finds them.
  const menuHidden = { md: 'md:hidden', lg: 'lg:hidden', xl: 'xl:hidden' }[breakpoint];
  const barShown = { md: 'md:flex', lg: 'lg:flex', xl: 'xl:flex' }[breakpoint];

  const homeHref =
    user.role === 'buyer' ? '/marketplace' : user.role === 'supplier' ? '/passports' : '/dashboard';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <button
              type="button"
              aria-label="Toggle navigation"
              aria-expanded={mobileNavOpen}
              data-testid="mobile-nav-toggle"
              onClick={() => setMobileNavOpen((open) => !open)}
              className={`${menuHidden} -ml-1 p-2 rounded-md text-gray-600 hover:bg-gray-100`}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                {mobileNavOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </>
                )}
              </svg>
            </button>
            <Link href={homeHref} className="flex shrink-0 items-center" aria-label="TRACE home">
              <Logo className="h-7" />
            </Link>
            <nav className={`hidden ${barShown} items-center gap-1`}>
              {navLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`whitespace-nowrap px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    pathname === l.href || pathname?.startsWith(l.href + '/')
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <NavLabel link={l} />
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {!manyLinks && (
              <span className="text-sm text-gray-500 hidden xl:block truncate max-w-[14rem]">
                {user.email}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              title={`Signed in as ${user.email}`}
            >
              Sign out
            </Button>
          </div>
        </div>

        {/* Mobile dropdown navigation */}
        {mobileNavOpen && (
          <nav
            data-testid="mobile-nav"
            className={`${menuHidden} border-t bg-white px-2 py-2 space-y-0.5`}
          >
            {navLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  pathname === l.href || pathname?.startsWith(l.href + '/')
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <NavLabel link={l} />
              </Link>
            ))}
          </nav>
        )}
      </header>
      {/* pb-24 keeps the fixed Feedback button from overlapping bottom-aligned actions (e.g. wizard Continue). */}
      <main className="max-w-7xl mx-auto px-4 pt-8 pb-24">{children}</main>
      <FeedbackWidget />
    </div>
  );
}
