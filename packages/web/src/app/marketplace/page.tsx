'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { clearSession, getUser, type StoredUser } from '@/lib/auth';
import { track } from '@/lib/analytics';
import { marketplace, type ListingSummary } from '@/lib/api-client';
import { unitLabel, MATERIAL_CATEGORIES, getCategoryBySlug } from '@trace/core';
import { subcategoryLabel } from '@/lib/categories';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CountUp } from '@/components/ui/count-up';
import { Logo } from '@/components/ui/Logo';
import { Recycle, Leaf } from 'lucide-react';

const CONDITION_COLORS: Record<string, 'default' | 'success' | 'warning' | 'outline'> = {
  A: 'success',
  B: 'success',
  C: 'warning',
  D: 'outline',
};

function formatPrice(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default function MarketplacePage() {
  const [items, setItems] = useState<ListingSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [categoryL1, setCategoryL1] = useState('');
  const [conditionGrade, setConditionGrade] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [stats, setStats] = useState<{ totalCarbonSavedKg: number; activeCount: number } | null>(
    null,
  );
  const searchTrackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setUser(getUser());
    marketplace
      .stats()
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (q) params.set('q', q);
    if (categoryL1) params.set('categoryL1', categoryL1);
    if (conditionGrade) params.set('conditionGrade', conditionGrade);

    marketplace
      .search(params)
      .then((res) => {
        setItems(res.data ?? []);
        setTotal(res.total ?? 0);
        // Only a genuine search/filter/pagination is worth an event (not the bare
        // marketplace landing — that's already a pageview). Debounced so a typed
        // query collapses into one event instead of firing per keystroke.
        if (q || categoryL1 || conditionGrade || page > 1) {
          if (searchTrackTimer.current) clearTimeout(searchTrackTimer.current);
          searchTrackTimer.current = setTimeout(() => {
            track('marketplace-search', {
              filterCategory: categoryL1 || 'all',
              conditionGrade: conditionGrade || 'any',
              resultsCount: res.total ?? 0,
              page,
              hasQuery: q.length > 0,
            });
          }, 600);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page, q, categoryL1, conditionGrade]);

  const totalPages = Math.ceil(total / 20);

  function handleSignOut() {
    clearSession();
    setUser(null);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2" aria-label="TRACE Marketplace home">
            <Logo className="h-7" />
            <span className="font-semibold text-sm text-gray-500 hidden sm:inline">
              Marketplace
            </span>
          </Link>
          <div className="trace-self-hosted-only flex items-center gap-2 sm:gap-3">
            {user?.role === 'buyer' && (
              <>
                {/* A buyer who has just purchased needs to reach their order.
                    Without this the public marketplace shell was a dead end:
                    "Orders" only exists inside DashboardLayout, so after making
                    an offer and navigating back here there was no way to find
                    the purchase. */}
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
            {user && user.role === 'supplier' && (
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
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                Sign out
              </Button>
            ) : (
              <Link href="/login">
                <Button variant="outline" size="sm">
                  Sign in
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Material Marketplace</h1>
          <p className="text-gray-500 mt-1">
            Browse verified reclaimed construction materials from Scottish reuse hubs.
          </p>
        </div>

        {stats && stats.totalCarbonSavedKg > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800 motion-safe:animate-fade-in-up">
            <Recycle className="h-4 w-4 shrink-0" />
            <span>
              <CountUp value={stats.totalCarbonSavedKg} className="font-bold" /> kg CO₂e saved
              across {stats.activeCount} material{stats.activeCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="Search materials..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-64"
          />
          <select
            aria-label="Filter by category"
            value={categoryL1}
            onChange={(e) => {
              setCategoryL1(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All categories</option>
            {/* D-08: option values must be the slugs the API filters on
                (materialPassports.categoryL1), not the display labels — the
                two were previously the same hardcoded list, but the API
                never matched labels against stored slugs, so every category
                selection silently returned zero results. */}
            {MATERIAL_CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by condition grade"
            value={conditionGrade}
            onChange={(e) => {
              setConditionGrade(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Any condition</option>
            {['A', 'B', 'C', 'D'].map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </select>
        </div>

        {/* Listings grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4 space-y-3">
                <Skeleton className="aspect-square w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400">No listings match your search.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500">
              {total} listing{total !== 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {items.map((listing) => (
                <Link
                  key={listing.id}
                  href={`/marketplace/${listing.id}`}
                  className="group block h-full"
                >
                  <Card className="h-full overflow-hidden cursor-pointer transition-all group-hover:shadow-lg motion-safe:group-hover:-translate-y-0.5">
                    <div className="relative aspect-square overflow-hidden bg-gray-100">
                      {listing.passport.photo ? (
                        <img
                          src={listing.passport.photo}
                          alt={listing.passport.productName}
                          className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
                        />
                      ) : listing.passport.qrCodeUrl ? (
                        <img
                          src={listing.passport.qrCodeUrl}
                          alt=""
                          className="h-full w-full object-contain p-6 opacity-30"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-gray-300">
                          <Leaf className="h-10 w-10" />
                        </div>
                      )}
                      {listing.passport.carbonSavingsVsNew && (
                        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-green-600/90 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                          <Leaf className="h-3 w-3" /> {listing.passport.carbonSavingsVsNew} kgCO₂e
                          {listing.passport.unitOfMeasure
                            ? `/${unitLabel(listing.passport.unitOfMeasure)}`
                            : ''}
                        </span>
                      )}
                      {listing.passport.conditionGrade && (
                        <Badge
                          variant={CONDITION_COLORS[listing.passport.conditionGrade] ?? 'outline'}
                          className="absolute right-2 top-2"
                        >
                          Grade {listing.passport.conditionGrade}
                        </Badge>
                      )}
                    </div>
                    <CardContent className="p-4 space-y-1">
                      <p className="font-semibold text-sm leading-tight line-clamp-1">
                        {listing.passport.productName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {getCategoryBySlug(listing.passport.categoryL1)?.label ??
                          listing.passport.categoryL1}
                        {listing.passport.categoryL2
                          ? ` · ${subcategoryLabel(listing.passport.categoryL1, listing.passport.categoryL2)}`
                          : ''}
                      </p>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-lg font-bold text-brand-700">
                          {formatPrice(listing.pricePence)}
                        </span>
                        <span className="text-xs text-gray-400 truncate max-w-[55%]">
                          {listing.organisation.name}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-gray-500">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
