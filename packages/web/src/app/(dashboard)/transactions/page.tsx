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

const TX_STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'outline'> = {
  pending: 'warning',
  confirmed: 'success',
  disputed: 'default',
  resolved: 'success',
  completed: 'success',
  cancelled: 'outline',
};

function formatPrice(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

function ActionButtons({
  tx,
  userId,
  onUpdate,
}: {
  tx: MarketplaceTransaction;
  userId: string;
  onUpdate: () => void;
}) {
  const token = getToken()!;
  const [loading, setLoading] = useState<string | null>(null);

  async function act(action: string) {
    setLoading(action);
    try {
      await marketplace.updateTransaction(tx.id, action, token);
      track('transaction-update', { transactionAction: action, isBuyer: tx.buyerId === userId });
      onUpdate();
    } catch (e) {
      // J-10: was a native alert() carrying the raw ApiError message.
      toast({
        title: 'Action failed',
        description: getErrorMessage(e, 'complete this action'),
        variant: 'destructive',
      });
    } finally {
      setLoading(null);
    }
  }

  const isBuyer = tx.buyerId === userId;
  const isSeller = tx.sellerId === userId;

  if (tx.status === 'cancelled' || tx.status === 'completed') return null;

  return (
    <div className="flex gap-2 flex-wrap">
      {isBuyer && (tx.status === 'pending' || tx.status === 'confirmed') && (
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700 text-white"
          onClick={() => act('confirm_delivery')}
          disabled={loading !== null}
        >
          {loading === 'confirm_delivery' ? 'Confirming…' : 'Confirm delivery'}
        </Button>
      )}
      {isBuyer && (tx.status === 'pending' || tx.status === 'confirmed') && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => act('flag_dispute')}
          disabled={loading !== null}
        >
          {loading === 'flag_dispute' ? 'Flagging…' : 'Flag dispute'}
        </Button>
      )}
      {(isBuyer || isSeller) && (tx.status === 'pending' || tx.status === 'confirmed') && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => act('cancel')}
          disabled={loading !== null}
        >
          {loading === 'cancel' ? 'Cancelling…' : 'Cancel'}
        </Button>
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
                            {tx.status}
                          </Badge>
                          <span className="font-semibold text-sm">
                            {formatPrice(tx.amountPence)}
                          </span>
                          {user && tx.buyerId === user.id && (
                            <span className="text-xs bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">
                              You are buyer
                            </span>
                          )}
                          {user && tx.sellerId === user.id && (
                            <span className="text-xs bg-purple-50 text-purple-700 rounded px-1.5 py-0.5">
                              You are seller
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Order placed {new Date(tx.createdAt).toLocaleDateString()}
                          {tx.disputeDeadline && tx.status === 'pending'
                            ? ` · Dispute deadline ${new Date(tx.disputeDeadline).toLocaleDateString()}`
                            : ''}
                        </p>
                        {tx.notes && (
                          <p className="text-xs text-gray-500 italic mt-1">{tx.notes}</p>
                        )}
                      </div>
                    </div>

                    {user && <ActionButtons tx={tx} userId={user.id} onUpdate={load} />}
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
