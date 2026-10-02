import { and, asc, eq, desc, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  db,
  qualityReports,
  materialPassports,
  organisations,
  type QualityReport,
} from '@trace/db';
import {
  type CreateQualityReportInput,
  type InspectionMaterialsQuery,
  type InspectionSource,
  inspectionSource,
  NotFoundError,
  ForbiddenError,
} from '@trace/core';
import { reanchorPassport } from '../../lib/anchor.js';

// ─── What the public may know about a report ─────────────────────────────────

/**
 * A quality report as anyone may see it: what was found, by whom (name and
 * role), and whether that is an independent inspection or the seller's own
 * check. Never the reporter's email address or user id; the public reports
 * endpoints used to return both.
 */
export interface PublicQualityReport {
  id: string;
  passportId: string;
  structuralScore: number | null;
  aestheticScore: number | null;
  environmentalScore: number | null;
  overallGrade: string | null;
  reportNotes: string | null;
  photoUrls: string[] | null;
  blockchainTxHash: string | null;
  disputed: boolean;
  createdAt: Date;
  inspector: { name: string; role: string } | null;
  source: InspectionSource;
}

type ReportWithInspector = QualityReport & { inspector: { name: string; role: string } | null };

function toPublic(report: ReportWithInspector): PublicQualityReport {
  // The role recorded on the report; for a report from before it was
  // recorded, the reporter's role now.
  const role = report.inspectorRole ?? report.inspector?.role ?? null;
  return {
    id: report.id,
    passportId: report.passportId,
    structuralScore: report.structuralScore,
    aestheticScore: report.aestheticScore,
    environmentalScore: report.environmentalScore,
    overallGrade: report.overallGrade,
    reportNotes: report.reportNotes,
    photoUrls: report.photoUrls,
    blockchainTxHash: report.blockchainTxHash,
    disputed: report.disputed,
    createdAt: report.createdAt,
    inspector: report.inspector && role ? { name: report.inspector.name, role } : null,
    source: inspectionSource(role),
  };
}

// ─── Submit quality report ────────────────────────────────────────────────────

export async function createQualityReport(
  input: CreateQualityReportInput,
  inspector: { id: string; role: string },
): Promise<QualityReport> {
  // Verify passport exists
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, input.passportId),
  });

  if (!passport) throw new NotFoundError('Passport', input.passportId);

  const [report] = await db
    .insert(qualityReports)
    .values({
      passportId: input.passportId,
      inspectorId: inspector.id,
      inspectorRole: inspector.role,
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

export async function getReportsByPassport(passportId: string): Promise<PublicQualityReport[]> {
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });

  if (!passport) throw new NotFoundError('Passport', passportId);

  const reports = await db.query.qualityReports.findMany({
    where: eq(qualityReports.passportId, passportId),
    orderBy: [desc(qualityReports.createdAt)],
    with: { inspector: { columns: { name: true, role: true } } },
  });

  return reports.map(toPublic);
}

// ─── Get report by id ─────────────────────────────────────────────────────────

export async function getReportById(id: string): Promise<PublicQualityReport> {
  const report = await db.query.qualityReports.findFirst({
    where: eq(qualityReports.id, id),
    with: { inspector: { columns: { name: true, role: true } } },
  });

  if (!report) throw new NotFoundError('Quality report', id);
  return toPublic(report);
}

// ─── List reports submitted by an inspector ───────────────────────────────────

export interface OwnQualityReport extends QualityReport {
  /** The material the report is about, so the list need not show an id. */
  material: {
    productName: string;
    serialNumber: string | null;
    categoryL1: string;
    photo: string | null;
  } | null;
}

export async function listInspectorReports(inspectorId: string): Promise<OwnQualityReport[]> {
  const reports = await db.query.qualityReports.findMany({
    where: eq(qualityReports.inspectorId, inspectorId),
    orderBy: [desc(qualityReports.createdAt)],
    with: {
      passport: {
        columns: { productName: true, serialNumber: true, categoryL1: true, conditionPhotos: true },
      },
    },
  });
  return reports.map(({ passport, ...report }) => ({
    ...report,
    material: passport
      ? {
          productName: passport.productName,
          serialNumber: passport.serialNumber,
          categoryL1: passport.categoryL1,
          photo: (passport.conditionPhotos as string[] | null)?.[0] ?? null,
        }
      : null,
  }));
}

// ─── Materials to inspect ─────────────────────────────────────────────────────

export interface MaterialForInspection {
  id: string;
  productName: string;
  serialNumber: string | null;
  categoryL1: string;
  categoryL2: string | null;
  conditionGrade: string | null;
  conditionNotes: string | null;
  status: string;
  unitOfMeasure: string | null;
  dimensions: unknown;
  photo: string | null;
  organisationName: string;
  /** Reports of any kind on this material. */
  reportCount: number;
  /** When an inspector last inspected it; null if never. */
  lastIndependentInspectionAt: string | null;
}

