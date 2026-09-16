import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { auditEvents, db, listings, materialPassports, organisations, users } from '@trace/db';
import { SEED_TAG } from '@trace/core/constants/demo-catalogue';
import { createTestApp, getAuthHeader, getTestPersona, type TestApp } from '../../test-utils.js';
import {
  getMarketplaceFacets,
  getMarketplaceStats,
  searchListings,
} from './marketplace.service.js';

const HUB_STAFF = getTestPersona('hubStaff');

describe('marketplace buyer flow', () => {
  let app: TestApp;
  let buyerAuth: { authorization: string };
  let listingId: string;
  let buyerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const buyerEmail = `walletless-buyer-${Date.now()}@example.com`;
    const [buyer] = await db
      .insert(users)
      .values({
        email: buyerEmail,
        passwordHash: await bcrypt.hash('UnitTestBuyerOnly!', 10),
        name: 'Walletless Buyer',
        role: 'buyer',
        organisationId: null,
      })
      .returning();
    buyerId = buyer!.id;
    buyerAuth = await getAuthHeader(app, buyerEmail, 'UnitTestBuyerOnly!');

    const org = await db.query.organisations.findFirst({
      where: eq(organisations.slug, 'stirling'),
    });
    const seller = await db.query.users.findFirst({
      where: eq(users.email, 'staff@stirlingreuse.com'),
    });

    const [passport] = await db
      .insert(materialPassports)
      .values({
        organisationId: org!.id,
        registeredBy: seller!.id,
        productName: `Walletless Buyer Test ${Date.now()}`,
        categoryL1: 'masonry',
        conditionGrade: 'B',
        status: 'active',
      })
      .returning();

    const [listing] = await db
      .insert(listings)
      .values({
        passportId: passport!.id,
        organisationId: org!.id,
        sellerId: seller!.id,
        pricePence: 12500,
        currency: 'GBP',
        quantity: 1,
        shippingOptions: [{ method: 'collection' }],
        status: 'active',
      })
      .returning();

    listingId = listing!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets a buyer without an organisation make an offer and logs the walletless model', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/offers',
      headers: buyerAuth,
      payload: { listingId, notes: 'Walletless buyer test offer' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { id: string; buyerId: string; amountPence: number } }>();
    expect(body.data.buyerId).toBe(buyerId);
    expect(body.data.amountPence).toBe(12500);

    const event = await db.query.auditEvents.findFirst({
      where: eq(auditEvents.resourceId, body.data.id),
    });
    expect(event?.action).toBe('marketplace.offer');
    expect(event?.metadata['buyerModel']).toBe('walletless_buyer');
  });
});

// D-03: object-level authorization on a single transaction. Before this fix,
// getTransactionById took no caller argument at all, and resolve_dispute
// checked only that the transaction was in 'disputed' state — so any
// authenticated account could read, and resolve, a dispute it had no part in.
// Regression coverage for cross-organisation transaction access.
describe('D-03: transaction authorization', () => {
  let app: TestApp;
  let buyerAuth: { authorization: string };
  let sellerAuth: { authorization: string };
  let strangerAuth: { authorization: string };
  let adminAuth: { authorization: string };
  let transactionId: string;

  async function makeUser(role: string, organisationId: string | null, label: string) {
    const email = `d03-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'D03Test1234!';
    await db.insert(users).values({
      email,
      passwordHash: await bcrypt.hash(password, 10),
      name: `D-03 ${label}`,
      role,
      organisationId,
    });
    return getAuthHeader(app, email, password);
  }

  beforeAll(async () => {
    app = await createTestApp();

    const org = await db.query.organisations.findFirst({
      where: eq(organisations.slug, 'stirling'),
    });
    const seller = await db.query.users.findFirst({
      where: eq(users.email, 'staff@stirlingreuse.com'),
    });

    sellerAuth = await getAuthHeader(app, HUB_STAFF.email, HUB_STAFF.password);
    buyerAuth = await makeUser('buyer', null, 'buyer');
    strangerAuth = await makeUser('buyer', null, 'stranger'); // no relationship to the trade
    adminAuth = await makeUser('platform_admin', null, 'admin');

    const [passport] = await db
      .insert(materialPassports)
      .values({
        organisationId: org!.id,
        registeredBy: seller!.id,
        productName: `D-03 Auth Test ${Date.now()}`,
        categoryL1: 'masonry',
        conditionGrade: 'B',
        status: 'active',
      })
      .returning();

    const [listing] = await db
      .insert(listings)
      .values({
        passportId: passport!.id,
        organisationId: org!.id,
        sellerId: seller!.id,
        pricePence: 5000,
        currency: 'GBP',
        quantity: 1,
        shippingOptions: [{ method: 'collection' }],
        status: 'active',
      })
      .returning();

    const offerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/offers',
      headers: buyerAuth,
      payload: { listingId: listing!.id },
    });
    transactionId = offerRes.json<{ data: { id: string } }>().data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the buyer, the seller and a platform admin read the transaction', async () => {
    for (const auth of [buyerAuth, sellerAuth, adminAuth]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/marketplace/transactions/${transactionId}`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('404s an unrelated authenticated account reading the transaction', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/marketplace/transactions/${transactionId}`,
      headers: strangerAuth,
    });
    expect(res.statusCode).toBe(404);
  });

  it('401s an unauthenticated read', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/marketplace/transactions/${transactionId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('403s resolve_dispute for the buyer, the seller and an unrelated account', async () => {
    const flagRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/transactions/${transactionId}`,
      headers: buyerAuth,
      payload: { action: 'flag_dispute' },
    });
    expect(flagRes.statusCode).toBe(200);
    expect(flagRes.json<{ data: { status: string } }>().data.status).toBe('disputed');

    for (const auth of [buyerAuth, sellerAuth, strangerAuth]) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/marketplace/transactions/${transactionId}`,
        headers: auth,
        payload: { action: 'resolve_dispute' },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('lets a platform admin resolve the dispute', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/transactions/${transactionId}`,
      headers: adminAuth,
      payload: { action: 'resolve_dispute' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { status: string } }>().data.status).toBe('resolved');
  });
});

