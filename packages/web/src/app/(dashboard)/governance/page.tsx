'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { governance, type ProposalSummary } from '@/lib/api-client';
import { getToken } from '@/lib/auth';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    passed: 'bg-blue-100 text-blue-800',
    rejected: 'bg-red-100 text-red-800',
    executed: 'bg-purple-100 text-purple-800',
    cancelled: 'bg-gray-100 text-gray-700',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-700'}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function VoteBar({ forVotes, againstVotes }: { forVotes: string; againstVotes: string }) {
  const f = Number(forVotes);
  const a = Number(againstVotes);
  const total = f + a;
  if (total === 0) return <div className="h-2 bg-gray-100 rounded-full" />;
  const forPct = Math.round((f / total) * 100);
  return (
    <div className="h-2 bg-red-200 rounded-full overflow-hidden">
      <div className="h-full bg-green-500 rounded-full" style={{ width: `${forPct}%` }} />
    </div>
  );
}

export default function GovernancePage() {
  const router = useRouter();
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);

    governance
      .list(params)
      .then((res) => {
        setProposals(res.data);
        setTotal(res.total);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load proposals'))
      .finally(() => setLoading(false));
  }, [router, statusFilter]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Governance</h1>
            <p className="text-gray-500 text-sm mt-1">
              Commons governance — Ostrom Principle 3 (Collective Choice)
            </p>
          </div>
          <Link href="/governance/new">
            <Button size="sm">New Proposal</Button>
          </Link>
        </div>

        {/* Status filter */}
        <div className="flex gap-2 flex-wrap">
          {['', 'active', 'passed', 'rejected', 'executed', 'cancelled'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                statusFilter === s
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'
              }`}
            >
              {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {loading && <div className="text-center py-12 text-gray-400">Loading proposals...</div>}
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && proposals.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-500 text-sm">No proposals yet.</p>
            <Link href="/governance/new">
              <Button className="mt-4" size="sm">
                Create the first proposal
              </Button>
            </Link>
          </div>
        )}

        <div className="space-y-4">
          {proposals.map((p) => (
            <Link key={p.id} href={`/governance/${p.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={p.status} />
                        <span className="text-xs text-gray-400">
                          {p.voteCount} vote{p.voteCount !== 1 ? 's' : ''}
                          {p.quorumReached ? ' · quorum reached' : ''}
                        </span>
                      </div>
                      <h3 className="font-semibold text-gray-900 truncate">{p.title}</h3>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{p.description}</p>
                    </div>
                    <div className="text-right text-xs text-gray-400 shrink-0">
                      {p.status === 'active' && (
                        <span>Ends {new Date(p.votingEndsAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3">
                    <VoteBar forVotes={p.forVotes} againstVotes={p.againstVotes} />
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>{Number(p.forVotes).toFixed(0)} CBT for</span>
                      <span>{Number(p.againstVotes).toFixed(0)} CBT against</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {total > proposals.length && (
          <p className="text-center text-sm text-gray-400">
            Showing {proposals.length} of {total}
          </p>
        )}
      </div>
    </DashboardLayout>
  );
}
