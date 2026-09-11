import {
  passports,
  ApiError,
  type PassportCertificate,
  type PassportDetail,
} from '@/lib/api-client';
import { unitLabel } from '@trace/core';
import { categoryPath } from '@/lib/categories';
import { Leaf, Clock, Recycle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/ui/Logo';
import CertificatePanel from '@/components/passport/CertificatePanel';
import ProvenanceTimeline, { type AmendmentEntry } from '@/components/passport/ProvenanceTimeline';
import Link from 'next/link';

interface Props {
  params: Promise<{ id: string }>;
}

// D-07: only a genuine 404 means the passport does not exist. Every other
// failure — API down, network error, 500 — means we could not check. Telling a
// visitor a material passport "does not exist or has been removed" because our
// own API was unreachable is a false statement about someone else's material,
// and it is the first thing a prospect sees when scanning a QR code.
type PassportLoad =
  | { kind: 'ok'; passport: PassportDetail }
  | { kind: 'not-found' }
  | { kind: 'unavailable' };

async function getPassport(id: string): Promise<PassportLoad> {
  try {
    return { kind: 'ok', passport: await passports.verify(id) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { kind: 'not-found' };
    return { kind: 'unavailable' };
  }
}

async function getCertificate(id: string): Promise<PassportCertificate | null> {
  try {
    return await passports.certificate(id);
  } catch {
    return null;
  }
}

// Append-only amendments, oldest-first, for the provenance timeline.
async function getAmendments(id: string): Promise<AmendmentEntry[]> {
  try {
    const events = (await passports.history(id)) as Array<{
      eventData?: { amendment?: boolean };
      createdAt?: string;
    }>;
    return events
      .filter((e) => e.eventData?.amendment === true)
      .map((e) => ({ date: e.createdAt ?? null }))
      .reverse(); // history comes newest-first; the timeline reads oldest-first
  } catch {
    return [];
  }
}

export default async function PublicPassportPage({ params }: Props) {
  const { id } = await params;
  const [loaded, certificate, amendments] = await Promise.all([
    getPassport(id),
    getCertificate(id),
    getAmendments(id),
  ]);

  if (loaded.kind !== 'ok') {
    const notFound = loaded.kind === 'not-found';
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-4xl mb-4">{notFound ? '🔍' : '⏳'}</div>
          <h1 className="text-xl font-semibold mb-2">
            {notFound ? 'Passport not found' : 'Couldn’t load this passport'}
          </h1>
          <p className="text-gray-500 text-sm max-w-sm">
            {notFound
              ? 'This material passport does not exist or has been removed.'
              : 'We couldn’t reach the verification service just now. This doesn’t mean anything is wrong with the passport — please try again in a moment.'}
          </p>
          <Link href="/" className="text-brand-600 hover:underline text-sm mt-4 block">
            ← Back to TRACE
          </Link>
        </div>
      </div>
    );
  }

  const passport = loaded.passport;

  // D-07: when only the certificate call fails, fall back to the same
  // simulated convention the API uses (anchoredAt set + txHash null), rather
  // than collapsing straight to 'pending'. Without this a perfectly healthy
  // simulated passport renders "Pending verification" — the one state the
  // demo run sheet explicitly flags as "Not normal" — purely because a
  // secondary request failed.
  const trustStatus =
    certificate?.status ??
    (passport.blockchainTxHash
      ? 'verified'
      : passport.blockchainAnchoredAt
        ? 'simulated'
        : 'pending');
  const trust =
    trustStatus === 'verified'
      ? { variant: 'success' as const, label: 'Blockchain verified' }
      : trustStatus === 'simulated'
        ? { variant: 'success' as const, label: 'Trust layer prepared' }
        : trustStatus === 'failed'
          ? { variant: 'destructive' as const, label: 'Verification failed' }
          : { variant: 'warning' as const, label: 'Pending verification' };
  const conditionLabel =
    passport.conditionGrade === 'A'
      ? 'Excellent'
      : passport.conditionGrade === 'B'
        ? 'Good'
        : passport.conditionGrade === 'C'
          ? 'Fair'
          : passport.conditionGrade === 'D'
            ? 'Poor'
            : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center" aria-label="TRACE home">
            <Logo className="h-7" />
          </Link>
          <Badge variant={trust.variant}>{trust.label}</Badge>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Hero */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm text-gray-500 mb-1">
                {categoryPath(passport.categoryL1, passport.categoryL2)}
              </div>
              <h1 className="text-2xl font-bold">{passport.productName}</h1>
              {passport.conditionGrade && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-brand-100 text-brand-700 font-bold text-sm">
                    {passport.conditionGrade}
                  </span>
                  <span className="text-sm text-gray-600">
                    Grade {passport.conditionGrade} — {conditionLabel}
                  </span>
                </div>
              )}
            </div>

            {passport.conditionPhotos?.[0] ? (
              <img
                src={passport.conditionPhotos[0]}
                alt={passport.productName}
                className="w-28 h-28 rounded-lg border object-cover"
              />
            ) : passport.qrCodeUrl ? (
              <img
                src={passport.qrCodeUrl}
                alt="QR code"
                className="w-24 h-24 rounded-lg border object-contain p-1"
              />
            ) : null}
          </div>

          {passport.conditionNotes && (
            <p className="mt-4 text-sm text-gray-600 border-t pt-4">{passport.conditionNotes}</p>
          )}
        </div>

        {/* Impact stat tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {passport.carbonSavingsVsNew && (
            <div className="rounded-xl border bg-green-50 p-4">
              <Leaf className="h-5 w-5 text-green-600" />
              <p className="mt-2 text-2xl font-bold text-green-700">
                {passport.carbonSavingsVsNew}
              </p>
              <p className="text-xs text-gray-500">
                kgCO₂e saved vs new
                {passport.unitOfMeasure ? ` · per ${unitLabel(passport.unitOfMeasure)}` : ''}
              </p>
            </div>
          )}
          {passport.conditionGrade && (
            <div className="rounded-xl border p-4">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold text-sm">
                {passport.conditionGrade}
              </span>
              <p className="mt-2 text-2xl font-bold">{conditionLabel ?? '—'}</p>
              <p className="text-xs text-gray-500">Condition grade {passport.conditionGrade}</p>
            </div>
          )}
          {passport.remainingLifeEstimate != null && (
            <div className="rounded-xl border p-4">
              <Clock className="h-5 w-5 text-gray-500" />
              <p className="mt-2 text-2xl font-bold">
                ~{passport.remainingLifeEstimate}
                <span className="text-base font-medium text-gray-500"> yrs</span>
              </p>
              <p className="text-xs text-gray-500">Estimated remaining life</p>
            </div>
          )}
          {passport.recycledContent && (
            <div className="rounded-xl border p-4">
              <Recycle className="h-5 w-5 text-gray-500" />
              <p className="mt-2 text-2xl font-bold">{passport.recycledContent}%</p>
              <p className="text-xs text-gray-500">Recycled content</p>
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <CertificatePanel passportId={passport.id} initialCertificate={certificate} />
          <ProvenanceTimeline passport={passport} amendments={amendments} />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Product info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Product information</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="text-sm space-y-2">
                {[
                  ['Manufacturer', passport.manufacturerName],
                  ['Country of origin', passport.countryOfOrigin],
                  ['Serial number', passport.serialNumber],
                  ['GTIN', passport.gtin],
                  [
                    'Production date',
                    passport.productionDate
                      ? new Date(passport.productionDate).toLocaleDateString()
                      : null,
                  ],
                  ['CE marking', passport.ceMarking ? 'Yes' : null],
                ]
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <dt className="text-gray-500">{label}</dt>
                      <dd className="font-medium">{value}</dd>
                    </div>
                  ))}
              </dl>
            </CardContent>
          </Card>

          {/* Circular economy data */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Circular economy</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="text-sm space-y-2">
                {[
                  ['Deconstruction method', passport.deconstructionMethod],
                  [
                    'Deconstruction date',
                    passport.deconstructionDate
                      ? new Date(passport.deconstructionDate).toLocaleDateString()
                      : null,
                  ],
                  ['Reclaimed by', passport.reclaimedBy],
                  ['Previous building', passport.previousBuildingId],
                  [
                    'Remaining life',
                    passport.remainingLifeEstimate
                      ? `~${passport.remainingLifeEstimate} years`
                      : null,
                  ],
                  ['Handling requirements', passport.handlingRequirements],
                ]
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <dt className="text-gray-500">{label}</dt>
                      <dd className="font-medium">{value}</dd>
                    </div>
                  ))}
                {!passport.deconstructionMethod && !passport.reclaimedBy && (
                  <p className="text-gray-400 text-xs">No circular data recorded</p>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Environmental */}
          {(passport.gwpTotal ||
            passport.embodiedCarbon ||
            passport.carbonSavingsVsNew ||
            passport.recycledContent) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Environmental performance</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="text-sm space-y-2">
                  {[
                    [
                      'Sold / measured per',
                      passport.unitOfMeasure ? unitLabel(passport.unitOfMeasure) : null,
                    ],
                    [
                      'GWP total',
                      passport.gwpTotal
                        ? `${passport.gwpTotal} kgCO₂e${passport.unitOfMeasure ? ` per ${unitLabel(passport.unitOfMeasure)}` : ''}`
                        : null,
                    ],
                    [
                      'Embodied carbon',
                      passport.embodiedCarbon
                        ? `${passport.embodiedCarbon} kgCO₂e${passport.unitOfMeasure ? ` per ${unitLabel(passport.unitOfMeasure)}` : ''}`
                        : null,
                    ],
                    [
                      'Carbon savings vs new',
                      passport.carbonSavingsVsNew
                        ? `${passport.carbonSavingsVsNew} kgCO₂e${passport.unitOfMeasure ? ` per ${unitLabel(passport.unitOfMeasure)}` : ''}`
                        : null,
                    ],
                    [
                      'Recycled content',
                      passport.recycledContent ? `${passport.recycledContent}%` : null,
                    ],
                    ['EPD reference', passport.epdReference],
                  ]
                    .filter(([, v]) => v)
                    .map(([label, value]) => (
                      <div key={label} className="flex justify-between">
                        <dt className="text-gray-500">{label}</dt>
                        <dd className="font-medium">{value}</dd>
                      </div>
                    ))}
                </dl>
              </CardContent>
            </Card>
          )}

          {/* Hazardous substances */}
          {passport.hazardousSubstances?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-orange-700">⚠ Hazardous substances</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-2">
                  {passport.hazardousSubstances.map((h, i) => (
                    <li key={i} className="border rounded-md px-3 py-2">
                      <p className="font-medium">{h.name}</p>
                      {h.casNumber && <p className="text-gray-500 text-xs">CAS: {h.casNumber}</p>}
                      {h.hazardClass && (
                        <p className="text-gray-500 text-xs">Class: {h.hazardClass}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 pt-4 pb-8">
          Passport ID: {passport.id}
          {' · '}
          Registered {new Date(passport.createdAt).toLocaleDateString()}
          {' · '}
          <Link href="https://trace.construction" className="hover:underline">
            TRACE Platform
          </Link>
        </div>
      </main>
    </div>
  );
}
