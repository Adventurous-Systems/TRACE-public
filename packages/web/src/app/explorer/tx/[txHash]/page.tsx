'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { blockchain, type BlockchainTransactionDetail } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/api-errors';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatMaybe(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function formatVtho(value: string | undefined) {
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

export default function MiniExplorerPage() {
  const params = useParams<{ txHash: string }>();
  const [detail, setDetail] = useState<BlockchainTransactionDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    blockchain
      .transaction(params.txHash)
      .then(setDetail)
      .catch((err: unknown) => setError(getErrorMessage(err, 'this transaction')));
  }, [params.txHash]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <Card className="max-w-lg w-full">
          <CardContent className="p-6 text-center space-y-3">
            <p className="font-semibold">Transaction unavailable</p>
            <p className="text-sm text-gray-500">{error}</p>
            <Link href="/marketplace" className="text-sm text-brand-600 hover:underline">
              Back to TRACE
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading transaction…</p>
      </div>
    );
  }

  const tx = detail.transaction as {
    origin?: string;
    clauses?: Array<{ to?: string; value?: string; data?: string }>;
  } | null;
  const receipt = detail.receipt;
  const decoded = detail.decoded ?? {};

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/marketplace" className="text-sm text-gray-600 hover:text-gray-900">
            TRACE Explorer
          </Link>
          <Badge
            variant={
              detail.status === 'confirmed'
                ? 'success'
                : detail.status === 'failed'
                  ? 'destructive'
                  : 'warning'
            }
          >
            {detail.status}
          </Badge>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">VeChainThor Transaction</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="text-sm space-y-3">
              {[
                ['ID', detail.id],
                ['From', tx?.origin],
                ['To', tx?.clauses?.[0]?.to],
                ['Gas used', receipt?.gasUsed],
                ['Gas payer', receipt?.gasPayer],
                ['VTHO paid', formatVtho(receipt?.paid)],
                ['Block', receipt?.meta?.blockNumber ? `#${receipt.meta.blockNumber}` : null],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-4">
                  <dt className="w-28 shrink-0 text-gray-500">{label}</dt>
                  <dd className="font-mono text-xs break-all">{formatMaybe(value)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {Object.keys(decoded).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recorded data</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="text-sm space-y-3">
                {Object.entries(decoded).map(([label, value]) => (
                  <div key={label} className="flex gap-4">
                    <dt className="w-32 shrink-0 text-gray-500">{label}</dt>
                    <dd className="font-mono text-xs break-all">{formatMaybe(value)}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
