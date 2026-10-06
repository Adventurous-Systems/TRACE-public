'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { marketplace, type MarketplaceTransaction } from '@/lib/api-client';
import { getToken, getUser } from '@/lib/auth';
import { track } from '@/lib/analytics';
import { toast } from '@/components/ui/use-toast';
import { getErrorMessage } from '@/lib/api-errors';
import { formatDate, formatDateTime, formatPrice } from '@/lib/format';
import { orderGuidance, stepText } from '@/lib/orders';
import { announceOrdersChanged } from '@/lib/use-orders-summary';
import Link from 'next/link';
import { formatQuantity } from '@trace/core';

const TX_STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'outline'> = {
  pending: 'warning',
  confirmed: 'success',
  disputed: 'warning',
  resolved: 'success',
  completed: 'success',
  cancelled: 'outline',
};

// What each order step means to the people involved.
const TX_STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting seller',
  confirmed: 'Accepted',
  disputed: 'Problem flagged',
  resolved: 'Resolved',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// The order steps a person can take, in the order they are offered. Which of
// them apply to an order comes from the API (allowedActions), so the rules
// live in one place. resolve_dispute is the platform admin's, on its own
// screen (/admin/flagged-orders).
const ACTIONS: Array<{ action: string; label: string; busy: string; primary?: boolean }> = [
  { action: 'accept', label: 'Accept order', busy: 'Accepting…', primary: true },
  { action: 'reject', label: 'Reject', busy: 'Rejecting…' },
  { action: 'confirm_delivery', label: 'Confirm delivery', busy: 'Confirming…', primary: true },
  { action: 'flag_dispute', label: 'Report a problem', busy: 'Reporting…' },
  { action: 'cancel', label: 'Cancel order', busy: 'Cancelling…' },
];

const MIN_REASON = 5;

