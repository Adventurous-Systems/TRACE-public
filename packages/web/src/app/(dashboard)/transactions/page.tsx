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
import { formatDate, formatPrice } from '@/lib/format';
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
// live in one place. resolve_dispute has no screen yet.
const ACTIONS: Array<{ action: string; label: string; busy: string; primary?: boolean }> = [
  { action: 'accept', label: 'Accept order', busy: 'Accepting…', primary: true },
  { action: 'reject', label: 'Reject', busy: 'Rejecting…' },
  { action: 'confirm_delivery', label: 'Confirm delivery', busy: 'Confirming…', primary: true },
  { action: 'flag_dispute', label: 'Report a problem', busy: 'Reporting…' },
  { action: 'cancel', label: 'Cancel order', busy: 'Cancelling…' },
];

/** What happens next, for the side that is waiting. */
function nextStep(tx: MarketplaceTransaction): string | null {
  if (tx.status === 'pending' && tx.viewerSide === 'buyer') {
    return 'Waiting for the seller to accept or reject it.';
  }
  if (tx.status === 'confirmed' && tx.viewerSide === 'seller') {
    return 'Accepted. The buyer confirms delivery once the material arrives.';
  }
  if (tx.status === 'disputed') {
    return 'A problem was reported. The platform team reviews it; there is nothing more to do for now.';
  }
  return null;
}

function ActionButtons({ tx, onUpdate }: { tx: MarketplaceTransaction; onUpdate: () => void }) {
  const token = getToken()!;
  const [loading, setLoading] = useState<string | null>(null);

  async function act(action: string) {
    setLoading(action);
    try {
      await marketplace.updateTransaction(tx.id, action, token);
      track('transaction-update', {
        transactionAction: action,
        isBuyer: tx.viewerSide === 'buyer',
      });
      onUpdate();
    } catch (e) {
      // J-10: was a native alert() carrying the raw ApiError message.
      toast({
        title: 'Action failed',
        description: getErrorMessage(e, 'complete this action'),
        variant: 'destructive',
      });
      // Someone else may have acted on the order first; show where it stands.
      onUpdate();
    } finally {
      setLoading(null);
    }
  }

  const allowed = tx.allowedActions ?? [];
  const buttons = ACTIONS.filter(({ action }) => allowed.includes(action));
  const next = nextStep(tx);
  if (buttons.length === 0 && !next) return null;

  return (
    <div className="space-y-2">
      {next && <p className="text-xs text-gray-500">{next}</p>}
      {buttons.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {buttons.map(({ action, label, busy, primary }) => (
            <Button
              key={action}
              size="sm"
              variant={primary ? 'default' : 'outline'}
              className={primary ? 'bg-green-600 hover:bg-green-700 text-white' : undefined}
              onClick={() => act(action)}
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
      .then(setItems)
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
                          {tx.disputeDeadline && tx.status === 'confirmed'
                            ? ` · Report a problem by ${formatDate(tx.disputeDeadline)}`
                            : ''}
                        </p>
                        {tx.notes && (
                          <p className="text-xs text-gray-500 italic mt-1">{tx.notes}</p>
                        )}
                      </div>
                    </div>

                    <ActionButtons tx={tx} onUpdate={load} />
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
