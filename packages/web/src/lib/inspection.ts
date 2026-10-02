/**
 * What a material's quality reports mean to a buyer: who stands behind the
 * condition grade, and whether anyone independent has looked at the material.
 *
 * A report by an inspector is an independent inspection. A report by the
 * organisation selling the material is that seller's own check, and is never
 * presented as an inspection (owner decision, 2026-10-02).
 */
import { INSPECTOR_ROLE_LABELS, type InspectionSource } from '@trace/core';
import { formatDate } from './format';

export interface ReportForBuyer {
  overallGrade: string | null;
  createdAt: string;
  source: InspectionSource;
  inspector: { name: string; role: string } | null;
}

const byNewest = (a: ReportForBuyer, b: ReportForBuyer) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/** The most recent report by an inspector, if there is one. */
export function latestIndependent<T extends ReportForBuyer>(reports: T[]): T | null {
  return [...reports].sort(byNewest).find((r) => r.source === 'independent') ?? null;
}

/** "Jo Bloggs, independent quality auditor": who filed a report, for a buyer. */
export function reportedBy(report: ReportForBuyer): string {
  const role = INSPECTOR_ROLE_LABELS[report.source];
  return report.inspector ? `${report.inspector.name}, ${role}` : role;
}

/**
 * Where the grade on the passport comes from. The latest report that gave
 * the grade the passport shows set it; if no report did, the organisation
 * that registered the material declared it.
 */
export function gradeBasis(
  grade: string | null | undefined,
  reports: ReportForBuyer[],
  organisationName: string | null | undefined,
): string | null {
  if (!grade) return null;
  const setBy = [...reports].sort(byNewest).find((r) => r.overallGrade === grade);
  if (setBy?.source === 'independent') {
    return `Set by independent inspection on ${formatDate(setBy.createdAt)}`;
  }
  if (setBy?.source === 'platform') {
    return `Set by the platform operator on ${formatDate(setBy.createdAt)}`;
  }
  const declared = organisationName ? `Declared by ${organisationName}` : 'Declared by the seller';
  return latestIndependent(reports) ? declared : `${declared}; not yet independently inspected`;
}
