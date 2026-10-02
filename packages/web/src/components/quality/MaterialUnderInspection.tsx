'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { INSPECTION_SOURCE_LABELS } from '@trace/core';
import { Button } from '@/components/ui/button';
import { quality, type InspectionMaterial, type QualityReportSummary } from '@/lib/api-client';
import { categoryLabel } from '@/lib/categories';
import { formatDate } from '@/lib/format';
import { reportedBy } from '@/lib/inspection';
import { ListingPhoto } from '@/components/marketplace/ListingPhoto';
import { inspectionStatus } from './MaterialPicker';

// A material's status in plain words.
const STATUS_LABELS: Record<string, string> = {
  active: 'Registered, not on sale',
  listed: 'On sale',
  reserved: 'On sale, fully ordered',
  sold: 'Sold',
  installed: 'Installed',
  decommissioned: 'Decommissioned',
};

function dimensionsLine(d: InspectionMaterial['dimensions']): string | null {
  if (!d) return null;
  const size = [d.length, d.width, d.height].filter((n) => n !== undefined && n !== null);
  const parts = [
    size.length ? `${size.join(' × ')} ${d.unit ?? ''}`.trim() : null,
    d.weight ? `${d.weight} ${d.weightUnit ?? 'kg'}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The material a report is being written about, kept in view while the
 * inspector scores it: what it is, who holds it, its current grade, and what
 * earlier reports said.
 */
export function MaterialUnderInspection({
  material,
  onChange,
}: {
  material: InspectionMaterial;
  onChange: () => void;
}) {
  const [reports, setReports] = useState<QualityReportSummary[] | null>(null);

  useEffect(() => {
    setReports(null);
    quality
      .getForPassport(material.id)
      .then(setReports)
      .catch(() => setReports([]));
  }, [material.id]);

  const rows: Array<[string, string | null]> = [
    ['Category', categoryLabel(material.categoryL1, material.categoryL2)],
    ['Held by', material.organisationName],
    ['Serial number', material.serialNumber],
    ['Size', dimensionsLine(material.dimensions)],
    ['Current grade', material.conditionGrade ? `Grade ${material.conditionGrade}` : 'None yet'],
    ['Status', STATUS_LABELS[material.status] ?? material.status],
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-lg border bg-gray-50">
          <ListingPhoto src={material.photo} alt={material.productName} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{material.productName}</p>
          <p
            className={`text-sm ${material.lastIndependentInspectionAt ? 'text-gray-500' : 'text-amber-700'}`}
          >
            {inspectionStatus(material)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={`/passport/${material.id}`} target="_blank">
              <Button type="button" size="sm" variant="outline">
                Open public passport ↗
              </Button>
            </Link>
            <Button type="button" size="sm" variant="ghost" onClick={onChange}>
              Choose a different material
            </Button>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-gray-500">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      {material.conditionNotes && (
        <div className="text-sm">
          <p className="text-gray-500">Condition notes from the holder</p>
          <p>{material.conditionNotes}</p>
        </div>
      )}

      <div className="text-sm">
        <p className="text-gray-500">Earlier reports</p>
        {reports === null && <p className="text-gray-400">Loading…</p>}
        {reports?.length === 0 && <p>None. This will be the first.</p>}
        {reports && reports.length > 0 && (
          <ul className="mt-1 space-y-1">
            {reports.map((r) => (
              <li key={r.id}>
                {formatDate(r.createdAt)} · {INSPECTION_SOURCE_LABELS[r.source]}
                {r.overallGrade ? ` · Grade ${r.overallGrade}` : ''} · {reportedBy(r)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
