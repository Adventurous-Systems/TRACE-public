'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getUser, clearSession, type StoredUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/Logo';
import FeedbackWidget from '@/components/FeedbackWidget';

interface Props {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace('/login');
    } else {
      setUser(u);
    }
  }, [router]);

  // Close the mobile menu on navigation.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  function handleLogout() {
    clearSession();
    router.push('/login');
  }

  if (!user) return null;

  let navLinks: Array<{ href: string; label: string }>;
  if (user.role === 'buyer') {
    navLinks = [
      { href: '/marketplace', label: 'Marketplace' },
      { href: '/transactions', label: 'Orders' },
      { href: '/access-request', label: 'Seller access' },
      { href: '/scan', label: 'Scan QR' },
    ];
  } else if (user.role === 'supplier') {
    // Workshop sellers: create + sell materials. No hub-admin or quality tooling.
    navLinks = [
      { href: '/passports', label: 'Passports' },
      { href: '/listings', label: 'Listings' },
      { href: '/transactions', label: 'Orders' },
      { href: '/marketplace', label: 'Marketplace' },
      { href: '/scan', label: 'Scan QR' },
    ];
  } else {
    navLinks = [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/passports', label: 'Passports' },
      { href: '/listings', label: 'Listings' },
      { href: '/transactions', label: 'Orders' },
      { href: '/quality', label: 'Quality' },
      { href: '/scan', label: 'Scan QR' },
    ];
  }

  if (user.role === 'platform_admin' || user.role === 'hub_admin') {
    navLinks.push({ href: '/admin/access-requests', label: 'Access Requests' });
    navLinks.push({ href: '/admin/feedback', label: 'Feedback' });
    navLinks.push({ href: '/admin/activity', label: 'Activity & VTHO' });
  }

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
              className="md:hidden -ml-1 p-2 rounded-md text-gray-600 hover:bg-gray-100"
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
            <Link href={homeHref} className="flex items-center" aria-label="TRACE home">
              <Logo className="h-7" />
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    pathname === l.href || pathname?.startsWith(l.href + '/')
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 hidden sm:block">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </div>

        {/* Mobile dropdown navigation */}
        {mobileNavOpen && (
          <nav
            data-testid="mobile-nav"
            className="md:hidden border-t bg-white px-2 py-2 space-y-0.5"
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
                {l.label}
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
