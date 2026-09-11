'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { tokens, type CbtStats } from '@/lib/api-client';
import { getToken, getUser } from '@/lib/auth';

export default function TokensPage() {
  const router = useRouter();
  const [balance, setBalance] = useState<string | null>(null);
  const [stats, setStats] = useState<CbtStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      router.replace('/login');
      return;
    }

    Promise.all([
      tokens.myBalance(token).catch(() => ({ balance: '0', address: null })),
      tokens.stats().catch(() => null),
    ])
      .then(([balanceData, statsData]) => {
        setBalance(balanceData.balance);
        setStats(statsData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">CircularBuildToken</h1>
          <p className="text-gray-500 text-sm mt-1">
            CBT rewards your contributions to the circular economy commons
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-48">
            <div className="text-gray-400">Loading…</div>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Balance card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your Balance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-brand-700">{balance ?? '0'}</span>
                  <span className="text-lg text-gray-500">CBT</span>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  CircularBuildToken — utility token, not a payment currency
                </p>
              </CardContent>
            </Card>

            {/* Supply card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Network Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total supply</span>
                  <span className="font-medium">{stats?.totalSupply ?? '—'} CBT</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Token name</span>
                  <span className="font-medium">{stats?.name ?? 'CircularBuildToken'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Symbol</span>
                  <span className="font-medium">{stats?.symbol ?? 'CBT'}</span>
                </div>
              </CardContent>
            </Card>

            {/* How to earn */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">How to Earn CBT</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border p-4">
                    <div className="text-2xl font-bold text-brand-700">
                      {stats?.rewards.passportRegistration ?? '10'} CBT
                    </div>
                    <div className="text-sm font-medium mt-1">Register a material</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Awarded when a new material passport is anchored on-chain
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-2xl font-bold text-brand-700">
                      {stats?.rewards.qualityReport ?? '5'} CBT
                    </div>
                    <div className="text-sm font-medium mt-1">Submit a quality report</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Awarded to inspectors for each anchored assessment
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-2xl font-bold text-brand-700">
                      {stats?.rewards.marketplaceSale ?? '20'} CBT
                    </div>
                    <div className="text-sm font-medium mt-1">Complete a sale</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Awarded when a marketplace transaction completes successfully
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Staking info */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Quality Staking</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-gray-600 space-y-2">
                <p>
                  Stake CBT as a quality guarantee when listing materials. Staked tokens are locked
                  for 30 days and returned when the lock expires.
                </p>
                <p>
                  If a buyer dispute is upheld, staked tokens are{' '}
                  <strong>burned as a graduated sanction</strong> — aligning incentives for honest
                  condition reporting (Ostrom Principle 5).
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
