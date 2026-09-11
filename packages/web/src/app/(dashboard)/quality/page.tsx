'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NoAccess } from '@/components/ui/load-state';
import { quality, type QualityReportSummary } from '@/lib/api-client';
import { getToken, getUser, canViewQuality, type StoredUser } from '@/lib/auth';
import { getErrorMessage } from '@/lib/api-errors';

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-red-100 text-red-800',
};

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-gray-400">—</span>;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${GRADE_COLORS[grade] ?? 'bg-gray-100 text-gray-700'}`}
    >
      {grade}
    </span>
  );
}

export default function QualityReportsPage() {
  const router = useRouter();
  // J-12: this page had no role guard — a buyer landed on
  // "Role 'buyer' is not permitted. Required: inspector, hub_admin,
  // platform_admin" rendered raw into the red error box (also J-10).
  // Effect-based user read to avoid a hydration mismatch.
  const [user, setUser] = useState<StoredUser | null>(null);
  const [reports, setReports] = useState<QualityReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
  }, [router]);

  useEffect(() => {
    if (!user) return;
    if (!canViewQuality(user)) {
      setLoading(false);
      return;
    }
    const token = getToken();
    if (!token) return;
    quality
      .myReports(token)
      .then(setReports)
      .catch((e) => setError(getErrorMessage(e, 'load your quality reports')))
      .finally(() => setLoading(false));
  }, [user]);

  if (user && !canViewQuality(user)) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <h1 className="text-2xl font-bold">Quality Reports</h1>
          <NoAccess message="Quality reports are for inspectors and hub admins." />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Quality Reports</h1>
            <p className="text-gray-500 text-sm mt-1">Your inspection history</p>
          </div>
          <Link href="/quality/new">
            <Button className="bg-brand-600 hover:bg-brand-700">+ New report</Button>
          </Link>
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

        {!loading && !error && reports.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-gray-500 mb-4">No reports submitted yet.</p>
              <Link href="/quality/new">
                <Button variant="outline">Submit your first inspection</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {reports.length > 0 && (
          <div className="space-y-4">
            {reports.map((report) => (
              <Card key={report.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <GradeBadge grade={report.overallGrade} />
                        {report.disputed && (
                          <Badge variant="destructive" className="text-xs">
                            Disputed
                          </Badge>
                        )}
                        {report.blockchainTxHash && (
                          <span className="text-xs text-green-600">✓ On-chain</span>
                        )}
                      </div>

                      <Link
                        href={`/passports/${report.passportId}`}
                        className="text-sm text-brand-600 hover:underline mt-1 block font-mono"
                      >
                        Passport: {report.passportId.slice(0, 8)}…
                      </Link>

                      {report.reportNotes && (
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {report.reportNotes}
                        </p>
                      )}

                      <div className="flex gap-4 mt-2 text-xs text-gray-500">
                        {report.structuralScore != null && (
                          <span>
                            Structural: <strong>{report.structuralScore}/10</strong>
                          </span>
                        )}
                        {report.aestheticScore != null && (
                          <span>
                            Aesthetic: <strong>{report.aestheticScore}/10</strong>
                          </span>
                        )}
                        {report.environmentalScore != null && (
                          <span>
                            Environmental: <strong>{report.environmentalScore}/10</strong>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-gray-400 shrink-0 text-right">
                      {new Date(report.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
