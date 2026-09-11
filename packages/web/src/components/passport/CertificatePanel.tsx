'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Fingerprint,
  Loader2,
  Copy,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { passports, type PassportCertificate } from '@/lib/api-client';

function shortHash(value: string | null) {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function explorerHref(txHash: string) {
  const base = process.env.NEXT_PUBLIC_VECHAIN_EXPLORER_URL?.trim().replace(/\/$/, '');
  return base ? `${base}/transactions/${txHash}` : `/explorer/tx/${txHash}`;
}

function statusBadge(status: PassportCertificate['status']) {
  if (status === 'verified') return <Badge variant="success">Blockchain verified</Badge>;
  if (status === 'simulated') return <Badge variant="success">Trust layer prepared</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Verification failed</Badge>;
  return <Badge variant="warning">Pending verification</Badge>;
}

// D-07: `error` is deliberately a distinct phase rather than `done` with
// match:false. A failed request means we do not know whether the data
// matches — collapsing that into the mismatch branch made the panel accuse
// the platform of tampering whenever the API was merely unreachable.
type IntegrityState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'error' }
  | { phase: 'done'; match: boolean };

export default function CertificatePanel({
  passportId,
  initialCertificate,
  pollPending = true,
}: {
  passportId: string;
  initialCertificate?: PassportCertificate | null;
  pollPending?: boolean;
}) {
  const [certificate, setCertificate] = useState<PassportCertificate | null>(
    initialCertificate ?? null,
  );
  const [loading, setLoading] = useState(!initialCertificate);
  const [integrity, setIntegrity] = useState<IntegrityState>({ phase: 'idle' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await passports.certificate(passportId);
        if (!cancelled) setCertificate(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    if (!pollPending)
      return () => {
        cancelled = true;
      };
    const interval = window.setInterval(() => {
      if (
        certificate?.status === 'verified' ||
        certificate?.status === 'failed' ||
        certificate?.status === 'simulated'
      ) {
        window.clearInterval(interval);
        return;
      }
      load();
    }, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [passportId, pollPending, certificate?.status]);

  const rows = useMemo(() => {
    if (!certificate) return [];
    return [
      ['Tamper-evident fingerprint', certificate.certificateHash],
      ['Certificate ID', certificate.txHash],
      [
        'Registered on',
        certificate.registeredAt ? new Date(certificate.registeredAt).toLocaleString() : null,
      ],
      ['Verification block', certificate.blockNumber ? `#${certificate.blockNumber}` : null],
    ].filter(([, value]) => value) as Array<[string, string]>;
  }, [certificate]);

  async function runIntegrityCheck() {
    setIntegrity({ phase: 'checking' });
    try {
      // Min delay so the "recomputing" animation is visible (the check is instant server-side).
      const [res] = await Promise.all([
        passports.verifyIntegrity(passportId),
        new Promise((r) => setTimeout(r, 700)),
      ]);
      setIntegrity({ phase: 'done', match: res.match });
    } catch {
      // Not a mismatch — we simply could not reach the check. See D-07.
      setIntegrity({ phase: 'error' });
    }
  }

  function copyHash() {
    if (!certificate?.certificateHash) return;
    navigator.clipboard?.writeText(certificate.certificateHash);
    toast({ title: 'Fingerprint copied', variant: 'success' });
  }

  if (loading && !certificate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trust certificate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-20 rounded-md bg-gray-100 animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  const status = certificate?.status ?? 'pending';
  const sealed = status === 'verified' || status === 'simulated';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-base">Trust certificate</CardTitle>
        {statusBadge(status)}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Animated trust seal */}
        {sealed ? (
          <div className="flex flex-col items-center text-center py-2">
            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-green-400/40 motion-safe:animate-ring-pulse" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-700 motion-safe:animate-seal-pop">
                <ShieldCheck className="h-8 w-8" />
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold text-gray-900">
              {status === 'verified' ? 'Blockchain verified' : 'Trust layer prepared'}
            </p>
            <p className="text-xs text-gray-500 max-w-xs">
              {status === 'verified' ? (
                <>
                  Digital fingerprint registered on VeChainThor
                  {certificate?.hub ? (
                    <>
                      {' '}
                      by <span className="font-medium text-gray-700">{certificate.hub.name}</span>
                    </>
                  ) : null}
                  .
                  {/* D-07: `verified` with onchainVerified null means the node
                        could not be reached, so this is our stored record and
                        not a fresh on-chain confirmation. Say so rather than
                        implying the chain was just consulted. */}
                  {certificate?.onchainVerified === null
                    ? ' Shown from our records — the chain could not be reached to re-confirm just now.'
                    : null}
                </>
              ) : (
                'Tamper-evident fingerprint generated · VeChain anchoring simulated.'
              )}
            </p>
          </div>
        ) : status === 'pending' ? (
          <div className="flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            <Fingerprint className="h-4 w-4 animate-pulse" />
            Generating the tamper-evident fingerprint…
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" />
            {certificate?.failureReason ?? 'The latest verification attempt failed.'}
          </div>
        )}

        <dl className="text-sm space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-4">
              <dt className="text-gray-500 w-40 shrink-0">{label}</dt>
              <dd className="font-mono text-xs break-all text-gray-700">
                {label === 'Registered on' || label === 'Verification block'
                  ? value
                  : shortHash(value)}
              </dd>
            </div>
          ))}
        </dl>

        {/* Verify integrity — honest recompute-and-compare */}
        {certificate?.certificateHash && (
          <div className="rounded-lg border bg-gray-50/60 p-3">
            {integrity.phase === 'idle' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={runIntegrityCheck}
                className="gap-1.5"
              >
                <Fingerprint className="h-4 w-4" /> Verify integrity
              </Button>
            )}
            {integrity.phase === 'checking' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Loader2 className="h-4 w-4 animate-spin" /> Recomputing fingerprint…
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
                  <div className="h-full w-1/3 rounded-full bg-brand-500 motion-safe:animate-sweep" />
                </div>
              </div>
            )}
            {integrity.phase === 'error' && (
              <div className="space-y-2 motion-safe:animate-fade-in-up">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <AlertTriangle className="h-4 w-4" />
                  Couldn’t reach the verification service — this doesn’t indicate a problem with the
                  passport.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={runIntegrityCheck}
                  className="gap-1.5"
                >
                  <Fingerprint className="h-4 w-4" /> Try again
                </Button>
              </div>
            )}
            {integrity.phase === 'done' && (
              <div
                className={cn(
                  'flex items-center gap-2 text-sm font-medium motion-safe:animate-fade-in-up',
                  integrity.match ? 'text-green-700' : 'text-red-700',
                )}
              >
                {integrity.match ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                {integrity.match
                  ? 'Untampered — recomputed fingerprint matches the record.'
                  : 'Mismatch — this passport’s data no longer matches its fingerprint.'}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {certificate?.certificateHash && (
            <Button type="button" variant="ghost" size="sm" onClick={copyHash} className="gap-1.5">
              <Copy className="h-4 w-4" /> Copy fingerprint
            </Button>
          )}
          {certificate?.txHash && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={explorerHref(certificate.txHash)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> View on explorer
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
