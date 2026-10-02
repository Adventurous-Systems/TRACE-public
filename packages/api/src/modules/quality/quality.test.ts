import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, materialPassports, computePassportHash } from '@trace/db';
import { createTestApp, getAuthHeader, getTestPersona, type TestApp } from '../../test-utils.js';

/**
 * Regression lock for a bug that broke the demo's headline moment.
 *
 * `conditionGrade` is part of the canonical fingerprint document. Filing a
 * quality report with a grade changes that field, and the service used to write
 * it with a bare drizzle update and no re-anchor — so the stored fingerprint
 * went stale and the public /verify-integrity endpoint reported "Mismatch" on a
 * passport nobody had tampered with. Since the run sheet puts an inspector on
 * stage, an inspection during a demo permanently broke that product.
 *
 * Uses credentials created by: pnpm db:seed
 */
const INSPECTOR = getTestPersona('inspector');
const HUB_STAFF = getTestPersona('hubStaff');

describe('quality reports and the passport fingerprint', () => {
  let app: TestApp;
  let inspectorAuth: { authorization: string };
  let passportId: string;

  beforeAll(async () => {
    app = await createTestApp();
    inspectorAuth = await getAuthHeader(app, INSPECTOR.email, INSPECTOR.password);
    const staffAuth = await getAuthHeader(app, HUB_STAFF.email, HUB_STAFF.password);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: staffAuth,
      payload: {
        productName: `Quality Fingerprint Fixture ${Date.now()}`,
        categoryL1: 'structural-steel',
        conditionGrade: 'B',
        materialComposition: [{ material: 'Steel', percentage: 100, recycled: true }],
      },
    });
    expect(created.statusCode).toBe(201);
    passportId = created.json().data.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('leaves verify-integrity matching after an inspection changes the grade', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/passports/${passportId}/verify-integrity`,
    });
    expect(before.json().data.match).toBe(true);

    // Grade it differently from the passport's current 'B'.
    const report = await app.inject({
      method: 'POST',
      url: '/api/v1/quality/reports',
      headers: inspectorAuth,
      payload: {
        passportId,
        structuralScore: 9,
        aestheticScore: 7,
        environmentalScore: 8,
        overallGrade: 'A',
        reportNotes: 'Re-graded on inspection.',
        photoUrls: [],
      },
    });
    expect(report.statusCode).toBe(201);

    const stored = await db.query.materialPassports.findFirst({
      where: eq(materialPassports.id, passportId),
    });
    expect(stored?.conditionGrade).toBe('A');

    // The heart of it: the grade changed, so the fingerprint must have been
    // recomputed to match. Before the fix this returned false.
    expect(stored?.blockchainPassportHash).toBe(computePassportHash(stored!));

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/passports/${passportId}/verify-integrity`,
    });
    expect(after.json().data.match).toBe(true);
  });

  it('does not re-anchor when the grade is unchanged', async () => {
    const before = await db.query.materialPassports.findFirst({
      where: eq(materialPassports.id, passportId),
    });

    const report = await app.inject({
      method: 'POST',
      url: '/api/v1/quality/reports',
      headers: inspectorAuth,
      payload: { passportId, overallGrade: 'A', reportNotes: 'Confirming grade.', photoUrls: [] },
    });
    expect(report.statusCode).toBe(201);

    const after = await db.query.materialPassports.findFirst({
      where: eq(materialPassports.id, passportId),
    });
    // Same grade in, no write, so the anchor timestamp is untouched.
    expect(after?.blockchainAnchoredAt?.toISOString()).toBe(
      before?.blockchainAnchoredAt?.toISOString(),
    );
    expect(after?.blockchainPassportHash).toBe(computePassportHash(after!));
  });

  it('records a report without a grade without disturbing the fingerprint', async () => {
    const before = await db.query.materialPassports.findFirst({
      where: eq(materialPassports.id, passportId),
    });

    const report = await app.inject({
      method: 'POST',
      url: '/api/v1/quality/reports',
      headers: inspectorAuth,
      payload: { passportId, structuralScore: 6, reportNotes: 'Scores only.', photoUrls: [] },
    });
    expect(report.statusCode).toBe(201);

    const after = await db.query.materialPassports.findFirst({
      where: eq(materialPassports.id, passportId),
    });
    expect(after?.conditionGrade).toBe(before?.conditionGrade);
    expect(after?.blockchainPassportHash).toBe(computePassportHash(after!));
  });
});

