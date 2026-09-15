import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvents, blockchainTransactions, db, materialPassports } from '@trace/db';
import { createTestApp, getAuthHeader, getTestPersona, type TestApp } from '../../test-utils.js';

// Uses credentials created by: pnpm db:seed
const SEEDED_ADMIN = getTestPersona('hubAdmin');

const VALID_PASSPORT_PAYLOAD = {
  productName: 'Reclaimed Steel I-Beam',
  categoryL1: 'structural-steel',
  categoryL2: 'i-beams',
  conditionGrade: 'B',
  materialComposition: [{ material: 'Steel', percentage: 100, recycled: true }],
};

describe('POST /api/v1/passports', () => {
  let app: TestApp;
  let authHeader: { authorization: string };

  beforeAll(async () => {
    app = await createTestApp();
    authHeader = await getAuthHeader(app, SEEDED_ADMIN.email, SEEDED_ADMIN.password);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a passport and returns 201 with valid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: VALID_PASSPORT_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{
      success: boolean;
      data: { id: string; productName: string; status: string };
    }>();
    expect(body.success).toBe(true);
    expect(body.data.id).toBeTruthy();
    expect(body.data.productName).toBe(VALID_PASSPORT_PAYLOAD.productName);
    expect(body.data.status).toBe('active');

    const event = await db.query.auditEvents.findFirst({
      where: eq(auditEvents.resourceId, body.data.id),
    });
    expect(event?.action).toBe('passport.create');
  });

  it('returns 401 without authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      payload: VALID_PASSPORT_PAYLOAD,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: { categoryL1: 'structural-steel' }, // missing productName
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ success: boolean; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid categoryL1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: { ...VALID_PASSPORT_PAYLOAD, categoryL1: 'not-a-real-category' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/passports', () => {
  let app: TestApp;
  let authHeader: { authorization: string };

  beforeAll(async () => {
    app = await createTestApp();
    authHeader = await getAuthHeader(app, SEEDED_ADMIN.email, SEEDED_ADMIN.password);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with paginated results for authenticated user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/passports',
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { data: unknown[]; total: number } }>();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.data)).toBe(true);
    expect(typeof body.data.total).toBe('number');
  });

  it('returns 401 without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/passports' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/v1/passports/:id', () => {
  let app: TestApp;
  let authHeader: { authorization: string };
  let createdId: string;

  beforeAll(async () => {
    app = await createTestApp();
    authHeader = await getAuthHeader(app, SEEDED_ADMIN.email, SEEDED_ADMIN.password);

    // Create a passport to retrieve
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: VALID_PASSPORT_PAYLOAD,
    });
    createdId = res.json<{ data: { id: string } }>().data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 for a known passport ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/passports/${createdId}`,
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { id: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(createdId);
  });

  it('returns 404 for an unknown passport ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/passports/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ success: boolean; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /api/v1/passports/:id', () => {
  let app: TestApp;
  let authHeader: { authorization: string };
  let createdId: string;

  beforeAll(async () => {
    app = await createTestApp();
    authHeader = await getAuthHeader(app, SEEDED_ADMIN.email, SEEDED_ADMIN.password);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: VALID_PASSPORT_PAYLOAD,
    });
    createdId = res.json<{ data: { id: string } }>().data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('updates a passport with partial data and returns 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/passports/${createdId}`,
      headers: authHeader,
      payload: { conditionGrade: 'A', conditionNotes: 'Inspected and approved' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { conditionGrade: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.conditionGrade).toBe('A');
  });

  it('returns 401 without authentication', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/passports/${createdId}`,
      payload: { conditionGrade: 'A' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// D-04: updatePassport() used to reuse buildInsertValues, written for
// inserts, where every absent field defaults to null/[]/{}. A one-field
// PATCH therefore silently wiped every other column -- hazardous-substance
// declarations included, with the fingerprint recomputed over the
// now-empty record and still reporting "Untampered". buildUpdateValues
// fixes this by only ever including a field the caller actually sent.
describe('D-04: PATCH preserves every field it was not sent', () => {
  let app: TestApp;
  let authHeader: { authorization: string };

  // Deliberately touches every field buildUpdateValues maps, including the
  // hazardous-substance declaration that is the severe case in the finding.
  const FULL_PAYLOAD = {
    productName: 'D-04 Full Coverage Test',
    categoryL1: 'structural-steel',
    categoryL2: 'i-beams',
    unitOfMeasure: 'each',
    materialComposition: [{ material: 'Steel', percentage: 100, recycled: true }],
    dimensions: { length: 500, width: 200, height: 100, weight: 40, unit: 'mm', weightUnit: 'kg' },
    technicalSpecs: { grade: 'S355' },
    manufacturerName: 'Acme Steel Ltd',
    countryOfOrigin: 'GB',
    gwpTotal: 12.5,
    embodiedCarbon: 8.3,
    recycledContent: 90,
    epdReference: 'https://example.com/epd/123',
    ceMarking: true,
    declarationOfPerformance: 'https://example.com/dop/123',
    harmonisedStandard: 'EN 10025',
    previousBuildingId: 'BLDG-42',
    deconstructionMethod: 'selective',
    reclaimedBy: 'Test Reclaimer',
    conditionGrade: 'B',
    conditionNotes: 'Original condition notes',
    originalAge: 15,
    remainingLifeEstimate: 40,
    carbonSavingsVsNew: 55.2,
    circularityScore: 80,
    reuseSuitability: ['Facing brickwork', 'Internal walls'],
    handlingRequirements: 'Handle with care',
    hazardousSubstances: [{ name: 'Lead paint', casNumber: '7439-92-1', hazardClass: 'H1' }],
    customAttributes: { note: 'must survive' },
  };

  beforeAll(async () => {
    app = await createTestApp();
    authHeader = await getAuthHeader(app, SEEDED_ADMIN.email, SEEDED_ADMIN.password);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a one-field PATCH leaves every other field, including hazardousSubstances, byte-identical', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: FULL_PAYLOAD,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ data: { id: string } }>().data.id;

    // Patch exactly one field, unrelated to everything else in the payload.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/passports/${id}`,
      headers: authHeader,
      payload: { conditionNotes: 'Re-inspected, no change to condition' },
    });
    expect(patched.statusCode).toBe(200);

    const after = patched.json<{ data: Record<string, unknown> }>().data;

    // The patched field changed.
    expect(after['conditionNotes']).toBe('Re-inspected, no change to condition');

    // Everything else survived -- this is the actual regression.
    expect(after['manufacturerName']).toBe(FULL_PAYLOAD.manufacturerName);
    expect(after['countryOfOrigin']).toBe(FULL_PAYLOAD.countryOfOrigin);
    expect(after['unitOfMeasure']).toBe(FULL_PAYLOAD.unitOfMeasure);
    expect(after['recycledContent']).toBe(String(FULL_PAYLOAD.recycledContent));
    expect(after['carbonSavingsVsNew']).toBe(String(FULL_PAYLOAD.carbonSavingsVsNew));
    expect(after['circularityScore']).toBe(FULL_PAYLOAD.circularityScore);
    expect(after['originalAge']).toBe(FULL_PAYLOAD.originalAge);
    expect(after['harmonisedStandard']).toBe(FULL_PAYLOAD.harmonisedStandard);
    expect(after['previousBuildingId']).toBe(FULL_PAYLOAD.previousBuildingId);
    expect(after['reclaimedBy']).toBe(FULL_PAYLOAD.reclaimedBy);
    expect(after['handlingRequirements']).toBe(FULL_PAYLOAD.handlingRequirements);
    expect(after['reuseSuitability']).toEqual(FULL_PAYLOAD.reuseSuitability);
    expect(after['customAttributes']).toEqual(FULL_PAYLOAD.customAttributes);
    // The severe case: a hazardous-substance declaration must not vanish.
    expect(after['hazardousSubstances']).toEqual(FULL_PAYLOAD.hazardousSubstances);
  });

  it('survives two sequential single-field patches to different fields', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: FULL_PAYLOAD,
    });
    const id = created.json<{ data: { id: string } }>().data.id;

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/passports/${id}`,
      headers: authHeader,
      payload: { manufacturerName: 'Updated Manufacturer' },
    });
    const second = await app.inject({
      method: 'PATCH',
      url: `/api/v1/passports/${id}`,
      headers: authHeader,
      payload: { originalAge: 20 },
    });
    expect(second.statusCode).toBe(200);
    const after = second.json<{ data: Record<string, unknown> }>().data;

    expect(after['manufacturerName']).toBe('Updated Manufacturer'); // from patch 1, preserved by patch 2
    expect(after['originalAge']).toBe(20); // from patch 2
    expect(after['hazardousSubstances']).toEqual(FULL_PAYLOAD.hazardousSubstances); // untouched by either
    expect(after['customAttributes']).toEqual(FULL_PAYLOAD.customAttributes);
  });
});

describe('GET /api/v1/passports/:id/verify', () => {
  let app: TestApp;
  let authHeader: { authorization: string };
  let createdId: string;

  beforeAll(async () => {
    app = await createTestApp();
    authHeader = await getAuthHeader(app, SEEDED_ADMIN.email, SEEDED_ADMIN.password);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: VALID_PASSPORT_PAYLOAD,
    });
    createdId = res.json<{ data: { id: string } }>().data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns verified status and onchainVerified field', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/passports/${createdId}/verify`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      data: { verified: boolean; onchainVerified: boolean | null };
    }>();
    expect(body.success).toBe(true);
    // Newly created passport is not yet anchored
    expect(body.data.verified).toBe(false);
    // onchainVerified is null when MATERIAL_REGISTRY_ADDRESS is not configured
    expect(
      body.data.onchainVerified === null || typeof body.data.onchainVerified === 'boolean',
    ).toBe(true);
  });

  it('returns 404 for unknown passport ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/passports/00000000-0000-0000-0000-000000000000/verify',
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/v1/passports/:id/certificate', () => {
  let app: TestApp;
  let authHeader: { authorization: string };
  let createdId: string;

  beforeAll(async () => {
    app = await createTestApp();
    authHeader = await getAuthHeader(app, SEEDED_ADMIN.email, SEEDED_ADMIN.password);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: VALID_PASSPORT_PAYLOAD,
    });
    createdId = res.json<{ data: { id: string } }>().data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns pending certificate metadata before the anchor worker completes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/passports/${createdId}/certificate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      data: { status: string; certificateHash: string | null; hub: { name: string } | null };
    }>();
    expect(body.success).toBe(true);
    // 'simulated' is the state the demo deployments run in (a real
    // fingerprint, no chain transaction); it was missing here, so the
    // assertion failed whenever the suite ran in demo anchor mode.
    expect(['pending', 'verified', 'failed', 'simulated']).toContain(body.data.status);
    expect(body.data.hub?.name).toBeTruthy();
  });
});

