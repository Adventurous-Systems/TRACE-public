'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { NoAccess } from '@/components/ui/load-state';
import { toast } from '@/components/ui/use-toast';
import { marketplace, type ListingSummary } from '@/lib/api-client';
import { getToken, getUser, canCreateListing, hasOrganisation, type StoredUser } from '@/lib/auth';
import { getErrorMessage } from '@/lib/api-errors';
import { categoryLabel } from '@/lib/categories';
import { formatDate, formatPrice } from '@/lib/format';
import { formatQuantity, perUnit } from '@trace/core';

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'outline'> = {
  active: 'success',
  reserved: 'warning',
  sold: 'outline',
  expired: 'outline',
  cancelled: 'outline',
};

// A lot's status in a seller's words.
const STATUS_LABELS: Record<string, string> = {
  active: 'On sale',
  reserved: 'Fully ordered',
  sold: 'Sold',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

/** How much of a lot is left, and how much orders have taken. */
function stockLine(l: ListingSummary): string {
  const unit = l.passport.unitOfMeasure;
  const taken = l.quantity - l.quantityAvailable;
  const left = `${formatQuantity(l.quantityAvailable, unit)} of ${formatQuantity(l.quantity, unit)} left`;
  const minimum =
    l.minOrderQuantity > 1 ? ` · minimum order ${formatQuantity(l.minOrderQuantity, unit)}` : '';
  return taken > 0
    ? `${left} · ${formatQuantity(taken, unit)} ordered or sold${minimum}`
    : `${left}${minimum}`;
}

export default function ListingsPage() {
  // J-12: a buyer navigating here directly saw "No listings yet." with a
  // dead "List your first material" link — the 403 from hubListings() was
  // swallowed by `.catch(console.error)` and rendered indistinguishably from
  // a genuinely empty catalogue. Effect-based user read to avoid a
  // hydration mismatch.
  const [user, setUser] = useState<StoredUser | null>(null);
  const [items, setItems] = useState<ListingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    marketplace
      .hubListings(token)
      .then(setItems)
      .catch((e) =>
        toast({
          title: 'Failed to load listings',
          description: getErrorMessage(e, 'load your listings'),
          variant: 'destructive',
        }),
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!user) return;
    if (!canCreateListing(user)) {
      setLoading(false);
      return;
    }
    load();
  }, [user]);

  async function handleCancel(id: string) {
    const token = getToken();
    if (!token) return;
    setCancelling(id);
    try {
      await marketplace.cancelListing(id, token);
      load();
    } catch (e) {
      // J-10: was a native alert() — the single most jarring failure mode on
      // this list, and it carried the raw ApiError message.
      toast({
        title: 'Couldn’t cancel listing',
        description: getErrorMessage(e, 'cancel this listing'),
        variant: 'destructive',
      });
    } finally {
      setCancelling(null);
    }
  }

  if (user && !canCreateListing(user)) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <h1 className="text-2xl font-bold">Listings</h1>
          <NoAccess
            message={
              hasOrganisation(user)
                ? 'Listings are managed by suppliers and hub staff.'
                : "This account isn't linked to an organisation, so it has nothing to list."
            }
          />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Listings</h1>
          <Link href="/listings/new">
            <Button className="bg-brand-600 hover:bg-brand-700">+ New listing</Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-gray-400 text-sm">No listings yet.</p>
                <Link
                  href="/listings/new"
                  className="text-brand-600 hover:underline text-sm mt-2 block"
                >
                  List your first material
                </Link>
              </div>
            ) : (
              <ul className="divide-y">
                {items.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-6 py-4"
                  >
                    <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                      <p className="font-medium text-sm truncate">{l.passport.productName}</p>
                      <p className="text-xs text-gray-500">
                        {categoryLabel(l.passport.categoryL1, l.passport.categoryL2)}
                        {l.passport.conditionGrade ? ` · Grade ${l.passport.conditionGrade}` : ''}
                        {' · Listed '}
                        {formatDate(l.createdAt)}
                        {l.expiresAt ? ` · Expires ${formatDate(l.expiresAt)}` : ''}
                      </p>
                      <p className="text-xs text-gray-700 mt-0.5">{stockLine(l)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      <span className="font-semibold text-sm">
                        {formatPrice(l.pricePence)}
                        {l.passport.unitOfMeasure && (
                          <span className="font-normal text-gray-500">
                            {' '}
                            {perUnit(l.passport.unitOfMeasure)}
                          </span>
                        )}
                      </span>
                      <Badge variant={STATUS_COLORS[l.status] ?? 'outline'}>
                        {STATUS_LABELS[l.status] ?? l.status}
                      </Badge>
                      <Link href={`/marketplace/${l.id}`}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                      {l.status === 'active' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCancel(l.id)}
                          disabled={cancelling === l.id}
                        >
                          {cancelling === l.id ? 'Cancelling…' : 'Cancel'}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
