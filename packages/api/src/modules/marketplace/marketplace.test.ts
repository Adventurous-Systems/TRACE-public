import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import {
  auditEvents,
  db,
  listings,
  materialPassports,
  orderEvents,
  organisations,
  transactions,
  users,
} from '@trace/db';
import { SEED_TAG } from '@trace/core/constants/demo-catalogue';
import { createTestApp, getAuthHeader, getTestPersona, type TestApp } from '../../test-utils.js';
import {
  getMarketplaceFacets,
  getListingById,
  getMarketplaceStats,
  makeOffer,
  searchListings,
  sweepOrderLifecycle,
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
      payload: { action: 'flag_dispute', notes: 'Half the pallet arrived broken.' },
    });
    expect(flagRes.statusCode).toBe(200);
    expect(flagRes.json<{ data: { status: string } }>().data.status).toBe('disputed');

    for (const auth of [buyerAuth, sellerAuth, strangerAuth]) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/marketplace/transactions/${transactionId}`,
        headers: auth,
        payload: { action: 'resolve_dispute', outcome: 'sale_stands', notes: 'Seems fine to me.' },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('lets a platform admin resolve the dispute', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/transactions/${transactionId}`,
      headers: adminAuth,
      payload: {
        action: 'resolve_dispute',
        outcome: 'sale_stands',
        notes: 'Photos show the damage was in transit, after collection.',
      },
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

