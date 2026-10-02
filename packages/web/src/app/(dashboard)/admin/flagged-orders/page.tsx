'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatQuantity } from '@trace/core';
import DashboardLayout from '@/components/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadFailure, NoAccess } from '@/components/ui/load-state';
import { toast } from '@/components/ui/use-toast';
import { marketplace, type FlaggedOrder } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/api-errors';
import { getToken, getUser, isPlatformAdmin, type StoredUser } from '@/lib/auth';
import { formatDateTime, formatPrice } from '@/lib/format';
import { stepText } from '@/lib/orders';
import { announceOrdersChanged } from '@/lib/use-orders-summary';

type Outcome = 'sale_stands' | 'cancel_order';

const OUTCOMES: Array<{ value: Outcome; label: string; effect: string }> = [
  {
    value: 'sale_stands',
    label: 'The sale stands',
    effect: 'The order is closed as sold. Its quantity stays sold.',
  },
  {
    value: 'cancel_order',
    label: 'Cancel the order',
    effect: 'The order is cancelled. Its quantity goes back to the lot.',
  },
];
const MIN_REASON = 5;

function ResolveForm({ order, onResolved }: { order: FlaggedOrder; onResolved: () => void }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const ready = outcome !== null && note.trim().length >= MIN_REASON;

  async function resolve() {
    const token = getToken();
    if (!token || !outcome) return;
    setSaving(true);
    try {
      await marketplace.updateTransaction(order.id, 'resolve_dispute', token, {
        outcome,
        notes: note.trim(),
      });
      toast({ title: 'Resolved', description: 'The buyer and the seller can see the outcome.' });
      onResolved();
    } catch (e) {
      toast({
        title: 'Not resolved',
        description: getErrorMessage(e, 'resolve this order'),
        variant: 'destructive',
      });
      onResolved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="space-y-3 rounded-md border bg-gray-50 p-3">
      <legend className="px-1 text-sm font-medium">Resolve</legend>
      <div className="space-y-2">
        {OUTCOMES.map(({ value, label, effect }) => (
          <label key={value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`outcome-${order.id}`}
              className="mt-1"
              checked={outcome === value}
              onChange={() => setOutcome(value)}
            />
            <span>
              <span className="font-medium">{label}</span>
              <span className="block text-xs text-gray-600">{effect}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="space-y-1">
        <label htmlFor={`note-${order.id}`} className="block text-sm font-medium">
          Why
        </label>
        <p className="text-xs text-gray-600">The buyer and the seller both read this.</p>
        <textarea
          id={`note-${order.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={1000}
          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
      <Button size="sm" onClick={resolve} disabled={!ready || saving}>
        {saving ? 'Resolving…' : 'Resolve order'}
      </Button>
    </fieldset>
  );
}

function OrderCard({ order, onResolved }: { order: FlaggedOrder; onResolved: () => void }) {
  const waiting = order.status === 'disputed';
  return (
    <li className="space-y-3 px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={waiting ? 'warning' : 'outline'}>
          {waiting
            ? 'Waiting for you'
            : order.resolution?.outcome === 'cancel_order'
              ? 'Resolved: order cancelled'
              : 'Resolved: sale stands'}
        </Badge>
        <span className="text-sm font-semibold">{formatPrice(order.amountPence)}</span>
        <span className="text-sm text-gray-700">
          {order.passportId ? (
            <Link href={`/passport/${order.passportId}`} className="font-medium hover:underline">
              {order.productName ?? 'Material'}
            </Link>
          ) : (
            (order.productName ?? 'Material')
          )}{' '}
          · quantity {formatQuantity(order.quantity, order.unitOfMeasure)}
        </span>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-gray-500">Buyer</dt>
          <dd>{order.buyer ? `${order.buyer.name} (${order.buyer.email})` : 'Unknown'}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Seller</dt>
          <dd>{order.sellerOrganisation ?? 'Unknown'}</dd>
        </div>
      </dl>

      <div className="text-sm">
        <p className="text-xs text-gray-500">
          Problem reported{order.flaggedAt ? ` ${formatDateTime(order.flaggedAt)}` : ''}
        </p>
        <p className="mt-0.5 rounded-md bg-amber-50 p-3 text-gray-900">
          {order.reason ?? 'No reason was recorded (reported before reasons were required).'}
        </p>
      </div>

      {order.resolution && (
        <div className="text-sm">
          <p className="text-xs text-gray-500">Resolved {formatDateTime(order.resolution.at)}</p>
          {order.resolution.note && (
            <p className="mt-0.5 rounded-md bg-gray-50 p-3 text-gray-900">
              {order.resolution.note}
            </p>
          )}
        </div>
      )}

      {order.steps.length > 0 && (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-700">
            History
          </summary>
          <ol className="mt-1 space-y-1 border-l pl-3">
            {order.steps.map((step, index) => (
              <li key={index}>
                <span className="text-gray-500">{formatDateTime(step.createdAt)}</span> ·{' '}
                {stepText(step)}
              </li>
            ))}
          </ol>
        </details>
      )}

      {waiting && <ResolveForm order={order} onResolved={onResolved} />}
    </li>
  );
}

/**
 * The platform admin's list of orders with a problem reported: what the buyer
 * said, who is involved, and a decision with a reason. Before this screen a
 * flagged order could only be resolved through the API, one way.
 */
export default function FlaggedOrdersPage() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [orders, setOrders] = useState<FlaggedOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const token = getToken();
    const current = getUser();
    setUser(current);
    if (!token || !isPlatformAdmin(current)) return;
    marketplace
      .flaggedOrders(token)
      .then((data) => {
        setOrders(data);
        setError(null);
        announceOrdersChanged();
      })
      .catch((e: unknown) => setError(getErrorMessage(e, 'load the flagged orders')));
  }, []);
  useEffect(load, [load]);

  const waiting = orders?.filter((order) => order.status === 'disputed') ?? [];
  const resolved = orders?.filter((order) => order.status !== 'disputed') ?? [];

  return (
    <DashboardLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Flagged orders</h1>
          <p className="mt-1 text-sm text-gray-500">
            Orders where the buyer reported a problem. Each one stays open, and holds its quantity,
            until you decide whether the sale stands.
          </p>
        </div>

        {user && !isPlatformAdmin(user) ? (
          <NoAccess message="Flagged orders are resolved by the platform administrator." />
        ) : error ? (
          <LoadFailure message={error} onRetry={load} />
        ) : orders === null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Waiting for a decision ({waiting.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {waiting.length === 0 ? (
                  <p className="px-6 pb-6 text-sm text-gray-500">Nothing is waiting.</p>
                ) : (
                  <ul className="divide-y border-t" aria-label="Waiting for a decision">
                    {waiting.map((order) => (
                      <OrderCard key={order.id} order={order} onResolved={load} />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {resolved.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Resolved ({resolved.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y border-t" aria-label="Resolved">
                    {resolved.map((order) => (
                      <OrderCard key={order.id} order={order} onResolved={load} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
