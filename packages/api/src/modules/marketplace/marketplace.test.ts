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
        quantityAvailable: 1,
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
        quantityAvailable: 1,
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
    // A problem can be flagged only once the seller has accepted the order.
    const acceptRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/transactions/${transactionId}`,
      headers: sellerAuth,
      payload: { action: 'accept' },
    });
    expect(acceptRes.statusCode).toBe(200);

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

    // Categories the real catalogue never uses (it uses masonry,
    // structural-timber, insulation and partitions-linings — see
    // scripts/lib/catalogue.ts),
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
        quantityAvailable: 1,
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
        quantityAvailable: 1,
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

// Buying part of a lot, and the order steps (owner decision 2026-09-30; plan
// ai-os technical/2026-09-30-units-quantity-plan.md, slices U2, U3 and U5).
describe('part of a lot and the order steps', () => {
  let app: TestApp;
  let sellerAuth: { authorization: string };
  let buyerAuth: { authorization: string };
  let secondBuyerAuth: { authorization: string };
  const authByUserId = new Map<string, { authorization: string }>();
  let listingId: string;
  let passportId: string;

  async function makeBuyer(label: string) {
    const email = `lot-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash: await bcrypt.hash('LotTest1234!', 10),
        name: `Lot ${label}`,
        role: 'buyer',
        organisationId: null,
      })
      .returning();
    const auth = await getAuthHeader(app, email, 'LotTest1234!');
    authByUserId.set(user!.id, auth);
    return auth;
  }

  const offer = (auth: { authorization: string }, payload: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/offers',
      headers: auth,
      payload: { listingId, ...payload },
    });
  const act = (auth: { authorization: string }, id: string, action: string) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/transactions/${id}`,
      headers: auth,
      payload: { action },
    });
  const lot = async () =>
    (await db.query.listings.findFirst({ where: eq(listings.id, listingId) }))!;
  const passportStatus = async () =>
    (await db.query.materialPassports.findFirst({ where: eq(materialPassports.id, passportId) }))!
      .status;
  const idOf = (res: { json: <T>() => T }) => res.json<{ data: { id: string } }>().data.id;

  beforeAll(async () => {
    app = await createTestApp();
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.slug, 'stirling'),
    });
    const seller = await db.query.users.findFirst({
      where: eq(users.email, 'staff@stirlingreuse.com'),
    });
    sellerAuth = await getAuthHeader(app, HUB_STAFF.email, HUB_STAFF.password);
    buyerAuth = await makeBuyer('buyer');
    secondBuyerAuth = await makeBuyer('second');

    const [passport] = await db
      .insert(materialPassports)
      .values({
        organisationId: org!.id,
        registeredBy: seller!.id,
        productName: `Lot Test Bricks ${Date.now()}`,
        categoryL1: 'masonry',
        unitOfMeasure: 'each',
        conditionGrade: 'B',
        status: 'listed',
      })
      .returning();
    passportId = passport!.id;

    const [listing] = await db
      .insert(listings)
      .values({
        passportId,
        organisationId: org!.id,
        sellerId: seller!.id,
        pricePence: 300,
        currency: 'GBP',
        quantity: 10,
        quantityAvailable: 10,
        minOrderQuantity: 2,
        shippingOptions: [{ method: 'collection' }],
        status: 'active',
      })
      .returning();
    listingId = listing!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('an offer without a quantity takes the minimum order, at the unit price times the quantity', async () => {
    const res = await offer(buyerAuth);
    expect(res.statusCode).toBe(201);
    const order = res.json<{
      data: { quantity: number; amountPence: number; disputeDeadline: string | null };
    }>().data;
    expect(order.quantity).toBe(2);
    expect(order.amountPence).toBe(600);
    expect(order.disputeDeadline).toBeNull();
    expect((await lot()).quantityAvailable).toBe(8);
    expect((await lot()).status).toBe('active');
    expect(await passportStatus()).toBe('listed');
  });

  it('refuses an order below the minimum while more than that is left, and more than is left', async () => {
    expect((await offer(buyerAuth, { quantity: 1 })).statusCode).toBe(400);
    expect((await offer(buyerAuth, { quantity: 9 })).statusCode).toBe(409);
    expect((await lot()).quantityAvailable).toBe(8);
  });

  it('never lets concurrent offers take more than is left between them', async () => {
    const results = await Promise.all([
      offer(buyerAuth, { quantity: 5 }),
      offer(secondBuyerAuth, { quantity: 5 }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect((await lot()).quantityAvailable).toBe(3);
  });

  it('follows the order steps: the seller accepts before the buyer can confirm delivery', async () => {
    const id = idOf(await offer(secondBuyerAuth, { quantity: 2 }));
    expect((await lot()).quantityAvailable).toBe(1);

    const early = await act(secondBuyerAuth, id, 'confirm_delivery');
    expect(early.statusCode).toBe(409);
    expect(early.json<{ error: { message: string } }>().error.message).toMatch(/not accepted/);
    expect((await act(secondBuyerAuth, id, 'accept')).statusCode).toBe(403);

    const accepted = await act(sellerAuth, id, 'accept');
    expect(accepted.statusCode).toBe(200);
    const confirmed = accepted.json<{ data: { status: string; disputeDeadline: string | null } }>()
      .data;
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.disputeDeadline).not.toBeNull();

    const done = await act(secondBuyerAuth, id, 'confirm_delivery');
    expect(done.json<{ data: { status: string } }>().data.status).toBe('completed');
    // Part of the lot is still for sale.
    expect((await lot()).status).toBe('active');
    expect(await passportStatus()).toBe('listed');
  });

  it('gives the share of a cancelled or rejected order back to the lot', async () => {
    const id = idOf(await offer(buyerAuth, { quantity: 1 }));
    expect((await lot()).quantityAvailable).toBe(0);
    expect((await lot()).status).toBe('reserved');
    expect(await passportStatus()).toBe('reserved');

    expect((await act(sellerAuth, id, 'reject')).statusCode).toBe(200);
    expect((await lot()).quantityAvailable).toBe(1);
    expect((await lot()).status).toBe('active');
    expect(await passportStatus()).toBe('listed');

    const again = idOf(await offer(buyerAuth, { quantity: 1 }));
    expect((await act(buyerAuth, again, 'cancel')).statusCode).toBe(200);
    expect((await lot()).quantityAvailable).toBe(1);
  });

  it('keeps a seller from cancelling a listing, or shrinking the lot, under open orders', async () => {
    const [first] = await db.query.transactions.findMany({
      where: (t, { and: all, eq: is }) => all(is(t.listingId, listingId), is(t.status, 'pending')),
    });
    expect(first).toBeDefined();
    const cancel = await app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/listings/${listingId}`,
      headers: sellerAuth,
      payload: { action: 'cancel' },
    });
    expect(cancel.statusCode).toBe(409);
    const shrink = await app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/listings/${listingId}`,
      headers: sellerAuth,
      payload: { quantity: 3 },
    });
    expect(shrink.statusCode).toBe(409);
  });

  it('sells the lot only when the last unit is sold and no order is still open', async () => {
    const open = await db.query.transactions.findMany({
      where: (t, { and: all, eq: is }) => all(is(t.listingId, listingId), is(t.status, 'pending')),
    });
    const last = idOf(await offer(secondBuyerAuth, { quantity: 1 }));
    expect((await lot()).status).toBe('reserved');

    await act(sellerAuth, last, 'accept');
    await act(secondBuyerAuth, last, 'confirm_delivery');
    // The earlier open orders still hold part of the lot.
    expect((await lot()).status).toBe('reserved');

    for (const order of open) {
      await act(sellerAuth, order.id, 'accept');
      const auth = authByUserId.get(order.buyerId)!;
      expect((await act(auth, order.id, 'confirm_delivery')).statusCode).toBe(200);
    }
    expect((await lot()).status).toBe('sold');
    expect(await passportStatus()).toBe('sold');
  });
});

// Fixes from the trading-journeys rehearsal, round 1 (2026-10-02): findings F1,
// F2, F5 and F12 in ai-os technical/2026-10-02-trading-journeys-rehearsal.md.
describe('rehearsal round 1 fixes', () => {
  let app: TestApp;
  let adminSellerAuth: { authorization: string };
  let staffAuth: { authorization: string };
  let outsiderAuth: { authorization: string };
  let buyerAuth: { authorization: string };
  let orgId: string;
  let hubAdminId: string;

  const HUB_ADMIN = getTestPersona('hubAdmin');
  const SUPPLIER = getTestPersona('supplier');

  async function lot(values: { quantity: number; pricePence?: number; minOrderQuantity?: number }) {
    const [passport] = await db
      .insert(materialPassports)
      .values({
        organisationId: orgId,
        registeredBy: hubAdminId,
        productName: `Round 1 Lot ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        categoryL1: 'masonry',
        conditionGrade: 'B',
        status: 'listed',
      })
      .returning();
    const [listing] = await db
      .insert(listings)
      .values({
        passportId: passport!.id,
        organisationId: orgId,
        sellerId: hubAdminId,
        pricePence: values.pricePence ?? 200,
        currency: 'GBP',
        quantity: values.quantity,
        quantityAvailable: values.quantity,
        minOrderQuantity: values.minOrderQuantity ?? 1,
        shippingOptions: [{ method: 'collection' }],
        status: 'active',
      })
      .returning();
    return { listingId: listing!.id, passportId: passport!.id };
  }
  const offer = (auth: { authorization: string }, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/marketplace/offers', headers: auth, payload });
  const act = (auth: { authorization: string }, id: string, action: string) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/transactions/${id}`,
      headers: auth,
      payload: { action },
    });
  const patchListing = (id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/listings/${id}`,
      headers: adminSellerAuth,
      payload,
    });
  const statuses = async (ids: { listingId: string; passportId: string }) => ({
    listing: (await db.query.listings.findFirst({ where: eq(listings.id, ids.listingId) }))!.status,
    passport: (await db.query.materialPassports.findFirst({
      where: eq(materialPassports.id, ids.passportId),
    }))!.status,
  });
  const idOf = (res: { json: <T>() => T }) => res.json<{ data: { id: string } }>().data.id;

  beforeAll(async () => {
    app = await createTestApp();
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.slug, 'stirling'),
    });
    const hubAdmin = await db.query.users.findFirst({ where: eq(users.email, HUB_ADMIN.email) });
    orgId = org!.id;
    hubAdminId = hubAdmin!.id;
    adminSellerAuth = await getAuthHeader(app, HUB_ADMIN.email, HUB_ADMIN.password);
    staffAuth = await getAuthHeader(app, HUB_STAFF.email, HUB_STAFF.password);
    outsiderAuth = await getAuthHeader(app, SUPPLIER.email, SUPPLIER.password);

    const email = `round1-buyer-${Date.now()}@example.com`;
    await db.insert(users).values({
      email,
      passwordHash: await bcrypt.hash('Round1Test1234!', 10),
      name: 'Round 1 Buyer',
      role: 'buyer',
      organisationId: null,
    });
    buyerAuth = await getAuthHeader(app, email, 'Round1Test1234!');
  });

  afterAll(async () => {
    await app.close();
  });

  it('F1: refuses an order whose total is beyond the limit, and a price beyond it', async () => {
    const dear = await lot({ quantity: 2, pricePence: 1_500_000_000 });
    const res = await offer(buyerAuth, { listingId: dear.listingId, quantity: 2 });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/smaller quantity/);
    expect((await patchListing(dear.listingId, { pricePence: 3_000_000_000 })).statusCode).toBe(
      400,
    );
  });

  it('F5: the price is the asking price, whatever a buyer sends', async () => {
    const cheap = await lot({ quantity: 5, pricePence: 300 });
    const res = await offer(buyerAuth, { listingId: cheap.listingId, quantity: 5, offerPence: 1 });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ data: { amountPence: number } }>().data.amountPence).toBe(1500);
  });

  it('F2: a lot shrunk to what is ordered is reserved, and so is its passport', async () => {
    const held = await lot({ quantity: 6 });
    await offer(buyerAuth, { listingId: held.listingId, quantity: 4 });
    expect((await patchListing(held.listingId, { quantity: 4 })).statusCode).toBe(200);
    expect(await statuses(held)).toEqual({ listing: 'reserved', passport: 'reserved' });
  });

  it('F2: a lot shrunk to what has been sold is sold, and so is its passport', async () => {
    const partSold = await lot({ quantity: 4 });
    const id = idOf(await offer(buyerAuth, { listingId: partSold.listingId, quantity: 2 }));
    await act(adminSellerAuth, id, 'accept');
    await act(buyerAuth, id, 'confirm_delivery');
    expect(await statuses(partSold)).toEqual({ listing: 'active', passport: 'listed' });
    expect((await patchListing(partSold.listingId, { quantity: 2 })).statusCode).toBe(200);
    expect(await statuses(partSold)).toEqual({ listing: 'sold', passport: 'sold' });
  });

  it("F12: a hub's orders belong to the hub: any of its staff sees and answers them", async () => {
    const hubLot = await lot({ quantity: 3 });
    const id = idOf(await offer(buyerAuth, { listingId: hubLot.listingId, quantity: 1 }));

    // The listing was created by the hub admin; hub staff is another member.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplace/transactions',
      headers: staffAuth,
    });
    const seen = list
      .json<{ data: Array<{ id: string; viewerSide: string; allowedActions: string[] }> }>()
      .data.find((o) => o.id === id);
    expect(seen?.viewerSide).toBe('seller');
    expect(seen?.allowedActions.sort()).toEqual(['accept', 'cancel', 'reject']);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/marketplace/transactions/${id}`,
          headers: staffAuth,
        })
      ).statusCode,
    ).toBe(200);
    expect((await act(staffAuth, id, 'accept')).statusCode).toBe(200);
  });

  it('F12: a seller of another organisation neither sees nor answers them', async () => {
    const hubLot = await lot({ quantity: 3 });
    const id = idOf(await offer(buyerAuth, { listingId: hubLot.listingId, quantity: 1 }));

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplace/transactions',
      headers: outsiderAuth,
    });
    expect(list.json<{ data: Array<{ id: string }> }>().data.map((o) => o.id)).not.toContain(id);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/marketplace/transactions/${id}`,
          headers: outsiderAuth,
        })
      ).statusCode,
    ).toBe(404);
    expect((await act(outsiderAuth, id, 'accept')).statusCode).toBe(403);
    expect((await act(outsiderAuth, id, 'cancel')).statusCode).toBe(403);
  });

  it("F12: the buyer's list says what the buyer can do, and hub staff can't buy from their hub", async () => {
    const hubLot = await lot({ quantity: 3 });
    const id = idOf(await offer(buyerAuth, { listingId: hubLot.listingId, quantity: 1 }));
    const mine = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/marketplace/transactions',
        headers: buyerAuth,
      })
    )
      .json<{ data: Array<{ id: string; viewerSide: string; allowedActions: string[] }> }>()
      .data.find((o) => o.id === id);
    expect(mine).toMatchObject({ viewerSide: 'buyer', allowedActions: ['cancel'] });

    await act(adminSellerAuth, id, 'accept');
    const after = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/marketplace/transactions',
        headers: buyerAuth,
      })
    )
      .json<{ data: Array<{ id: string; allowedActions: string[] }> }>()
      .data.find((o) => o.id === id);
    expect(after?.allowedActions.sort()).toEqual(['cancel', 'confirm_delivery', 'flag_dispute']);

    expect((await offer(staffAuth, { listingId: hubLot.listingId, quantity: 1 })).statusCode).toBe(
      403,
    );
  });
});
