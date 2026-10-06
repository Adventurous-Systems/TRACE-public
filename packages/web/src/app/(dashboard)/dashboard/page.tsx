'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadFailure } from '@/components/ui/load-state';
import { passports, ApiError, type PassportSummary } from '@/lib/api-client';
import {
  getToken,
  getUser,
  canRegisterMaterial,
  hasOrganisation,
  type StoredUser,
} from '@/lib/auth';
import { InspectorDashboard } from '@/components/quality/InspectorDashboard';
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

// J-02: three distinct outcomes instead of a loading boolean plus an
// implicit "empty means zero". `GET /passports` returns 400 NO_ORGANISATION
// for platform_admin, inspector and the demo buyer/applicant — all
// org-less by design — and the dashboard used to render that exactly like
// a genuinely empty catalogue: "Total passports 0", "No passports yet.
// Register one." Same failure class as D-07 (an error state rendered as
// fact), in a place D-07's fix didn't reach.
interface Stats {
  total: number;
  byStatus: Record<string, number>;
  anchored: number;
}

type Load =
  | { phase: 'loading' }
  | { phase: 'ready'; items: PassportSummary[]; stats: Stats }
  | { phase: 'no-org' }
  | { phase: 'error'; message: string };

export default function DashboardPage() {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  // Effect-based, not a render-time call — getUser() returns null on the
  // server, and reading it during render hydration-mismatches.
  const [user, setUser] = useState<StoredUser | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  function fetchPassports() {
    const current = getUser();
    // An account with no organisation holds no materials. That is known
    // before asking, so don't make a request that can only fail (it used to
    // put a 400 in the console on every load).
    if (current && !hasOrganisation(current)) {
      setLoad({ phase: 'no-org' });
      return;
    }
    const token = getToken();
    if (!token) {
      // Middleware already redirects an unauthenticated visitor to /login
      // before this page can render; reaching here with no token is a
      // narrow client/server staleness window, not the common case. Resolve
      // to a terminal phase either way — J-14: this used to leave `loading`
      // true forever, so the tiles spun indefinitely instead of showing
      // anything.
      setLoad({
        phase: 'error',
        message: 'Your session could not be verified. Please sign in again.',
      });
      return;
    }
    setLoad({ phase: 'loading' });
    // The tiles count every passport the organisation holds; the list below
    // shows the five most recent. (The tiles used to be counted from those
    // five: "Total 10, Active 0, Anchored 5".)
    Promise.all([
      passports.list(new URLSearchParams({ limit: '5' }), token),
      passports.stats(token),
    ])
      .then(([recent, stats]) => setLoad({ phase: 'ready', items: recent.data, stats }))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'NO_ORGANISATION') {
          setLoad({ phase: 'no-org' });
        } else {
          setLoad({ phase: 'error', message: getErrorMessage(e, 'load your materials') });
        }
      });
  }

  useEffect(fetchPassports, []);

  const stats = load.phase === 'ready' ? load.stats : null;
  const items = load.phase === 'ready' ? load.items : [];
  const isInspector = user?.role === 'inspector';

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-gray-500 text-sm">
              {user?.email} · {user?.role?.replace(/_/g, ' ')}
            </p>
          </div>
          {/* J-11: an org-less account (platform admin, inspector, the demo
              buyer/applicant) cannot register a material — POST /passports
              400s with NO_ORGANISATION. Hiding this rather than showing a
              CTA that always fails. */}
          {canRegisterMaterial(user) && (
            <Link href="/passports/new">
              <Button className="bg-brand-600 hover:bg-brand-700">+ Register material</Button>
            </Link>
          )}
        </div>

        {isInspector && <InspectorDashboard />}

        {!isInspector && load.phase !== 'no-org' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(
              [
                // A rendered 0 is a claim the organisation holds no materials:
                // only make it from the 'ready' phase (J-02).
                ['Total passports', stats?.total],
                [
                  'On the marketplace',
                  stats && (stats.byStatus['listed'] ?? 0) + (stats.byStatus['reserved'] ?? 0),
                ],
                ['Anchored on-chain', stats?.anchored],
              ] as const
            ).map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500">{label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{value ?? '—'}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!isInspector && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Recent passports</CardTitle>
              <Link href="/passports" className="text-sm text-brand-600 hover:underline">
                View all
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {load.phase === 'loading' && (
                <div className="px-6 py-8 text-center text-gray-400 text-sm">Loading…</div>
              )}
              {load.phase === 'no-org' && (
                <div className="px-6 py-8 text-center text-gray-400 text-sm max-w-sm mx-auto">
                  This account isn&apos;t linked to an organisation, so it holds no materials of its
                  own.
                  {user && (user.role === 'platform_admin' || user.role === 'inspector') && (
                    <>
                      {' '}
                      Browse the{' '}
                      <Link href="/marketplace" className="text-brand-600 hover:underline">
                        public marketplace
                      </Link>{' '}
                      to see what suppliers have listed.
                    </>
                  )}
                </div>
              )}
              {load.phase === 'error' && (
                <LoadFailure message={load.message} onRetry={fetchPassports} />
              )}
              {load.phase === 'ready' && items.length === 0 && (
                <div className="px-6 py-8 text-center text-gray-400 text-sm">
                  No passports yet.{' '}
                  {canRegisterMaterial(user) && (
                    <Link href="/passports/new" className="text-brand-600 hover:underline">
                      Register one
                    </Link>
                  )}
                </div>
              )}
              {load.phase === 'ready' && items.length > 0 && (
                <ul className="divide-y">
                  {items.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/passports/${p.id}`}
                        className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
                      >
                        <div>
                          <p className="font-medium text-sm">{p.productName}</p>
                          <p className="text-xs text-gray-500">
                            {categoryLabel(p.categoryL1, p.categoryL2)}
                            {p.conditionGrade ? ` · Grade ${p.conditionGrade}` : ''}
                          </p>
                        </div>
                        <Badge variant={STATUS_COLORS[p.status] ?? 'outline'}>{p.status}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
