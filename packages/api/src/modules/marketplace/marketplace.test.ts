import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { auditEvents, db, listings, materialPassports, organisations, users } from '@trace/db';
import { createTestApp, getAuthHeader, getTestPersona, type TestApp } from '../../test-utils.js';

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