describe('D-27: a simulated certificate carries no tamper accusation', () => {
  let app: TestApp;
  let authHeader: { authorization: string };
  let passportId: string;

  beforeAll(async () => {
    app = await createTestApp();
    authHeader = await getAuthHeader(app, SEEDED_ADMIN.email, SEEDED_ADMIN.password);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: VALID_PASSPORT_PAYLOAD,
    });
    passportId = res.json<{ data: { id: string } }>().data.id;

    // Force the canonical simulated state, independent of whether this test
    // run has DEMO_SIMULATE_ANCHOR set: a real fingerprint and an anchoredAt,
    // but no transaction hash, because nothing was ever submitted to a chain.
    await db
      .update(materialPassports)
      .set({
        blockchainPassportHash:
          '0xd0bc61a75659a90d26325c83009333ac814b748e569bdda7a3287dd4f6819531',
        blockchainAnchoredAt: new Date(),
        blockchainTxHash: null,
      })
      .where(eq(materialPassports.id, passportId));
  });

  afterAll(async () => {
    await db
      .delete(blockchainTransactions)
      .where(eq(blockchainTransactions.resourceId, passportId));
    await app.close();
  });

  it('reports status simulated with no failureReason and unknown on-chain state', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/passports/${passportId}/certificate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: { status: string; failureReason: string | null; onchainVerified: boolean | null };
    }>();

    expect(body.data.status).toBe('simulated');
    // The bug: MATERIAL_REGISTRY_ADDRESS is set on staging, so verifyPassport
    // queried the contract for a record that was never submitted, got back
    // "no match", and rendered that as a tamper accusation in public JSON.
    expect(body.data.failureReason).toBeNull();
    // Never submitted means unknown, not refuted.
    expect(body.data.onchainVerified).toBeNull();
  });

  it('does not resurrect a stale failureReason from an earlier real anchor', async () => {
    // A passport that was genuinely anchored, then edited (which clears the
    // anchor columns) and re-anchored in simulation, still has its old
    // blockchain_transactions row. Suppression must be explicit, not merely a
    // consequence of there being no row.
    await db.insert(blockchainTransactions).values({
      action: 'registerPassport',
      resourceType: 'passport',
      resourceId: passportId,
      status: 'failed',
      failureReason: 'reverted: stale row from a previous real anchor attempt',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/passports/${passportId}/certificate`,
    });

    const body = res.json<{ data: { status: string; failureReason: string | null } }>();
    expect(body.data.status).toBe('simulated');
    expect(body.data.failureReason).toBeNull();
  });
});