function ActionButtons({ tx, onUpdate }: { tx: MarketplaceTransaction; onUpdate: () => void }) {
  const token = getToken()!;
  const [loading, setLoading] = useState<string | null>(null);
  // Reporting a problem asks what is wrong before it is sent.
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');

  async function act(action: string, notes?: string) {
    setLoading(action);
    try {
      await marketplace.updateTransaction(tx.id, action, token, notes ? { notes } : {});
      track('transaction-update', {
        transactionAction: action,
        isBuyer: tx.viewerSide === 'buyer',
      });
      setReporting(false);
      setReason('');
      onUpdate();
    } catch (e) {
      // J-10: was a native alert() carrying the raw ApiError message.
      toast({
        title: 'Action failed',
        description: getErrorMessage(e, 'complete this action'),
        variant: 'destructive',
      });
      // Someone else, or a time limit, may have moved the order first; show
      // where it stands.
      onUpdate();
    } finally {
      setLoading(null);
    }
  }

  const allowed = tx.allowedActions ?? [];
  const buttons = ACTIONS.filter(({ action }) => allowed.includes(action));
  const guidance = orderGuidance(tx);
  if (buttons.length === 0 && !guidance) return null;

  if (reporting) {
    const reasonId = `reason-${tx.id}`;
    const enough = reason.trim().length >= MIN_REASON;
    return (
      <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
        <label htmlFor={reasonId} className="block text-sm font-medium text-gray-900">
          What is the problem?
        </label>
        <p className="text-xs text-gray-600">
          The seller and the platform team read this. The platform team then decides whether the
          sale stands or the order is cancelled.
        </p>
        <textarea
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => act('flag_dispute', reason.trim())}
            disabled={!enough || loading !== null}
          >
            {loading === 'flag_dispute' ? 'Reporting…' : 'Send report'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReporting(false)}
            disabled={loading !== null}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {guidance && <p className="text-xs text-gray-600">{guidance}</p>}
      {buttons.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {buttons.map(({ action, label, busy, primary }) => (
            <Button
              key={action}
              size="sm"
              variant={primary ? 'default' : 'outline'}
              className={primary ? 'bg-green-600 hover:bg-green-700 text-white' : undefined}
              onClick={() => (action === 'flag_dispute' ? setReporting(true) : act(action))}
              disabled={loading !== null}
            >
              {loading === action ? busy : label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What was said at the step that matters now: the buyer's reported problem
 * while it waits for a decision, and the platform's reason once decided.
 */
function WhatWasSaid({ tx }: { tx: MarketplaceTransaction }) {
  const steps = tx.steps ?? [];
  const last = steps.at(-1);
  const said =
    tx.status === 'disputed'
      ? { label: 'The reported problem', step: last?.action === 'flag_dispute' ? last : undefined }
      : last?.action === 'resolve_dispute'
        ? { label: "The platform's reason", step: last }
        : null;
  if (!said?.step?.note) return null;
  return (
    <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-700">
      <span className="text-gray-500">{said.label}: </span>
      {said.step.note}
    </p>
  );
}

/** How the order got to where it is. Shown once there is more than "placed". */
function History({ tx }: { tx: MarketplaceTransaction }) {
  const steps = tx.steps ?? [];
  if (steps.length < 2) return null;
  return (
    <details className="text-xs text-gray-600">
      <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-700">
        History
      </summary>
      <ol className="mt-1 space-y-1 border-l pl-3">
        {steps.map((step, index) => (
          <li key={index}>
            <span className="text-gray-500">{formatDateTime(step.createdAt)}</span> ·{' '}
            {stepText(step)}
            {step.note && step.action !== 'placed' && (
              <span className="italic"> — “{step.note}”</span>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function TransactionsPage() {
  const [items, setItems] = useState<MarketplaceTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const user = getUser();

  function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    marketplace
      .transactions(token)
      .then((orders) => {
        setItems(orders);
        // What is on screen now has been seen; "New" marks only what changes
        // after this visit. Then the counts in the navigation follow.
        void marketplace
          .markOrdersSeen(token)
          .catch(() => undefined)
          .then(announceOrdersChanged);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Orders</h1>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-gray-400 text-sm">No orders yet.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Orders appear here when you buy or sell a listed material.
                </p>
                {user?.role === 'platform_admin' && (
                  <p className="text-sm mt-3">
                    <Link href="/admin/flagged-orders" className="text-brand-600 hover:underline">
                      Orders with a reported problem are under Flagged orders
                    </Link>
                  </p>
                )}
              </div>
            ) : (
              <ul className="divide-y">
                {items.map((tx) => (
                  <li key={tx.id} className="px-6 py-4 space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={TX_STATUS_COLORS[tx.status] ?? 'outline'}>
                            {TX_STATUS_LABELS[tx.status] ?? tx.status}
                          </Badge>
                          {tx.isNew && (
                            <span className="text-xs font-medium bg-brand-50 text-brand-700 rounded px-1.5 py-0.5">
                              New
                            </span>
                          )}
                          <span className="font-semibold text-sm">
                            {formatPrice(tx.amountPence)}
                          </span>
                          {tx.viewerSide === 'buyer' && (
                            <span className="text-xs bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">
                              You are buying
                            </span>
                          )}
                          {tx.viewerSide === 'seller' && (
                            <span className="text-xs bg-purple-50 text-purple-700 rounded px-1.5 py-0.5">
                              {user && tx.sellerId === user.id
                                ? 'You are selling'
                                : 'Your organisation is selling'}
                            </span>
                          )}
                        </div>
                        {tx.productName && (
                          <p className="mt-1 text-sm font-medium text-gray-900">
                            {tx.passportId ? (
                              <Link href={`/passport/${tx.passportId}`} className="hover:underline">
                                {tx.productName}
                              </Link>
                            ) : (
                              tx.productName
                            )}
                          </p>
                        )}
                        <p className="text-sm text-gray-700">
                          {tx.legacyWholeLot
                            ? 'The whole lot, at the price shown. Placed before orders had a quantity.'
                            : `Quantity ${formatQuantity(tx.quantity, tx.unitOfMeasure)}`}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Order placed {formatDate(tx.createdAt)}
                        </p>
                        {tx.notes && (
                          <p className="text-xs text-gray-500 italic mt-1">{tx.notes}</p>
                        )}
                      </div>
                    </div>

                    <ActionButtons tx={tx} onUpdate={load} />
                    <WhatWasSaid tx={tx} />
                    <History tx={tx} />
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
