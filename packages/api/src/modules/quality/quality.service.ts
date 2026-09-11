import { eq, desc } from 'drizzle-orm';
import { db, qualityReports, materialPassports, type QualityReport } from '@trace/db';
import { type CreateQualityReportInput, NotFoundError, ForbiddenError } from '@trace/core';
import { reanchorPassport } from '../../lib/anchor.js';

// ─── Submit quality report ────────────────────────────────────────────────────

export async function createQualityReport(
  input: CreateQualityReportInput,
  inspectorId: string,
): Promise<QualityReport> {
  // Verify passport exists
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, input.passportId),
  });

  if (!passport) throw new NotFoundError(`Passport ${input.passportId} not found`);

  const [report] = await db
    .insert(qualityReports)
    .values({
      passportId: input.passportId,
      inspectorId,
      structuralScore: input.structuralScore ?? null,
      aestheticScore: input.aestheticScore ?? null,
      environmentalScore: input.environmentalScore ?? null,
      overallGrade: input.overallGrade ?? null,
      reportNotes: input.reportNotes ?? null,
      photoUrls: input.photoUrls,
    })
    .returning();

  if (!report) throw new Error('Failed to create quality report');

  // Update passport condition grade if a grade was provided.
  //
  // `conditionGrade` is part of the canonical fingerprint document, so changing
  // it invalidates the stored hash. Without a re-anchor the public
  // /verify-integrity endpoint reports "Mismatch" on a passport nobody
  // tampered with — filing an inspection during a demo used to break that
  // product's trust moment permanently. Re-anchor, exactly as updatePassport
  // does, so the fingerprint reflects the newly graded material.
  if (input.overallGrade && input.overallGrade !== passport.conditionGrade) {
    const [updated] = await db
      .update(materialPassports)
      .set({ conditionGrade: input.overallGrade, updatedAt: new Date() })
      .where(eq(materialPassports.id, input.passportId))
      .returning();

    if (updated) await reanchorPassport(updated);
  }

  return report;
}

// ─── Get reports for a passport ───────────────────────────────────────────────

export interface QualityReportWithInspector extends QualityReport {
  inspector: { id: string; name: string; email: string } | null;
}

export async function getReportsByPassport(
  passportId: string,
): Promise<QualityReportWithInspector[]> {
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });

  if (!passport) throw new NotFoundError(`Passport ${passportId} not found`);

  const reports = await db.query.qualityReports.findMany({
    where: eq(qualityReports.passportId, passportId),
    orderBy: [desc(qualityReports.createdAt)],
    with: { inspector: true },
  });

  return reports.map((r) => ({
    ...r,
    inspector: r.inspector
      ? { id: r.inspector.id, name: r.inspector.name, email: r.inspector.email }
      : null,
  }));
}

// ─── Get report by id ─────────────────────────────────────────────────────────

export async function getReportById(id: string): Promise<QualityReportWithInspector> {
  const report = await db.query.qualityReports.findFirst({
    where: eq(qualityReports.id, id),
    with: { inspector: true },
  });

  if (!report) throw new NotFoundError(`Quality report ${id} not found`);

  return {
    ...report,
    inspector: report.inspector
      ? { id: report.inspector.id, name: report.inspector.name, email: report.inspector.email }
      : null,
  };
}

// ─── List reports submitted by an inspector ───────────────────────────────────

export async function listInspectorReports(inspectorId: string): Promise<QualityReport[]> {
  return db.query.qualityReports.findMany({
    where: eq(qualityReports.inspectorId, inspectorId),
    orderBy: [desc(qualityReports.createdAt)],
  });
}

// ─── Flag a report as disputed ────────────────────────────────────────────────

export async function disputeReport(reportId: string): Promise<QualityReport> {
  const report = await db.query.qualityReports.findFirst({
    where: eq(qualityReports.id, reportId),
  });

  if (!report) throw new NotFoundError(`Quality report ${reportId} not found`);
  if (report.disputed) throw new ForbiddenError('Report is already disputed');

  const [updated] = await db
    .update(qualityReports)
    .set({ disputed: true })
    .where(eq(qualityReports.id, reportId))
    .returning();

  if (!updated) throw new Error('Failed to update report');
  return updated;
}
