'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { governance, type ProposalDetail } from '@/lib/api-client';
import { getToken, getUser } from '@/lib/auth';

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
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? 'bg-gray-100 text-gray-700'}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function ProposalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  const user = getUser();

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    governance
      .get(id)
      .then((p) => {
        setProposal(p);
        if (user) {
          setHasVoted(p.votes.some((v) => v.voterId === user.id));
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load proposal'))
      .finally(() => setLoading(false));
  }, [id, router, user]);

  async function handleVote(support: boolean) {
    const token = getToken();
    if (!token) return;
    setVoting(true);
    setVoteError(null);
    try {
      await governance.vote(id, support, token);
      const updated = await governance.get(id);
      setProposal(updated);
      setHasVoted(true);
    } catch (e: unknown) {
      setVoteError(e instanceof Error ? e.message : 'Vote failed');
    } finally {
      setVoting(false);
    }
  }

  async function handleCancel() {
    const token = getToken();
    if (!token) return;
    setCancelling(true);
    try {
      await governance.cancel(id, token);
      const updated = await governance.get(id);
      setProposal(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="text-center py-12 text-gray-400">Loading...</div>
      </DashboardLayout>
    );
  }

  if (error || !proposal) {
    return (
      <DashboardLayout>
        <div className="rounded-md bg-red-50 p-4 text-red-700">{error ?? 'Not found'}</div>
      </DashboardLayout>
    );
  }

  const totalVotes = Number(proposal.forVotes) + Number(proposal.againstVotes);
  const forPct = totalVotes > 0 ? Math.round((Number(proposal.forVotes) / totalVotes) * 100) : 0;
  const againstPct = totalVotes > 0 ? 100 - forPct : 0;
  const isActive = proposal.status === 'active';
  const isCreator = user?.id === proposal.creatorId;
  const isAdmin = user?.role === 'platform_admin' || user?.role === 'hub_admin';
  const votingEnded = new Date() > new Date(proposal.votingEndsAt);

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/governance" className="text-sm text-gray-500 hover:text-gray-700">
            Back to Governance
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <StatusBadge status={proposal.status} />
              {proposal.quorumReached && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                  Quorum reached
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold">{proposal.title}</h1>
            <p className="text-sm text-gray-500 mt-1">
              by {proposal.creator?.name ?? 'Unknown'} &middot;{' '}
              {isActive
                ? `Voting ends ${new Date(proposal.votingEndsAt).toLocaleDateString()}`
                : `Closed ${new Date(proposal.votingEndsAt).toLocaleDateString()}`}
            </p>
          </div>
          {isActive && (isCreator || isAdmin) && (
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? 'Cancelling...' : 'Cancel'}
            </Button>
          )}
        </div>

        {/* Description */}
        <Card>
          <CardContent className="pt-5">
            <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">
              {proposal.description}
            </pre>
          </CardContent>
        </Card>

        {/* Vote tally */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vote Tally</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-4 bg-red-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${forPct}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-700">{forPct}%</div>
                <div className="text-green-600 text-xs">
                  For ({Number(proposal.forVotes).toFixed(0)} CBT)
                </div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{againstPct}%</div>
                <div className="text-red-500 text-xs">
                  Against ({Number(proposal.againstVotes).toFixed(0)} CBT)
                </div>
              </div>
            </div>
            <div className="text-xs text-gray-400 text-center">
              {proposal.voteCount} vote{proposal.voteCount !== 1 ? 's' : ''} cast
              {proposal.blockchainTxHash && (
                <>
                  {' '}
                  &middot;{' '}
                  <span className="font-mono">{proposal.blockchainTxHash.slice(0, 10)}...</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Vote actions */}
        {isActive && !votingEnded && !hasVoted && (
          <Card>
            <CardContent className="pt-5 pb-5">
              <h3 className="font-semibold mb-3">Cast Your Vote</h3>
              <p className="text-sm text-gray-500 mb-4">
                Your voting weight is your current CBT balance.
              </p>
              <div className="flex gap-3">
                <Button
                  onClick={() => handleVote(true)}
                  disabled={voting}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  {voting ? 'Submitting...' : 'Vote For'}
                </Button>
                <Button
                  onClick={() => handleVote(false)}
                  disabled={voting}
                  variant="outline"
                  className="flex-1 text-red-600 border-red-300 hover:bg-red-50"
                >
                  {voting ? 'Submitting...' : 'Vote Against'}
                </Button>
              </div>
              {voteError && <p className="text-sm text-red-600 mt-2">{voteError}</p>}
            </CardContent>
          </Card>
        )}

        {isActive && !votingEnded && hasVoted && (
          <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700">
            Your vote has been recorded.
          </div>
        )}

        {/* Vote list */}
        {proposal.votes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Votes ({proposal.votes.length})</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {proposal.votes.map((v) => (
                <div key={v.id} className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${v.support ? 'bg-green-500' : 'bg-red-400'}`}
                    />
                    <span className="text-sm">
                      {v.voter?.name ?? v.voterId.slice(0, 8) + '...'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{Number(v.weight).toFixed(0)} CBT</span>
                    <span
                      className={
                        v.support ? 'text-green-600 font-medium' : 'text-red-500 font-medium'
                      }
                    >
                      {v.support ? 'For' : 'Against'}
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
