'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { governance } from '@/lib/api-client';
import { getToken } from '@/lib/auth';

export default function NewProposalPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    if (title.trim().length < 5) {
      setError('Title must be at least 5 characters');
      return;
    }
    if (description.trim().length < 20) {
      setError('Description must be at least 20 characters');
      return;
    }

    setSubmitting(true);
    try {
      const proposal = await governance.create(
        { title: title.trim(), description: description.trim() },
        token,
      );
      router.push(`/governance/${proposal.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create proposal');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/governance" className="text-sm text-gray-500 hover:text-gray-700">
            Back to Governance
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-bold">New Proposal</h1>
          <p className="text-gray-500 text-sm mt-1">
            Proposals are open for 7 days of voting. Requires 10% quorum to pass.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Adjust quality report staking requirement to 50 CBT"
                  required
                />
                <p className="text-xs text-gray-400">5–200 characters</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe your proposal in detail. Include rationale, expected impact, and any relevant data or references."
                  rows={10}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
                />
                <p className="text-xs text-gray-400">Minimum 20 characters. Supports plain text.</p>
              </div>

              {error && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Submit Proposal'}
                </Button>
                <Link href="/governance">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-amber-800">
              <strong>Note:</strong> Your proposal will be anchored on VeChainThor as a
              tamper-evident hash. Voting weight is determined by CBT balance at vote time. The
              research policy targets a 100 CBT proposal threshold; enforcement must be completed
              before deployment.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
