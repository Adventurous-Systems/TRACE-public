'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { LoadFailure } from '@/components/ui/load-state';
import { passports, ApiError, type PassportSummary } from '@/lib/api-client';
import {
  getToken,
  getUser,
  canRegisterMaterial,
  canCreateListing,
  type StoredUser,
} from '@/lib/auth';
import { getErrorMessage } from '@/lib/api-errors';
import { categoryLabel } from '@/lib/categories';

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'outline'> = {
  draft: 'outline',
  active: 'success',
  listed: 'default',
  reserved: 'warning',
  sold: 'outline',
  installed: 'success',
  decommissioned: 'outline',
};

// J-02: same three-outcome shape as the dashboard — see its comment for why
// "no organisation" needs to be a distinct phase from "the fetch failed".
type Load =
  | { phase: 'loading' }
  | { phase: 'ready'; items: PassportSummary[]; total: number }
  | { phase: 'no-org' }
  | { phase: 'error'; message: string };

export default function PassportsPage() {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  // Effect-based to avoid the hydration mismatch a render-time getUser()
  // call produces (it returns null on the server).
  const [user, setUser] = useState<StoredUser | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  function fetchPassports() {
    const token = getToken();
    if (!token) {
      // See dashboard/page.tsx's identical comment — middleware already
      // guards this route; a missing token here is a narrow staleness
      // window, not the common case. J-14: this used to leave `loading`
      // true forever instead of resolving.
      setLoad({
        phase: 'error',
        message: 'Your session could not be verified. Please sign in again.',
      });
      return;
    }
    setLoad({ phase: 'loading' });
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);

    passports
      .list(params, token)
      .then((res) => setLoad({ phase: 'ready', items: res.data ?? [], total: res.total ?? 0 }))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'NO_ORGANISATION') {
          setLoad({ phase: 'no-org' });
        } else {
          setLoad({ phase: 'error', message: getErrorMessage(e, 'load your materials') });
        }
      });
  }

  useEffect(fetchPassports, [page, search, status]);

  const total = load.phase === 'ready' ? load.total : 0;
  const items = load.phase === 'ready' ? load.items : [];
  const totalPages = Math.ceil(total / 20);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Passports</h1>
          {/* J-11: hidden for accounts that cannot register a material
              (org-less, or a role the API doesn't permit) rather than
              leading to a form that will 400. */}
          {canRegisterMaterial(user) && (
            <Link href="/passports/new">
              <Button className="bg-brand-600 hover:bg-brand-700">+ Register material</Button>
            </Link>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-64"
          />
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All statuses</option>
            {['draft', 'active', 'listed', 'reserved', 'sold', 'installed', 'decommissioned'].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </div>

        {/* List */}
        <Card>
          <CardContent className="p-0">
            {load.phase === 'loading' && (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            )}
            {load.phase === 'no-org' && (
              <div className="py-12 text-center text-gray-400 text-sm max-w-sm mx-auto">
                This account isn&apos;t linked to an organisation, so it holds no materials of its
                own.
              </div>
            )}
            {load.phase === 'error' && (
              <LoadFailure message={load.message} onRetry={fetchPassports} />
            )}
            {load.phase === 'ready' && items.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-gray-400 text-sm">No passports found.</p>
                {canRegisterMaterial(user) && (
                  <Link
                    href="/passports/new"
                    className="text-brand-600 hover:underline text-sm mt-2 block"
                  >
                    Register your first material
                  </Link>
                )}
              </div>
            )}
            {load.phase === 'ready' && items.length > 0 && (
              <ul className="divide-y">
                {items.map((p) => (
                  <li key={p.id}>
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-6 py-4 hover:bg-gray-50 transition-colors">
                      <Link
                        href={`/passports/${p.id}`}
                        className="min-w-0 basis-full sm:basis-0 sm:flex-1"
                      >
                        <p className="font-medium text-sm truncate">{p.productName}</p>
                        <p className="text-xs text-gray-500">
                          {categoryLabel(p.categoryL1, p.categoryL2)}
                          {p.conditionGrade ? ` · Grade ${p.conditionGrade}` : ''}
                          {' · '}
                          {new Date(p.createdAt).toLocaleDateString()}
                        </p>
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {p.blockchainAnchoredAt && (
                          <span
                            className="text-xs text-green-600"
                            title={
                              p.blockchainTxHash
                                ? 'Anchored on VeChainThor'
                                : 'Trust layer prepared'
                            }
                          >
                            {p.blockchainTxHash ? '⛓' : '🛡'}
                          </span>
                        )}
                        <Badge variant={STATUS_COLORS[p.status] ?? 'outline'}>{p.status}</Badge>
                        {/* J-11: only shown to an account that could actually
                            create the listing — a buyer or an org-less
                            account previously saw this and hit a 403/400. */}
                        {p.status === 'active' &&
                          canCreateListing(user) &&
                          ((p.conditionPhotos?.length ?? 0) > 0 ? (
                            <Link href={`/listings/new?passportId=${p.id}`}>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-brand-600 border-brand-600 hover:bg-brand-50"
                              >
                                List for sale
                              </Button>
                            </Link>
                          ) : (
                            <Link
                              href={`/passports/${p.id}`}
                              title="At least one material photo is required before listing"
                            >
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-amber-600 border-amber-300 hover:bg-amber-50"
                              >
                                Add a photo to list
                              </Button>
                            </Link>
                          ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{total} passports total</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-gray-500 flex items-center px-2">
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
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
