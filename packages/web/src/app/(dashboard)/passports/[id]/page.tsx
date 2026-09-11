'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  passports,
  quality,
  type PassportDetail,
  type QualityReportSummary,
} from '@/lib/api-client';
import { unitLabel } from '@trace/core';
import { getToken, isHubStaff, isSupplier, getUser } from '@/lib/auth';
import { categoryLabel } from '@/lib/categories';
import { getErrorMessage } from '@/lib/api-errors';
import { toast } from '@/components/ui/use-toast';
import CertificatePanel from '@/components/passport/CertificatePanel';

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-red-100 text-red-800',
};

export default function PassportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [passport, setPassport] = useState<PassportDetail | null>(null);
  const [qualityReports, setQualityReports] = useState<QualityReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const user = getUser();
  const canEdit = isHubStaff(user) || isSupplier(user);

  useEffect(() => {
    const token = getToken();
    Promise.all([passports.get(id, token ?? undefined), quality.getForPassport(id).catch(() => [])])
      .then(([p, qr]) => {
        setPassport(p);
        setQualityReports(qr as QualityReportSummary[]);
      })
      .catch((e: unknown) => setError(getErrorMessage(e, 'load this passport')))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400">Loading…</div>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !passport) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <p className="text-gray-500">{error ?? 'Passport not found'}</p>
          <Button variant="outline" className="mt-4" onClick={() => router.back()}>
            Go back
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const anchored = !!passport.blockchainTxHash;

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = getToken();
    if (!token) return;
    setUploading(true);
    setUploadError(null);
    try {
      const updated = await passports.uploadPhoto(id, file, token);
      setPassport(updated);
      toast({ title: 'Photo added', variant: 'success' });
    } catch (err) {
      setUploadError(getErrorMessage(err, 'upload this photo'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{passport.productName}</h1>
            <p className="text-gray-500 text-sm mt-1">
              {categoryLabel(passport.categoryL1, passport.categoryL2)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={anchored ? 'success' : 'outline'}>
              {anchored ? 'Anchored ✓' : 'Pending anchor'}
            </Badge>
            {canEdit && (passport.status === 'draft' || passport.status === 'active') && (
              <Link href={`/passports/${id}/edit`}>
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              </Link>
            )}
            {passport.status === 'active' && (
              <Link href={`/listings/new?passportId=${id}`}>
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700">
                  List for sale
                </Button>
              </Link>
            )}
            {passport.status === 'listed' && (
              <Link href="/listings">
                <Button variant="outline" size="sm">
                  View listing
                </Button>
              </Link>
            )}
            <Link href={`/passport/${id}`} target="_blank">
              <Button variant="outline" size="sm">
                Public view ↗
              </Button>
            </Link>
          </div>
        </div>

        {/* QR code */}
        {passport.qrCodeUrl && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">QR Code</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-6">
              <img
                src={passport.qrCodeUrl}
                alt="Passport QR code"
                className="w-32 h-32 border rounded-lg"
              />
              <div className="text-sm text-gray-500">
                <p>Scan to view the public passport page.</p>
                <a
                  href={passport.qrCodeUrl}
                  download={`passport-${passport.id}.png`}
                  className="text-brand-600 hover:underline mt-1 block"
                >
                  Download QR
                </a>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Condition photos */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Condition photos</CardTitle>
              {canEdit && (
                <div className="flex items-center gap-2">
                  {uploadError && <span className="text-xs text-red-500">{uploadError}</span>}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    className="hidden"
                    onChange={handlePhotoUpload}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? 'Uploading…' : '+ Add photo'}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {passport.conditionPhotos.length === 0 ? (
              <p className="text-sm text-gray-500">No photos uploaded yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {passport.conditionPhotos.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt={`Condition photo ${i + 1}`}
                      className="w-full h-28 object-cover rounded-lg border hover:opacity-90 transition-opacity"
                    />
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <CertificatePanel passportId={passport.id} />

        {/* Passport data */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Material data</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="text-sm divide-y">
              {[
                ['Status', passport.status],
                ['Condition grade', passport.conditionGrade ?? '—'],
                ['Condition notes', passport.conditionNotes ?? '—'],
                ['Manufacturer', passport.manufacturerName ?? '—'],
                ['Country of origin', passport.countryOfOrigin ?? '—'],
                ['Deconstruction method', passport.deconstructionMethod ?? '—'],
                ['Reclaimed by', passport.reclaimedBy ?? '—'],
                [
                  'Remaining life',
                  passport.remainingLifeEstimate ? `${passport.remainingLifeEstimate} years` : '—',
                ],
                [
                  'Sold / measured per',
                  passport.unitOfMeasure ? unitLabel(passport.unitOfMeasure) : '—',
                ],
                [
                  'Embodied carbon',
                  passport.embodiedCarbon
                    ? `${passport.embodiedCarbon} kgCO₂e${passport.unitOfMeasure ? ` per ${unitLabel(passport.unitOfMeasure)}` : ''}`
                    : '—',
                ],
                [
                  'Carbon savings vs new',
                  passport.carbonSavingsVsNew
                    ? `${passport.carbonSavingsVsNew} kgCO₂e${passport.unitOfMeasure ? ` per ${unitLabel(passport.unitOfMeasure)}` : ''}`
                    : '—',
                ],
                [
                  'GWP total',
                  passport.gwpTotal
                    ? `${passport.gwpTotal} kgCO₂e${passport.unitOfMeasure ? ` per ${unitLabel(passport.unitOfMeasure)}` : ''}`
                    : '—',
                ],
                [
                  'Recycled content',
                  passport.recycledContent ? `${passport.recycledContent}%` : '—',
                ],
                ['CE marking', passport.ceMarking ? 'Yes' : 'No'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-2">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {/* Quality reports */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Quality inspections</CardTitle>
              <Link href={`/quality/new?passportId=${id}`}>
                <button className="text-xs text-brand-600 hover:underline">+ Add inspection</button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {qualityReports.length === 0 ? (
              <p className="text-sm text-gray-500">No inspections submitted yet.</p>
            ) : (
              <div className="space-y-4">
                {qualityReports.map((r) => (
                  <div key={r.id} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-3">
                      {r.overallGrade && (
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded text-sm font-bold ${GRADE_COLORS[r.overallGrade] ?? 'bg-gray-100'}`}
                        >
                          Grade {r.overallGrade}
                        </span>
                      )}
                      {r.disputed && (
                        <Badge variant="destructive" className="text-xs">
                          Disputed
                        </Badge>
                      )}
                      {r.blockchainTxHash && (
                        <span className="text-xs text-green-600 font-medium">✓ Anchored</span>
                      )}
                      <span className="text-xs text-gray-400 ml-auto">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    {(r.structuralScore != null ||
                      r.aestheticScore != null ||
                      r.environmentalScore != null) && (
                      <div className="flex gap-4 text-xs text-gray-600">
                        {r.structuralScore != null && (
                          <span>
                            Structural: <strong>{r.structuralScore}/10</strong>
                          </span>
                        )}
                        {r.aestheticScore != null && (
                          <span>
                            Aesthetic: <strong>{r.aestheticScore}/10</strong>
                          </span>
                        )}
                        {r.environmentalScore != null && (
                          <span>
                            Environmental: <strong>{r.environmentalScore}/10</strong>
                          </span>
                        )}
                      </div>
                    )}

                    {r.reportNotes && <p className="text-sm text-gray-600">{r.reportNotes}</p>}

                    {r.inspector && (
                      <p className="text-xs text-gray-400">Inspector: {r.inspector.name}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
