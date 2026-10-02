import { ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { QualityReportSummary } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { latestIndependent, reportedBy } from '@/lib/inspection';

/**
 * What a buyer most needs to know about quality: has anyone independent of
 * the seller inspected this material, and what did they find? The seller's
 * own checks are listed below it, labelled as such, never as an inspection.
 */
export function InspectionCard({
  reports,
  organisationName,
}: {
  reports: QualityReportSummary[];
  organisationName: string | null;
}) {
  const inspection = latestIndependent(reports);
  const seller = organisationName ?? 'the seller';
  const scores: Array<[string, number | null]> = inspection
    ? [
        ['Structural', inspection.structuralScore],
        ['Aesthetic', inspection.aestheticScore],
        ['Environmental', inspection.environmentalScore],
      ]
    : [];
  const others = reports.filter((r) => r.id !== inspection?.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {inspection ? (
            <ShieldCheck className="h-5 w-5 text-brand-600" aria-hidden />
          ) : (
            <ShieldQuestion className="h-5 w-5 text-gray-400" aria-hidden />
          )}
          Independent inspection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {inspection ? (
          <>
            <p>
              Inspected on <strong>{formatDate(inspection.createdAt)}</strong> by{' '}
              {reportedBy(inspection)}
              {inspection.overallGrade ? (
                <>
                  , who graded it <strong>Grade {inspection.overallGrade}</strong>
                </>
              ) : null}
              .
            </p>
            {scores.some(([, score]) => score != null) && (
              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-gray-600">
                {scores
                  .filter(([, score]) => score != null)
                  .map(([label, score]) => (
                    <div key={label} className="flex gap-1.5">
                      <dt>{label}</dt>
                      <dd className="font-semibold text-gray-900">{score}/10</dd>
                    </div>
                  ))}
              </dl>
            )}
            {inspection.reportNotes && (
              <p className="rounded-md bg-gray-50 p-3 text-gray-700">{inspection.reportNotes}</p>
            )}
          </>
        ) : (
          <p className="text-gray-600">
            Not yet independently inspected. The condition and other details on this passport are as
            declared by {seller}.
          </p>
        )}

        {others.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-gray-500">Other checks on record</p>
            <ul className="mt-1 space-y-1 text-gray-700">
              {others.map((r) => (
                <li key={r.id}>
                  {formatDate(r.createdAt)} ·{' '}
                  {r.source === 'independent'
                    ? 'Earlier independent inspection'
                    : r.source === 'seller'
                      ? "Seller's own check"
                      : 'Checked by the platform operator'}
                  {r.overallGrade ? ` · Grade ${r.overallGrade}` : ''} · {reportedBy(r)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
