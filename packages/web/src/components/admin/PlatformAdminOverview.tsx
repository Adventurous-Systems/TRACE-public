'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { accessRequests, audit, feedback } from '@/lib/api-client';
import { feedbackLine, gasPayerLine, waitingLine } from '@/lib/admin-overview';
import { getToken, type StoredUser } from '@/lib/auth';
import { useOrdersSummary } from '@/lib/use-orders-summary';

/** One card's line: loading, what it found, or that it could not find out. */
type Line = { state: 'loading' } | { state: 'ok'; text: string } | { state: 'failed' };

const COULD_NOT_LOAD = 'Couldn’t load this just now';

/**
 * The platform admin's dashboard: what waits for them, each with a link to
 * where it is handled. Each card loads on its own; one that fails says so,
 * never "0" (a count it does not have).
 */
export function PlatformAdminOverview({ user }: { user: StoredUser }) {
  const orders = useOrdersSummary(user);
  const [requests, setRequests] = useState<Line>({ state: 'loading' });
  const [notes, setNotes] = useState<Line>({ state: 'loading' });
  const [chain, setChain] = useState<Line & { tone?: string }>({ state: 'loading' });

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    accessRequests
      .list(token, 'pending')
      .then((rows) =>
        setRequests({ state: 'ok', text: waitingLine(rows.length, 'request', 'requests') }),
      )
      .catch(() => setRequests({ state: 'failed' }));
    feedback
      .list(token)
      .then((rows) => setNotes({ state: 'ok', text: feedbackLine(rows) }))
      .catch(() => setNotes({ state: 'failed' }));
    audit
      .blockchainTransactions(token, 1)
      .then((res) => {
        const line = gasPayerLine(res.summary.gasPayer.status);
        setChain({ state: 'ok', text: line.text, tone: line.tone });
      })
      .catch(() => setChain({ state: 'failed' }));
  }, []);

  const flagged: Line = orders
    ? {
        state: 'ok',
        text: waitingLine(
          orders.flagged ?? 0,
          'order waits for a decision',
          'orders wait for a decision',
        ),
      }
    : { state: 'loading' };

  const cards: Array<{ title: string; line: Line; href: string; action: string; warn?: boolean }> =
    [
      {
        title: 'Flagged orders',
        line: flagged,
        href: '/admin/flagged-orders',
        action: 'Resolve flagged orders',
      },
      {
        title: 'Access requests',
        line: requests,
        href: '/admin/access-requests',
        action: 'Review requests',
      },
      { title: 'Feedback', line: notes, href: '/admin/feedback', action: 'Read feedback' },
      {
        title: 'Chain',
        line: chain,
        href: '/admin/activity',
        action: 'Activity & VTHO',
        warn: chain.tone === 'warn',
      },
    ];

  return (
    <section aria-label="What waits for you" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">{card.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className={`text-lg font-semibold ${card.warn ? 'text-amber-800' : ''}`}>
              {card.line.state === 'ok'
                ? card.line.text
                : card.line.state === 'failed'
                  ? COULD_NOT_LOAD
                  : 'Loading…'}
            </p>
            <Link href={card.href} className="text-sm text-brand-700 hover:underline">
              {card.action} →
            </Link>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