// Order lifecycle (plan: ai-os technical/2026-10-02-order-lifecycle-plan.md).
// A flag carries a reason, a flagged order is resolved with an outcome, and
// orders and listings no longer stay open for ever.
describe('order lifecycle', () => {
  type Auth = { authorization: string };
  interface Step {
    action: string;
    toStatus: string;
    actorSide: string;
    note: string | null;
  }
  interface Order {
    id: string;
    status: string;
    notes: string | null;
    responseDeadline: string | null;
    disputeDeadline: string | null;
    steps: Step[];
    isNew: boolean;
    needsViewer: boolean;
  }

  let app: TestApp;
  let sellerAuth: Auth;
  let buyerAuth: Auth;
  let adminAuth: Auth;
  let organisationId: string;
  let sellerId: string;
  const HOUR = 60 * 60 * 1000;
  const past = () => new Date(Date.now() - 60 * 1000);

  async function makeUser(role: string, label: string): Promise<Auth> {
    const email = `life-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    await db.insert(users).values({
      email,
      passwordHash: await bcrypt.hash('LifeTest1234!', 10),
      name: `Life ${label}`,
      role,
      organisationId: null,
    });
    return getAuthHeader(app, email, 'LifeTest1234!');
  }

  /** A lot of its own for each test, so they cannot disturb each other's stock. */
  async function newLot(over: { quantity?: number; expiresAt?: Date; curated?: boolean } = {}) {
    const [passport] = await db
      .insert(materialPassports)
      .values({
        organisationId,
        registeredBy: sellerId,
        productName: `Lifecycle Lot ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        categoryL1: 'masonry',
        unitOfMeasure: 'each',
        conditionGrade: 'B',
        status: 'listed',
        ...(over.curated ? { customAttributes: { seedSource: SEED_TAG } } : {}),
      })
      .returning();
    const quantity = over.quantity ?? 10;
    const [listing] = await db
      .insert(listings)
      .values({
        passportId: passport!.id,
        organisationId,
        sellerId,
        pricePence: 300,
        currency: 'GBP',
        quantity,
        quantityAvailable: quantity,
        minOrderQuantity: 1,
        shippingOptions: [{ method: 'collection' }],
        status: 'active',
        expiresAt: over.expiresAt ?? null,
      })
      .returning();
    return { listingId: listing!.id, passportId: passport!.id };
  }
  const lotOf = async (listingId: string) =>
    (await db.query.listings.findFirst({ where: eq(listings.id, listingId) }))!;
  const passportStatusOf = async (passportId: string) =>
    (await db.query.materialPassports.findFirst({ where: eq(materialPassports.id, passportId) }))!
      .status;

  const order = async (listingId: string, quantity: number, auth = buyerAuth, notes?: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/offers',
      headers: auth,
      payload: { listingId, quantity, ...(notes ? { notes } : {}) },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ data: { id: string } }>().data.id;
  };
  const act = (auth: Auth, id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/transactions/${id}`,
      headers: auth,
      payload,
    });
  const ordersOf = async (auth: Auth) =>
    (
      await app.inject({ method: 'GET', url: '/api/v1/marketplace/transactions', headers: auth })
    ).json<{ data: Order[] }>().data;
  const orderFor = async (auth: Auth, id: string) =>
    (await ordersOf(auth)).find((o) => o.id === id)!;
  const summaryOf = async (auth: Auth) =>
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/marketplace/transactions/summary',
        headers: auth,
      })
    ).json<{ data: { needsAction: number; changed: number; flagged: number } }>().data;
  const messageOf = (res: { json: <T>() => T }) =>
    res.json<{ error: { message: string } }>().error.message;

  beforeAll(async () => {
    app = await createTestApp();
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.slug, 'stirling'),
    });
    const seller = await db.query.users.findFirst({
      where: eq(users.email, 'staff@stirlingreuse.com'),
    });
    organisationId = org!.id;
    sellerId = seller!.id;
    sellerAuth = await getAuthHeader(app, HUB_STAFF.email, HUB_STAFF.password);
    buyerAuth = await makeUser('buyer', 'buyer');
    adminAuth = await makeUser('platform_admin', 'admin');
  });

  afterAll(async () => {
    await app.close();
  });

  it('a new order says when the seller must answer by, and records who placed it', async () => {
    const { listingId } = await newLot();
    const before = Date.now();
    const id = await order(listingId, 2, buyerAuth, 'Collecting on Friday.');
    const placed = await orderFor(buyerAuth, id);

    const deadline = new Date(placed.responseDeadline!).getTime();
    expect(deadline).toBeGreaterThanOrEqual(before + 72 * HOUR - 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 72 * HOUR);
    expect(placed.steps).toMatchObject([
      { action: 'placed', toStatus: 'pending', actorSide: 'buyer', note: 'Collecting on Friday.' },
    ]);
    // No step carries a user id.
    expect(JSON.stringify(placed.steps)).not.toMatch(/actorId/);
  });

  it('a problem cannot be flagged without saying what it is', async () => {
    const { listingId } = await newLot();
    const id = await order(listingId, 2, buyerAuth, 'Collecting on Friday.');
    expect((await act(sellerAuth, id, { action: 'accept' })).statusCode).toBe(200);

    expect((await act(buyerAuth, id, { action: 'flag_dispute' })).statusCode).toBe(400);
    expect((await act(buyerAuth, id, { action: 'flag_dispute', notes: ' no ' })).statusCode).toBe(
      400,
    );
    const flagged = await act(buyerAuth, id, {
      action: 'flag_dispute',
      notes: 'A third of the bricks are cracked.',
    });
    expect(flagged.statusCode).toBe(200);

    // The seller reads the reason; the buyer's own note on the order is kept.
    const seen = await orderFor(sellerAuth, id);
    expect(seen.status).toBe('disputed');
    expect(seen.notes).toBe('Collecting on Friday.');
    expect(seen.steps.at(-1)).toMatchObject({
      action: 'flag_dispute',
      actorSide: 'buyer',
      note: 'A third of the bricks are cracked.',
    });
  });

  it('a flagged order is resolved with an outcome and a reason, by the platform admin', async () => {
    const stands = await newLot({ quantity: 4 });
    const cancelled = await newLot({ quantity: 4 });
    const ids: Record<string, string> = {};
    for (const [key, lot] of Object.entries({ stands, cancelled })) {
      ids[key] = await order(lot.listingId, 4);
      await act(sellerAuth, ids[key]!, { action: 'accept' });
      await act(buyerAuth, ids[key]!, { action: 'flag_dispute', notes: `Problem with ${key}.` });
    }

    // The list the platform admin works from: waiting orders, with the reason.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplace/transactions/flagged',
      headers: adminAuth,
    });
    expect(list.statusCode).toBe(200);
    const waiting = list
      .json<{ data: Array<Record<string, unknown>> }>()
      .data.find((o) => o['id'] === ids['stands']);
    expect(waiting).toMatchObject({
      status: 'disputed',
      reason: 'Problem with stands.',
      sellerOrganisation: expect.any(String),
      buyer: { name: 'Life buyer', email: expect.stringContaining('@') },
      resolution: null,
    });
    for (const auth of [buyerAuth, sellerAuth]) {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/marketplace/transactions/flagged',
            headers: auth,
          })
        ).statusCode,
      ).toBe(403);
    }
    expect((await summaryOf(adminAuth)).flagged).toBeGreaterThanOrEqual(2);

    // Neither an outcome alone nor a reason alone is enough.
    expect((await act(adminAuth, ids['stands']!, { action: 'resolve_dispute' })).statusCode).toBe(
      400,
    );
    expect(
      (await act(adminAuth, ids['stands']!, { action: 'resolve_dispute', outcome: 'sale_stands' }))
        .statusCode,
    ).toBe(400);

    // The sale stands: resolved, and the lot is sold.
    const kept = await act(adminAuth, ids['stands']!, {
      action: 'resolve_dispute',
      outcome: 'sale_stands',
      notes: 'The photos show sound bricks.',
    });
    expect(kept.json<{ data: { status: string } }>().data.status).toBe('resolved');
    expect(await lotOf(stands.listingId)).toMatchObject({ status: 'sold', quantityAvailable: 0 });
    expect(await passportStatusOf(stands.passportId)).toBe('sold');

    // The order is cancelled: the stock is back on the marketplace.
    const undone = await act(adminAuth, ids['cancelled']!, {
      action: 'resolve_dispute',
      outcome: 'cancel_order',
      notes: 'The seller agrees they were damaged.',
    });
    expect(undone.json<{ data: { status: string } }>().data.status).toBe('cancelled');
    expect(await lotOf(cancelled.listingId)).toMatchObject({
      status: 'active',
      quantityAvailable: 4,
    });
    expect(await passportStatusOf(cancelled.passportId)).toBe('listed');

    // Both sides read the outcome and why.
    for (const auth of [buyerAuth, sellerAuth]) {
      expect((await orderFor(auth, ids['cancelled']!)).steps.at(-1)).toMatchObject({
        action: 'resolve_dispute',
        toStatus: 'cancelled',
        actorSide: 'platform',
        note: 'The seller agrees they were damaged.',
      });
    }
    const after = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/marketplace/transactions/flagged',
        headers: adminAuth,
      })
    ).json<{ data: Array<{ id: string; resolution: { outcome: string } | null }> }>().data;
    expect(after.find((o) => o.id === ids['stands'])?.resolution?.outcome).toBe('sale_stands');
    expect(after.find((o) => o.id === ids['cancelled'])?.resolution?.outcome).toBe('cancel_order');
  });

  it('an order the seller does not answer in 72 hours lapses, and its stock returns', async () => {
    const { listingId, passportId } = await newLot({ quantity: 3 });
    const id = await order(listingId, 3);
    expect(await lotOf(listingId)).toMatchObject({ status: 'reserved', quantityAvailable: 0 });

    await db.update(transactions).set({ responseDeadline: past() }).where(eq(transactions.id, id));
    const swept = await sweepOrderLifecycle();
    expect(swept.lapsed).toBeGreaterThanOrEqual(1);

    const lapsed = await orderFor(buyerAuth, id);
    expect(lapsed.status).toBe('cancelled');
    expect(lapsed.steps.at(-1)).toMatchObject({ action: 'lapse', actorSide: 'time_limit' });
    expect(await lotOf(listingId)).toMatchObject({ status: 'active', quantityAvailable: 3 });
    expect(await passportStatusOf(passportId)).toBe('listed');
    // Sweeping again changes nothing.
    await sweepOrderLifecycle();
    expect((await orderFor(buyerAuth, id)).steps.filter((s) => s.action === 'lapse')).toHaveLength(
      1,
    );
  });

  it('a seller who answers after the limit is told the order lapsed, without waiting for the sweep', async () => {
    const { listingId } = await newLot({ quantity: 3 });
    const id = await order(listingId, 2);
    await db.update(transactions).set({ responseDeadline: past() }).where(eq(transactions.id, id));

    const late = await act(sellerAuth, id, { action: 'accept' });
    expect(late.statusCode).toBe(409);
    expect(messageOf(late)).toMatch(/did not answer within 72 hours/);
    expect((await orderFor(sellerAuth, id)).status).toBe('cancelled');
    expect((await lotOf(listingId)).quantityAvailable).toBe(3);
  });

  it('an order the previous release placed, with no deadline of its own, lapses 72 hours after it was placed', async () => {
    const { listingId } = await newLot({ quantity: 3 });
    const id = await order(listingId, 1);
    await db
      .update(transactions)
      .set({ responseDeadline: null, createdAt: new Date(Date.now() - 71 * HOUR) })
      .where(eq(transactions.id, id));
    expect((await orderFor(buyerAuth, id)).status).toBe('pending');

    await db
      .update(transactions)
      .set({ createdAt: new Date(Date.now() - 73 * HOUR) })
      .where(eq(transactions.id, id));
    expect((await orderFor(buyerAuth, id)).status).toBe('cancelled');
  });

  it('an accepted order completes when the time to report a problem runs out', async () => {
    const { listingId, passportId } = await newLot({ quantity: 2 });
    const id = await order(listingId, 2);
    await act(sellerAuth, id, { action: 'accept' });
    await db.update(transactions).set({ disputeDeadline: past() }).where(eq(transactions.id, id));

    // Opening the orders list is enough: no sweep has run.
    const done = await orderFor(buyerAuth, id);
    expect(done.status).toBe('completed');
    expect(done.steps.at(-1)).toMatchObject({ action: 'auto_complete', actorSide: 'time_limit' });
    expect(await lotOf(listingId)).toMatchObject({ status: 'sold', quantityAvailable: 0 });
    expect(await passportStatusOf(passportId)).toBe('sold');

    const late = await act(buyerAuth, id, {
      action: 'flag_dispute',
      notes: 'Found a crack later.',
    });
    expect(late.statusCode).toBe(409);
  });

  it('a problem flagged just after the window closed is refused, and says why', async () => {
    const { listingId } = await newLot({ quantity: 2 });
    const id = await order(listingId, 2);
    await act(sellerAuth, id, { action: 'accept' });
    await db.update(transactions).set({ disputeDeadline: past() }).where(eq(transactions.id, id));

    const late = await act(buyerAuth, id, {
      action: 'flag_dispute',
      notes: 'Found a crack later.',
    });
    expect(late.statusCode).toBe(409);
    expect(messageOf(late)).toMatch(/48 hours to report a problem ran out/);
  });

  it('on the demo a curated lot keeps its last unit; elsewhere, and for other lots, all of it can be ordered', async () => {
    const buyer = (await db.query.users.findFirst({ where: eq(users.role, 'buyer') }))!;
    const viewer = { userId: buyer.id, role: 'buyer', organisationId: null };
    const demo = { keepLastCuratedUnit: true };
    const { listingId } = await newLot({ quantity: 2, curated: true });
    try {
      expect((await getListingById(listingId, demo)).orderableQuantity).toBe(1);
      expect((await getListingById(listingId)).orderableQuantity).toBe(2);
      await expect(makeOffer({ listingId, quantity: 2 }, viewer, demo)).rejects.toThrow(
        /you can order up to 1/,
      );
      await makeOffer({ listingId, quantity: 1 }, viewer, demo);
      expect(await lotOf(listingId)).toMatchObject({ status: 'active', quantityAvailable: 1 });
      expect((await getListingById(listingId, demo)).orderableQuantity).toBe(0);
      await expect(makeOffer({ listingId, quantity: 1 }, viewer, demo)).rejects.toThrow(
        /last one of this lot/,
      );
      // Outside the demo the same lot sells out.
      await makeOffer({ listingId, quantity: 1 }, viewer);
      expect((await lotOf(listingId)).status).toBe('reserved');
    } finally {
      // Keep this curated test lot out of other tests' curated counts.
      await db.update(listings).set({ status: 'cancelled' }).where(eq(listings.id, listingId));
    }
    // A lot that isn't curated can be ordered whole on the demo.
    const { listingId: own } = await newLot({ quantity: 2 });
    await makeOffer({ listingId: own, quantity: 2 }, viewer, demo);
    expect((await lotOf(own)).status).toBe('reserved');
  });

  it('a listing past its date leaves the marketplace at once, and is marked expired by the sweep', async () => {
    const { listingId, passportId } = await newLot({ expiresAt: past() });
    const inBrowse = async () =>
      (
        await searchListings({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' })
      ).data.some((l) => l.id === listingId);
    expect(await inBrowse()).toBe(false);
    expect((await lotOf(listingId)).status).toBe('active');

    const swept = await sweepOrderLifecycle();
    expect(swept.expiredListings).toBeGreaterThanOrEqual(1);
    expect((await lotOf(listingId)).status).toBe('expired');
    // The material can be listed again.
    expect(await passportStatusOf(passportId)).toBe('active');
  });

  it('an expiry that has already passed is refused, on a new listing and on an edit (R5)', async () => {
    const yesterday = new Date(Date.now() - 24 * HOUR).toISOString();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/listings',
      headers: sellerAuth,
      payload: {
        passportId: '00000000-0000-4000-8000-000000000000',
        pricePence: 300,
        quantity: 1,
        shippingOptions: [{ method: 'collection' }],
        expiresAt: yesterday,
      },
    });
    expect(created.statusCode).toBe(400);
    const { listingId } = await newLot();
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/listings/${listingId}`,
      headers: sellerAuth,
      payload: { expiresAt: yesterday },
    });
    expect(edited.statusCode).toBe(400);
    expect((await lotOf(listingId)).expiresAt).toBeNull();
  });

  it('a listing past its date waits for its open orders before it expires', async () => {
    const { listingId } = await newLot({ quantity: 5 });
    const id = await order(listingId, 2);
    await db.update(listings).set({ expiresAt: past() }).where(eq(listings.id, listingId));

    await sweepOrderLifecycle();
    expect((await lotOf(listingId)).status).toBe('active');
    // R1: but it reads as expired, so the listing page offers no order form.
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/marketplace/listings/${listingId}`,
    });
    expect(read.json().data.status).toBe('expired');
    const hub = await app.inject({
      method: 'GET',
      url: '/api/v1/marketplace/listings/hub',
      headers: sellerAuth,
    });
    expect(hub.json().data.find((l: { id: string }) => l.id === listingId).status).toBe('expired');
    // No new orders in the meantime.
    const refused = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/offers',
      headers: buyerAuth,
      payload: { listingId, quantity: 1 },
    });
    expect(refused.statusCode).toBe(409);

    expect((await act(buyerAuth, id, { action: 'cancel' })).statusCode).toBe(200);
    await sweepOrderLifecycle();
    expect(await lotOf(listingId)).toMatchObject({ status: 'expired', quantityAvailable: 5 });
  });

  it('the Orders count says what waits for each side, and what changed since they looked', async () => {
    const fresh = await makeUser('buyer', 'fresh');
    const { listingId } = await newLot();
    const sellerBefore = await summaryOf(sellerAuth);

    const id = await order(listingId, 1, fresh);
    // A new order waits for the seller, and is new to them; not to the buyer.
    expect((await summaryOf(sellerAuth)).needsAction).toBe(sellerBefore.needsAction + 1);
    expect((await orderFor(sellerAuth, id)).isNew).toBe(true);
    expect(await summaryOf(fresh)).toMatchObject({ needsAction: 0, changed: 0, flagged: 0 });

    await act(sellerAuth, id, { action: 'accept' });
    // Accepted: it now waits for the buyer, who has not seen the change.
    expect(await summaryOf(fresh)).toMatchObject({ needsAction: 1, changed: 1 });
    expect((await orderFor(sellerAuth, id)).isNew).toBe(false);

    const seen = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/transactions/seen',
      headers: fresh,
      // As the browser sends it: a JSON request needs a body.
      payload: {},
    });
    expect(seen.statusCode).toBe(200);
    expect(await summaryOf(fresh)).toMatchObject({ needsAction: 1, changed: 0 });
  });

  it('every step of an order is recorded once', async () => {
    const { listingId } = await newLot();
    const id = await order(listingId, 1);
    await act(sellerAuth, id, { action: 'accept' });
    await act(buyerAuth, id, { action: 'confirm_delivery' });
    const events = await db.query.orderEvents.findMany({
      where: eq(orderEvents.transactionId, id),
    });
    expect(events.map((e) => `${e.fromStatus ?? '-'}>${e.toStatus}:${e.actorSide}`).sort()).toEqual(
      ['->pending:buyer', 'confirmed>completed:buyer', 'pending>confirmed:seller'],
    );
  });
});

describe('listing management', () => {
  type Auth = { authorization: string };
  let app: TestApp;
  let sellerAuth: Auth;
  let buyerAuth: Auth;
  let otherOrgAuth: Auth;
  let organisationId: string;
  let sellerId: string;
  const DAY = 24 * 60 * 60 * 1000;

  /** A lot of its own for each test, so they cannot disturb each other's stock. */
  async function newLot(over: { quantity?: number; expiresAt?: Date | null } = {}) {
    const [passport] = await db
      .insert(materialPassports)
      .values({
        organisationId,
        registeredBy: sellerId,
        productName: `Edit Lot ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        categoryL1: 'masonry',
        unitOfMeasure: 'each',
        conditionGrade: 'B',
        status: 'listed',
      })
      .returning();
    const quantity = over.quantity ?? 10;
    const [listing] = await db
      .insert(listings)
      .values({
        passportId: passport!.id,
        organisationId,
        sellerId,
        pricePence: 300,
        currency: 'GBP',
        quantity,
        quantityAvailable: quantity,
        minOrderQuantity: 1,
        shippingOptions: [{ method: 'both', notes: 'order quantity by arrangement' }],
        status: 'active',
        expiresAt: over.expiresAt ?? null,
      })
      .returning();
    return { listingId: listing!.id, passportId: passport!.id };
  }
  const lotOf = async (listingId: string) =>
    (await db.query.listings.findFirst({ where: eq(listings.id, listingId) }))!;
  const passportStatusOf = async (passportId: string) =>
    (await db.query.materialPassports.findFirst({ where: eq(materialPassports.id, passportId) }))!
      .status;
  const edit = (listingId: string, payload: Record<string, unknown>, auth: Auth = sellerAuth) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/listings/${listingId}`,
      headers: auth,
      payload,
    });
  const order = async (listingId: string, quantity: number) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplace/offers',
      headers: buyerAuth,
      payload: { listingId, quantity },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ data: { id: string; amountPence: number } }>().data;
  };
  const act = (auth: Auth, id: string, action: string) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/transactions/${id}`,
      headers: auth,
      payload: { action },
    });
  const codeOf = (res: { json: <T>() => T }) => res.json<{ error: { code: string } }>().error.code;

  beforeAll(async () => {
    app = await createTestApp();
    const org = await db.query.organisations.findFirst({
      where: eq(organisations.slug, 'stirling'),
    });
    const seller = await db.query.users.findFirst({
      where: eq(users.email, 'staff@stirlingreuse.com'),
    });
    organisationId = org!.id;
    sellerId = seller!.id;
    sellerAuth = await getAuthHeader(app, HUB_STAFF.email, HUB_STAFF.password);

    const email = `edit-buyer-${Date.now()}@example.com`;
    await db.insert(users).values({
      email,
      passwordHash: await bcrypt.hash('EditTest1234!', 10),
      name: 'Edit Buyer',
      role: 'buyer',
      organisationId: null,
    });
    buyerAuth = await getAuthHeader(app, email, 'EditTest1234!');

    // A supplier in an organisation of its own: a seller, but not of these lots.
    const [otherOrg] = await db
      .insert(organisations)
      .values({
        name: 'Other Seller Ltd',
        slug: `other-seller-${Date.now()}`,
        type: 'manufacturer',
      })
      .returning();
    const otherEmail = `edit-other-${Date.now()}@example.com`;
    await db.insert(users).values({
      email: otherEmail,
      passwordHash: await bcrypt.hash('EditTest1234!', 10),
      name: 'Other Seller',
      role: 'supplier',
      organisationId: otherOrg!.id,
    });
    otherOrgAuth = await getAuthHeader(app, otherEmail, 'EditTest1234!');
  });

  afterAll(async () => {
    await app.close();
  });

  it('changes price, minimum, shipping and expiry, and records each change before and after', async () => {
    const { listingId } = await newLot();
    const expiresAt = new Date(Date.now() + 30 * DAY);
    const res = await edit(listingId, {
      pricePence: 250,
      minOrderQuantity: 4,
      shippingOptions: [{ method: 'collection' }],
      expiresAt: expiresAt.toISOString(),
    });
    expect(res.statusCode).toBe(200);
    const now = await lotOf(listingId);
    expect(now.pricePence).toBe(250);
    expect(now.minOrderQuantity).toBe(4);
    expect(now.shippingOptions).toEqual([{ method: 'collection' }]);
    expect(now.expiresAt?.toISOString()).toBe(expiresAt.toISOString());

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, listingId));
    const changes = (event!.metadata as { changes: Record<string, { from: unknown; to: unknown }> })
      .changes;
    expect(Object.keys(changes).sort()).toEqual([
      'expiresAt',
      'minOrderQuantity',
      'pricePence',
      'shippingOptions',
    ]);
    expect(changes['pricePence']).toEqual({ from: 300, to: 250 });
    expect(changes['expiresAt']!.from).toBeNull();
  });

  it('records nothing for a field sent unchanged', async () => {
    const { listingId } = await newLot();
    expect((await edit(listingId, { pricePence: 300, quantity: 12 })).statusCode).toBe(200);
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, listingId));
    expect(Object.keys((event!.metadata as { changes: object }).changes)).toEqual(['quantity']);
  });

  it('clears an expiry date with null', async () => {
    const { listingId } = await newLot({ expiresAt: new Date(Date.now() + 10 * DAY) });
    expect((await edit(listingId, { expiresAt: null })).statusCode).toBe(200);
    expect((await lotOf(listingId)).expiresAt).toBeNull();
  });

  it('refuses another organisation, a buyer, and an anonymous caller', async () => {
    const { listingId } = await newLot();
    expect((await edit(listingId, { pricePence: 1 }, otherOrgAuth)).statusCode).toBe(403);
    expect((await edit(listingId, { pricePence: 1 }, buyerAuth)).statusCode).toBe(403);
    const anonymous = await app.inject({
      method: 'PATCH',
      url: `/api/v1/marketplace/listings/${listingId}`,
      payload: { pricePence: 1 },
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await lotOf(listingId)).pricePence).toBe(300);
  });

  it('D1: adds stock to a fully-ordered lot and puts it back on the marketplace (F6)', async () => {
    const { listingId, passportId } = await newLot({ quantity: 4 });
    await order(listingId, 4);
    expect((await lotOf(listingId)).status).toBe('reserved');
    expect(await passportStatusOf(passportId)).toBe('reserved');

    const res = await edit(listingId, { quantity: 9, pricePence: 280, minOrderQuantity: 2 });
    expect(res.statusCode).toBe(200);
    const now = await lotOf(listingId);
    expect(now).toMatchObject({ status: 'active', quantity: 9, quantityAvailable: 5 });
    expect(await passportStatusOf(passportId)).toBe('listed');
  });

  it('keeps an open order its price when the seller changes the price', async () => {
    const { listingId } = await newLot();
    const placed = await order(listingId, 2);
    expect(placed.amountPence).toBe(600);
    expect((await edit(listingId, { pricePence: 500 })).statusCode).toBe(200);
    const [tx] = await db.select().from(transactions).where(eq(transactions.id, placed.id));
    expect(tx!.amountPence).toBe(600);
  });

  it('refuses a quantity below what orders hold, and a minimum above the quantity', async () => {
    const { listingId } = await newLot();
    await order(listingId, 6);
    expect((await edit(listingId, { quantity: 5 })).statusCode).toBe(409);
    expect((await edit(listingId, { quantity: 8, minOrderQuantity: 9 })).statusCode).toBe(400);
    expect(await lotOf(listingId)).toMatchObject({ quantity: 10, quantityAvailable: 4 });
  });

  it('D2: a sold lot and a cancelled lot stay closed', async () => {
    const sold = await newLot({ quantity: 2 });
    const sale = await order(sold.listingId, 2);
    expect((await act(sellerAuth, sale.id, 'accept')).statusCode).toBe(200);
    expect((await act(buyerAuth, sale.id, 'confirm_delivery')).statusCode).toBe(200);
    expect((await lotOf(sold.listingId)).status).toBe('sold');
    expect((await edit(sold.listingId, { quantity: 5 })).statusCode).toBe(409);

    const cancelled = await newLot();
    expect((await edit(cancelled.listingId, { action: 'cancel' })).statusCode).toBe(200);
    expect((await edit(cancelled.listingId, { quantity: 5 })).statusCode).toBe(409);
  });

  it('D3: a new date or no date puts an expired lot back on sale', async () => {
    const { listingId, passportId } = await newLot({ expiresAt: new Date(Date.now() - DAY) });
    await sweepOrderLifecycle();
    expect((await lotOf(listingId)).status).toBe('expired');
    expect(await passportStatusOf(passportId)).toBe('active');

    // Changing something else leaves it expired, so it is refused.
    expect((await edit(listingId, { pricePence: 200 })).statusCode).toBe(409);

    const res = await edit(listingId, { expiresAt: new Date(Date.now() + 7 * DAY).toISOString() });
    expect(res.statusCode).toBe(200);
    expect((await lotOf(listingId)).status).toBe('active');
    expect(await passportStatusOf(passportId)).toBe('listed');

    const other = await newLot({ expiresAt: new Date(Date.now() - DAY) });
    await sweepOrderLifecycle();
    expect((await edit(other.listingId, { expiresAt: null })).statusCode).toBe(200);
    expect((await lotOf(other.listingId)).status).toBe('active');
  });

  it('D3: a lot past its date that the sweep has not yet marked revives with a new date', async () => {
    const { listingId } = await newLot({ expiresAt: new Date(Date.now() - DAY) });
    // R1: the same rule as a marked lot: without a new date it stays expired.
    expect((await edit(listingId, { pricePence: 200 })).statusCode).toBe(409);
    expect((await lotOf(listingId)).pricePence).toBe(300);
    const later = new Date(Date.now() + 3 * DAY);
    expect((await edit(listingId, { expiresAt: later.toISOString() })).statusCode).toBe(200);
    const now = await lotOf(listingId);
    expect(now.status).toBe('active');
    expect(now.expiresAt?.toISOString()).toBe(later.toISOString());
  });

  it('refuses to revive an expired lot whose material has been listed again', async () => {
    const { listingId, passportId } = await newLot({ expiresAt: new Date(Date.now() - DAY) });
    await sweepOrderLifecycle();
    // The material went on sale again in a new listing.
    await db
      .update(materialPassports)
      .set({ status: 'listed' })
      .where(eq(materialPassports.id, passportId));
    const res = await edit(listingId, { expiresAt: null });
    expect(res.statusCode).toBe(409);
    expect(codeOf(res)).toBe('MATERIAL_RELISTED');
    expect((await lotOf(listingId)).status).toBe('expired');
  });

  it('refuses an expiry date already passed', async () => {
    const { listingId } = await newLot();
    const res = await edit(listingId, { expiresAt: new Date(Date.now() - DAY).toISOString() });
    expect(res.statusCode).toBe(400);
  });
});