// Curated-only browse (public_buyer_demo): a visitor's own listing must never
// appear in anonymous marketplace browse or its stats, only in their own
// seller dashboard (listHubListings / getListingById — untouched by this
// filter). Covers both listings the curated tag admits and excludes.
describe('curated-only browse', () => {
  const marker = `curated-browse-${Date.now()}`;
  const baseQuery = {
    page: 1,
    limit: 50,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  } as const;

  let orgId: string;
  let sellerId: string;
  let curatedListingId: string;
  let visitorListingId: string;

  beforeAll(async () => {
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.slug, 'stirling'),
    });
    const seller = await db.query.users.findFirst({
      where: eq(users.email, 'staff@stirlingreuse.com'),
    });
    orgId = org!.id;
    sellerId = seller!.id;

    // Categories the real catalogue never uses (structural-steel,
    // structural-timber, masonry, insulation — see scripts/lib/catalogue.ts),
    // so the facets assertions below can tell this fixture's rows apart from
    // the live curated catalogue without depending on its exact contents.
    const [curatedPassport] = await db
      .insert(materialPassports)
      .values({
        organisationId: orgId,
        registeredBy: sellerId,
        productName: `${marker} curated`,
        categoryL1: 'flooring',
        conditionGrade: 'D',
        status: 'active',
        customAttributes: { seedSource: SEED_TAG },
      })
      .returning();
    const [visitorPassport] = await db
      .insert(materialPassports)
      .values({
        organisationId: orgId,
        registeredBy: sellerId,
        productName: `${marker} visitor`,
        categoryL1: 'roofing',
        conditionGrade: 'C',
        status: 'active',
      })
      .returning();

    const [curatedListing] = await db
      .insert(listings)
      .values({
        passportId: curatedPassport!.id,
        organisationId: orgId,
        sellerId,
        pricePence: 500,
        currency: 'GBP',
        quantity: 1,
        shippingOptions: [{ method: 'collection' }],
        status: 'active',
      })
      .returning();
    const [visitorListing] = await db
      .insert(listings)
      .values({
        passportId: visitorPassport!.id,
        organisationId: orgId,
        sellerId,
        pricePence: 500,
        currency: 'GBP',
        quantity: 1,
        shippingOptions: [{ method: 'collection' }],
        status: 'active',
      })
      .returning();

    curatedListingId = curatedListing!.id;
    visitorListingId = visitorListing!.id;
  });

  it('returns both curated and visitor listings when not curated-only', async () => {
    const result = await searchListings({ ...baseQuery, q: marker }, { curatedOnly: false });
    const ids = result.data.map((l) => l.id);
    expect(ids).toContain(curatedListingId);
    expect(ids).toContain(visitorListingId);
  });

  it('excludes the visitor listing and keeps the curated one when curated-only', async () => {
    const result = await searchListings({ ...baseQuery, q: marker }, { curatedOnly: true });
    const ids = result.data.map((l) => l.id);
    expect(ids).toContain(curatedListingId);
    expect(ids).not.toContain(visitorListingId);
  });

  it('defaults to uncurated browse when no option is passed', async () => {
    const result = await searchListings({ ...baseQuery, q: marker });
    const ids = result.data.map((l) => l.id);
    expect(ids).toContain(visitorListingId);
  });

  it('agrees with search: curated-only stats never count the visitor listing', async () => {
    const [uncurated, curated] = await Promise.all([
      getMarketplaceStats({ curatedOnly: false }),
      getMarketplaceStats({ curatedOnly: true }),
    ]);
    // Both counts include the whole live catalogue, not just this fixture, so
    // assert the *difference* the visitor listing makes rather than a total.
    expect(uncurated.activeCount).toBeGreaterThan(curated.activeCount);
  });

  it('facets include both categories when not curated-only', async () => {
    const facets = await getMarketplaceFacets({ curatedOnly: false });
    expect(facets.categoryL1).toContain('flooring');
    expect(facets.categoryL1).toContain('roofing');
  });

  it('facets keep the curated category and grade but drop the visitor-only ones', async () => {
    const facets = await getMarketplaceFacets({ curatedOnly: true });
    expect(facets.categoryL1).toContain('flooring');
    expect(facets.categoryL1).not.toContain('roofing');
    expect(facets.conditionGrade).toContain('D');
    expect(facets.conditionGrade).not.toContain('C');
  });
});