// The inspector journey (plan: ai-os technical/2026-10-02-inspector-journey-plan.md).
describe('inspector journey: finding materials, and who stands behind a report', () => {
  const HUB_ADMIN = getTestPersona('hubAdmin');
  const SUPPLIER = getTestPersona('supplier');
  const BUYER = getTestPersona('buyer');
  const marker = `Inspect${Date.now()}`;

  let app: TestApp;
  let inspectorAuth: { authorization: string };
  let hubAdminAuth: { authorization: string };
  let hubMaterial: string;
  let supplierMaterial: string;

  const create = async (auth: { authorization: string }, payload: Record<string, unknown>) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: auth,
      payload,
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.id as string;
  };
  const materials = async (query: string, auth = inspectorAuth) =>
    app.inject({ method: 'GET', url: `/api/v1/quality/materials?${query}`, headers: auth });
  const names = (res: { json: () => { data: { data: Array<{ productName: string }> } } }) =>
    res.json().data.data.map((m) => m.productName);

  beforeAll(async () => {
    app = await createTestApp();
    inspectorAuth = await getAuthHeader(app, INSPECTOR.email, INSPECTOR.password);
    hubAdminAuth = await getAuthHeader(app, HUB_ADMIN.email, HUB_ADMIN.password);
    const supplierAuth = await getAuthHeader(app, SUPPLIER.email, SUPPLIER.password);

    hubMaterial = await create(hubAdminAuth, {
      productName: `${marker} Hub Beam`,
      categoryL1: 'structural-steel',
      conditionGrade: 'B',
      serialNumber: `${marker}-SN-1`,
    });
    supplierMaterial = await create(supplierAuth, {
      productName: `${marker} Supplier Brick`,
      categoryL1: 'masonry',
      conditionGrade: 'B',
    });
    await db.insert(materialPassports).values({
      organisationId: (await db.query.materialPassports.findFirst({
        where: eq(materialPassports.id, hubMaterial),
      }))!.organisationId,
      registeredBy: (await db.query.materialPassports.findFirst({
        where: eq(materialPassports.id, hubMaterial),
      }))!.registeredBy,
      productName: `${marker} Draft Slab`,
      categoryL1: 'masonry',
      status: 'draft',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('an inspector finds registered materials of every organisation, but not drafts', async () => {
    const res = await materials(`q=${marker}`);
    expect(res.statusCode).toBe(200);
    expect(names(res).sort()).toEqual([`${marker} Hub Beam`, `${marker} Supplier Brick`]);
    const beam = res.json().data.data.find((m: { id: string }) => m.id === hubMaterial) as Record<
      string,
      unknown
    >;
    expect(beam).toMatchObject({
      conditionGrade: 'B',
      organisationName: expect.any(String),
      reportCount: 0,
      lastIndependentInspectionAt: null,
    });
  });

  it('finds a material by serial number, by the start of its ID, and by category', async () => {
    expect(names(await materials(`q=${marker}-SN-1`))).toEqual([`${marker} Hub Beam`]);
    expect(names(await materials(`q=${supplierMaterial.slice(0, 13)}`))).toEqual([
      `${marker} Supplier Brick`,
    ]);
    expect(names(await materials(`q=${marker}&categoryL1=masonry`))).toEqual([
      `${marker} Supplier Brick`,
    ]);
  });

  it("a hub admin sees, and may check, only the hub's own materials", async () => {
    expect(names(await materials(`q=${marker}`, hubAdminAuth))).toEqual([`${marker} Hub Beam`]);

    const refused = await app.inject({
      method: 'POST',
      url: '/api/v1/quality/reports',
      headers: hubAdminAuth,
      payload: { passportId: supplierMaterial, overallGrade: 'D' },
    });
    expect(refused.statusCode).toBe(403);
    const passport = await db.query.materialPassports.findFirst({
      where: eq(materialPassports.id, supplierMaterial),
    });
    expect(passport?.conditionGrade).toBe('B');
  });

  it('a material that is still a draft cannot be inspected', async () => {
    const draft = await db.query.materialPassports.findFirst({
      where: eq(materialPassports.productName, `${marker} Draft Slab`),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/quality/reports',
      headers: inspectorAuth,
      payload: { passportId: draft!.id, overallGrade: 'A' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('is closed to buyers and to hub staff', async () => {
    const buyerAuth = await getAuthHeader(app, BUYER.email, BUYER.password);
    const staffAuth = await getAuthHeader(app, HUB_STAFF.email, HUB_STAFF.password);
    expect((await materials(`q=${marker}`, buyerAuth)).statusCode).toBe(403);
    expect((await materials(`q=${marker}`, staffAuth)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/quality/materials' })).statusCode).toBe(
      401,
    );
  });

  it("an inspector's report is independent; a hub's report on its own material is the seller's check", async () => {
    const report = (auth: { authorization: string }, grade: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/quality/reports',
        headers: auth,
        payload: { passportId: hubMaterial, overallGrade: grade, reportNotes: 'Checked.' },
      });
    expect((await report(hubAdminAuth, 'B')).statusCode).toBe(201);

    // Only the seller has checked it so far: it still counts as uninspected.
    expect(names(await materials(`q=${marker}&uninspected=true`)).sort()).toEqual([
      `${marker} Hub Beam`,
      `${marker} Supplier Brick`,
    ]);

    expect((await report(inspectorAuth, 'C')).statusCode).toBe(201);
    expect(names(await materials(`q=${marker}&uninspected=true`))).toEqual([
      `${marker} Supplier Brick`,
    ]);
    // Never inspected first, then the inspected one.
    expect(names(await materials(`q=${marker}`))).toEqual([
      `${marker} Supplier Brick`,
      `${marker} Hub Beam`,
    ]);

    // The public sees who stands behind each report, and nothing private.
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/quality/reports/passport/${hubMaterial}`,
    });
    expect(res.statusCode).toBe(200);
    const reports = res.json().data as Array<Record<string, unknown>>;
    expect(reports.map((r) => r['source'])).toEqual(['independent', 'seller']);
    expect(reports[0]!['inspector']).toEqual({ name: expect.any(String), role: 'inspector' });
    expect(reports[1]!['inspector']).toEqual({ name: expect.any(String), role: 'hub_admin' });
    const body = JSON.stringify(reports);
    expect(body).not.toContain('@');
    expect(body).not.toContain('inspectorId');

    const one = await app.inject({
      method: 'GET',
      url: `/api/v1/quality/reports/${String(reports[0]!['id'])}`,
    });
    expect(JSON.stringify(one.json().data)).not.toContain('@');
  });

  it("an inspector's own reports name the material, and the summary counts are real", async () => {
    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/quality/reports/mine',
      headers: inspectorAuth,
    });
    const report = (mine.json().data as Array<{ passportId: string; material: unknown }>).find(
      (r) => r.passportId === hubMaterial,
    );
    expect(report?.material).toMatchObject({ productName: `${marker} Hub Beam` });

    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/quality/summary',
      headers: inspectorAuth,
    });
    const counts = summary.json().data as Record<string, number>;
    expect(counts['materials']).toBeGreaterThanOrEqual(2);
    expect(counts['notIndependentlyInspected']).toBeGreaterThanOrEqual(1);
    expect(counts['notIndependentlyInspected']).toBeLessThan(counts['materials']!);
    expect(counts['myReports']).toBeGreaterThanOrEqual(1);
  });

  it('dashboard counts cover every passport of the organisation, not the latest five', async () => {
    const stats = await app.inject({
      method: 'GET',
      url: '/api/v1/passports/stats',
      headers: hubAdminAuth,
    });
    expect(stats.statusCode).toBe(200);
    const data = stats.json().data as {
      total: number;
      byStatus: Record<string, number>;
      anchored: number;
      awaitingAnchor: number;
    };
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/passports?limit=1',
      headers: hubAdminAuth,
    });
    expect(data.total).toBe(list.json().data.total);
    expect(Object.values(data.byStatus).reduce((a, b) => a + b, 0)).toBe(data.total);
    expect(data.byStatus['draft']).toBeGreaterThanOrEqual(1);

    // No organisation: a clear refusal, not a crash.
    const none = await app.inject({
      method: 'GET',
      url: '/api/v1/passports/stats',
      headers: inspectorAuth,
    });
    expect(none.statusCode).toBe(400);
  });
});
