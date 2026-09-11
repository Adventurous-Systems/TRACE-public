import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, materialPassports, computePassportHash } from '@trace/db';
import { createTestApp, getAuthHeader, type TestApp } from '../../test-utils.js';

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
const INSPECTOR = { email: 'inspector@trace.eco', password: 'UnitTestInspectorOnly!' };
const HUB_STAFF = { email: 'staff@stirlingreuse.com', password: 'UnitTestStaffOnly!' };

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
