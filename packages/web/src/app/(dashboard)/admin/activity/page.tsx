'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NoAccess } from '@/components/ui/load-state';
import { audit, type AuditEvent, type BlockchainTransactionsResponse } from '@/lib/api-client';
import { getToken, getUser, canViewAdmin, type StoredUser } from '@/lib/auth';

function formatVtho(value: string | null | undefined) {
  if (!value) return '—';
  try {
    const wei = value.startsWith('0x') ? BigInt(value) : BigInt(value);
    const oneVtho = BigInt('1000000000000000000');
    const whole = wei / oneVtho;
    const frac = (wei % oneVtho).toString().padStart(18, '0').slice(0, 6);
    return `${whole}.${frac} VTHO`;
  } catch {
    return value;
  }
}

function statusVariant(
  status: string,
): 'default' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'succeeded' || status === 'ok') return 'success';
  if (status === 'failed' || status === 'critical') return 'destructive';
  if (status === 'pending' || status === 'submitted' || status === 'warning') return 'warning';
  return 'outline';
}

export default function AdminActivityPage() {
  // J-12: this page had NO role guard at all. A buyer navigating here
  // directly saw the full admin layout — stat tiles, "Blockchain
  // transactions", "User actions" — populated with "—" and "No transactions
  // logged", because both API calls behind it 403'd and were swallowed by
  // `.catch(console.error)`. It read as "this feature is empty" rather than
  // "this isn't yours". Effect-based, not a render-time call, to avoid a
  // hydration mismatch (getUser() returns null on the server).
  const [user, setUser] = useState<StoredUser | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [chain, setChain] = useState<BlockchainTransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(getUser());
  }, []);

  useEffect(() => {
    if (!user) return;
    if (!canViewAdmin(user)) {
      setLoading(false);
      return;
    }
    const token = getToken();
    if (!token) return;
    Promise.all([audit.events(token, 40), audit.blockchainTransactions(token, 40)])
      .then(([eventData, chainData]) => {
        setEvents(eventData);
        setChain(chainData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user]);

  if (user && !canViewAdmin(user)) {
    return (
      <DashboardLayout>
        <NoAccess message="Activity and VTHO spend are visible to platform and hub admins." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Activity & VTHO</h1>
          <p className="text-sm text-gray-500 mt-1">
            Critical platform actions and sponsored transaction spend.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500">Recent VTHO spend</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatVtho(chain?.summary.recentSpendWei)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500">Gas payer balance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-2xl font-bold">{formatVtho(chain?.summary.gasPayer.energyWei)}</p>
              <Badge variant={statusVariant(chain?.summary.gasPayer.status ?? 'unknown')}>
                {chain?.summary.gasPayer.status ?? 'unknown'}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500">Transaction status</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                {Object.entries(chain?.summary.statusCounts ?? {})
                  .map(([status, count]) => `${status}: ${count}`)
                  .join(' · ') || 'No transactions logged'}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Blockchain transactions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
            ) : (
              <ul className="divide-y">
                {(chain?.items ?? []).map((tx) => (
                  <li key={tx.id} className="px-6 py-4 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={statusVariant(tx.status)}>{tx.status}</Badge>
                      <span className="font-medium text-sm">{tx.action}</span>
                      {tx.resourceId && (
                        <span className="text-xs text-gray-400">
                          {tx.resourceType}:{tx.resourceId}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-gray-500 break-all">
                      {tx.txHash ?? 'No transaction hash yet'}
                    </p>
                    <p className="text-xs text-gray-500">
                      Gas {tx.gasUsed ?? '—'} · {formatVtho(tx.vthoPaidWei)} ·{' '}
                      {new Date(tx.createdAt).toLocaleString()}
                    </p>
                    {tx.failureReason && <p className="text-xs text-red-600">{tx.failureReason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">User actions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
            ) : (
              <ul className="divide-y">
                {events.map((event) => (
                  <li key={event.id} className="px-6 py-4 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={statusVariant(event.status)}>{event.status}</Badge>
                      <span className="font-medium text-sm">{event.action}</span>
                      {event.actorEmail && (
                        <span className="text-xs text-gray-500">{event.actorEmail}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {event.resourceType}
                      {event.resourceId ? `:${event.resourceId}` : ''} ·{' '}
                      {new Date(event.createdAt).toLocaleString()}
                    </p>
                    {event.origin && <p className="text-xs text-gray-500">Origin {event.origin}</p>}
                    {event.failureReason && (
                      <p className="text-xs text-red-600">{event.failureReason}</p>
                    )}
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