// A report is independent when its recorded role, or for older reports the
// reporter's current role, is "inspector".
const independentReportsOf = (passportId: SQL | typeof materialPassports.id) => sql`
  from quality_reports q
  left join users u on u.id = q.inspector_id
  where q.passport_id = ${passportId} and coalesce(q.inspector_role, u.role) = 'inspector'`;

function inspectionConditions(
  query: Pick<InspectionMaterialsQuery, 'q' | 'categoryL1' | 'uninspected'>,
): SQL[] {
  // An inspector audits the whole marketplace: every registered material,
  // whoever holds it (owner decision, 2026-10-02). Drafts are not registered.
  const conditions: SQL[] = [ne(materialPassports.status, 'draft')];
  if (query.categoryL1) conditions.push(eq(materialPassports.categoryL1, query.categoryL1));
  if (query.uninspected) {
    conditions.push(sql`not exists (select 1 ${independentReportsOf(materialPassports.id)})`);
  }
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(
      or(
        ilike(materialPassports.productName, pattern),
        ilike(materialPassports.serialNumber, pattern),
        // Pasting a passport ID, or the start of one, still finds it.
        sql`${materialPassports.id}::text ilike ${`${query.q.replace(/[\\%_]/g, '\\$&')}%`}`,
      )!,
    );
  }
  return conditions;
}

/**
 * The materials an inspector can choose from, least recently inspected first
 * (never inspected at the top), so the list doubles as a work queue.
 */
export async function listMaterialsForInspection(query: InspectionMaterialsQuery): Promise<{
  data: MaterialForInspection[];
  total: number;
  page: number;
  limit: number;
}> {
  const where = and(...inspectionConditions(query));
  const lastIndependent = sql<
    string | null
  >`(select max(q.created_at) ${independentReportsOf(materialPassports.id)})`;

  const [rows, count] = await Promise.all([
    db
      .select({
        id: materialPassports.id,
        productName: materialPassports.productName,
        serialNumber: materialPassports.serialNumber,
        categoryL1: materialPassports.categoryL1,
        categoryL2: materialPassports.categoryL2,
        conditionGrade: materialPassports.conditionGrade,
        conditionNotes: materialPassports.conditionNotes,
        status: materialPassports.status,
        unitOfMeasure: materialPassports.unitOfMeasure,
        dimensions: materialPassports.dimensions,
        photos: materialPassports.conditionPhotos,
        organisationName: organisations.name,
        reportCount: sql<number>`(select cast(count(*) as int) from quality_reports q where q.passport_id = ${materialPassports.id})`,
        lastIndependentInspectionAt: lastIndependent,
      })
      .from(materialPassports)
      .innerJoin(organisations, eq(materialPassports.organisationId, organisations.id))
      .where(where)
      .orderBy(sql`${lastIndependent} asc nulls first`, asc(materialPassports.productName))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(materialPassports)
      .where(where),
  ]);

  return {
    data: rows.map(({ photos, ...row }) => ({
      ...row,
      photo: (photos as string[] | null)?.[0] ?? null,
    })),
    total: count[0]?.count ?? 0,
    page: query.page,
    limit: query.limit,
  };
}

/** The numbers on an inspector's dashboard. */
export async function getInspectionSummary(inspectorId: string): Promise<{
  materials: number;
  notIndependentlyInspected: number;
  myReports: number;
}> {
  const [[all], [uninspected], [mine]] = await Promise.all([
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(materialPassports)
      .where(and(...inspectionConditions({ uninspected: false }))),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(materialPassports)
      .where(and(...inspectionConditions({ uninspected: true }))),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(qualityReports)
      .where(eq(qualityReports.inspectorId, inspectorId)),
  ]);
  return {
    materials: all?.count ?? 0,
    notIndependentlyInspected: uninspected?.count ?? 0,
    myReports: mine?.count ?? 0,
  };
}

// ─── Flag a report as disputed ────────────────────────────────────────────────

export async function disputeReport(reportId: string): Promise<QualityReport> {
  const report = await db.query.qualityReports.findFirst({
    where: eq(qualityReports.id, reportId),
  });

  if (!report) throw new NotFoundError('Quality report', reportId);
  if (report.disputed) throw new ForbiddenError('Report is already disputed');

  const [updated] = await db
    .update(qualityReports)
    .set({ disputed: true })
    .where(eq(qualityReports.id, reportId))
    .returning();

  if (!updated) throw new Error('Failed to update report');
  return updated;
}
