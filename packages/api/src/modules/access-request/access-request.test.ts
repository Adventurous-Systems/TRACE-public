import bcrypt from 'bcryptjs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { auditEvents, db, organisations, users } from '@trace/db';
import { createTestApp, getAuthHeader, type TestApp } from '../../test-utils.js';

describe('access request flow', () => {
  let app: TestApp;
  let buyerAuth: { authorization: string };
  let platformAdminAuth: { authorization: string };
  let organisationId: string;
  let buyerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const buyerEmail = `buyer-access-${Date.now()}@example.com`;
    const buyerPassword = 'UnitTestBuyerOnly!';
    const [buyer] = await db
      .insert(users)
      .values({
        email: buyerEmail,
        passwordHash: await bcrypt.hash(buyerPassword, 10),
        name: 'Buyer Access',
        role: 'buyer',
        organisationId: null,
      })
      .returning();
    buyerId = buyer!.id;
    buyerAuth = await getAuthHeader(app, buyerEmail, buyerPassword);

    const organisation = await db.query.organisations.findFirst({
      where: eq(organisations.slug, 'stirling'),
    });
    organisationId = organisation!.id;

    const email = `platform-admin-${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('UnitTestPlatformOnly!', 10);
    await db.insert(users).values({
      email,
      passwordHash,
      name: 'Platform Admin',
      role: 'platform_admin',
      organisationId: null,
    });

    platformAdminAuth = await getAuthHeader(app, email, 'UnitTestPlatformOnly!');
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows a buyer to submit an access request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/access-requests',
      headers: buyerAuth,
      payload: {
        requestedRole: 'hub_staff',
        organisationName: 'Stirling Reuse Hub',
        notes: 'Beta seller testing',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ success: boolean; data: { status: string; requestedRole: string } }>();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('pending');
    expect(body.data.requestedRole).toBe('hub_staff');
  });

  it('logs failed access request attempts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/access-requests',
      headers: { ...buyerAuth, origin: 'https://trace.test' },
      payload: {
        requestedRole: 'hub_staff',
        organisationName: 'Stirling Reuse Hub',
        notes: 'Duplicate pending request',
      },
    });

    expect(res.statusCode).toBe(409);

    const event = await db.query.auditEvents.findFirst({
      where: and(
        eq(auditEvents.action, 'access_request.submit'),
        eq(auditEvents.actorId, buyerId),
        eq(auditEvents.status, 'failed'),
      ),
      orderBy: [desc(auditEvents.createdAt)],
    });
    expect(event?.failureReason).toContain('pending access request');
    expect(event?.origin).toBe('https://trace.test');
  });

  it('lists a buyer request in /mine', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/access-requests/mine',
      headers: buyerAuth,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: Array<{ status: string }> }>();
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]?.status).toBe('pending');
  });

  it('allows a platform admin to approve a pending request', async () => {
    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/access-requests?status=pending',
      headers: platformAdminAuth,
    });

    expect(pending.statusCode).toBe(200);
    const pendingBody = pending.json<{ data: Array<{ id: string; userId: string }> }>();
    const request = pendingBody.data.find((item) => item.userId);
    expect(request).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/access-requests/${request!.id}/approve`,
      headers: platformAdminAuth,
      payload: {
        role: 'hub_staff',
        organisationId,
        reviewNotes: 'Approved for beta hub testing',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      data: {
        status: string;
        targetOrganisationId: string | null;
        user: { role: string; organisationId: string | null };
      };
    }>();

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('approved');
    expect(body.data.targetOrganisationId).toBe(organisationId);
    expect(body.data.user.role).toBe('hub_staff');
    expect(body.data.user.organisationId).toBe(organisationId);
    expect(JSON.stringify(body.data)).not.toContain('blockchainPrivateKeyEnc');
  });

  it('allows a platform admin to edit a pending request before review', async () => {
    const buyerEmail = `buyer-edit-${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('BuyerEdit123!', 10);
    await db.insert(users).values({
      email: buyerEmail,
      passwordHash,
      name: 'Buyer Edit',
      role: 'buyer',
      organisationId: null,
    });

    const buyerAuth = await getAuthHeader(app, buyerEmail, 'BuyerEdit123!');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/access-requests',
      headers: buyerAuth,
      payload: {
        requestedRole: 'hub_staff',
        organisationName: 'Old Hub Name',
        notes: 'Old request notes',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ data: { id: string } }>();

    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/access-requests/${created.data.id}`,
      headers: platformAdminAuth,
      payload: {
        requestedRole: 'hub_admin',
        organisationName: 'Updated Hub Name',
        notes: 'Updated request notes',
        reviewNotes: 'Admin updated before approval',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const body = updateRes.json<{
      success: boolean;
      data: {
        requestedRole: string;
        organisationName: string | null;
        notes: string | null;
        reviewNotes: string | null;
      };
    }>();
    expect(body.success).toBe(true);
    expect(body.data.requestedRole).toBe('hub_admin');
    expect(body.data.organisationName).toBe('Updated Hub Name');
    expect(body.data.notes).toBe('Updated request notes');
    expect(body.data.reviewNotes).toBe('Admin updated before approval');
  });

  it('allows a platform admin to reject a pending request', async () => {
    const buyerEmail = `buyer-reject-${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('BuyerReject123!', 10);
    const [buyer] = await db
      .insert(users)
      .values({
        email: buyerEmail,
        passwordHash,
        name: 'Buyer Reject',
        role: 'buyer',
        organisationId: null,
      })
      .returning();

    const rejectBuyerAuth = await getAuthHeader(app, buyerEmail, 'BuyerReject123!');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/access-requests',
      headers: rejectBuyerAuth,
      payload: {
        requestedRole: 'hub_admin',
        organisationName: 'Another Hub',
        notes: 'Need review',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ data: { id: string } }>();

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/access-requests/${created.data.id}/reject`,
      headers: platformAdminAuth,
      payload: {
        reviewNotes: 'Not enough information yet',
      },
    });

    expect(rejectRes.statusCode).toBe(200);
    const body = rejectRes.json<{
      success: boolean;
      data: { status: string; reviewNotes: string | null };
    }>();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('rejected');
    expect(body.data.reviewNotes).toBe('Not enough information yet');

    const unchangedBuyer = await db.query.users.findFirst({
      where: eq(users.id, buyer!.id),
    });
    expect(unchangedBuyer?.role).toBe('buyer');
    expect(unchangedBuyer?.organisationId).toBeNull();
  });

  it('creates a new organisation from the requested name when approving without an existing organisation id', async () => {
    const buyerEmail = `buyer-new-org-${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('BuyerNewOrg123!', 10);
    const [buyer] = await db
      .insert(users)
      .values({
        email: buyerEmail,
        passwordHash,
        name: 'Buyer New Org',
        role: 'buyer',
        organisationId: null,
      })
      .returning();

    const buyerAuth = await getAuthHeader(app, buyerEmail, 'BuyerNewOrg123!');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/access-requests',
      headers: buyerAuth,
      payload: {
        requestedRole: 'hub_staff',
        organisationName: 'New Beta Reuse Hub',
        notes: 'Please create this hub for testing',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ data: { id: string } }>();

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/access-requests/${created.data.id}/approve`,
      headers: platformAdminAuth,
      payload: {
        role: 'hub_staff',
        organisationName: 'New Beta Reuse Hub',
        reviewNotes: 'Approved and created a new hub',
      },
    });

    expect(approveRes.statusCode).toBe(200);
    const body = approveRes.json<{
      success: boolean;
      data: { status: string; targetOrganisationId: string | null };
    }>();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('approved');
    expect(body.data.targetOrganisationId).toBeTruthy();

    const createdOrganisation = await db.query.organisations.findFirst({
      where: eq(organisations.name, 'New Beta Reuse Hub'),
    });
    expect(createdOrganisation).toBeTruthy();
    expect(createdOrganisation?.type).toBe('hub');

    const updatedBuyer = await db.query.users.findFirst({
      where: eq(users.id, buyer!.id),
    });
    expect(updatedBuyer?.role).toBe('hub_staff');
    expect(updatedBuyer?.organisationId).toBe(createdOrganisation?.id);
  });

  it('allows a platform admin to update approved user access and revoke back to buyer', async () => {
    const buyerEmail = `buyer-approved-${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('BuyerApproved123!', 10);
    const [buyer] = await db
      .insert(users)
      .values({
        email: buyerEmail,
        passwordHash,
        name: 'Buyer Approved',
        role: 'buyer',
        organisationId: null,
      })
      .returning();

    const buyerAuth = await getAuthHeader(app, buyerEmail, 'BuyerApproved123!');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/access-requests',
      headers: buyerAuth,
      payload: {
        requestedRole: 'hub_staff',
        organisationName: 'Approved Hub',
        notes: 'Initial approval request',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ data: { id: string } }>();

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/access-requests/${created.data.id}/approve`,
      headers: platformAdminAuth,
      payload: {
        role: 'hub_staff',
        organisationId,
      },
    });
    expect(approveRes.statusCode).toBe(200);

    const updateApproved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/access-requests/${created.data.id}/approved-user`,
      headers: platformAdminAuth,
      payload: {
        role: 'hub_admin',
        organisationName: 'Moved Hub Name',
        reviewNotes: 'Moved to a new hub and elevated role',
      },
    });
    expect(updateApproved.statusCode).toBe(200);
    const updatedBody = updateApproved.json<{
      data: {
        user: { role: string; organisationId: string | null } | null;
        targetOrganisation: { name: string } | null;
      };
    }>();
    expect(updatedBody.data.user?.role).toBe('hub_admin');
    expect(updatedBody.data.targetOrganisation?.name).toBe('Moved Hub Name');

    const revokeRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/access-requests/${created.data.id}/approved-user`,
      headers: platformAdminAuth,
      payload: {
        role: 'buyer',
        reviewNotes: 'Revoked back to buyer',
      },
    });
    expect(revokeRes.statusCode).toBe(200);

    const revokedBuyer = await db.query.users.findFirst({
      where: eq(users.id, buyer!.id),
    });
    expect(revokedBuyer?.role).toBe('buyer');
    expect(revokedBuyer?.organisationId).toBeNull();
  });

  it('allows a platform admin to rename and verify an organisation', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/access-requests/organisations/${organisationId}`,
      headers: platformAdminAuth,
      payload: {
        name: 'Stirling Reuse Hub Updated',
        verified: false,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: { name: string; verified: boolean } }>();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Stirling Reuse Hub Updated');
    expect(body.data.verified).toBe(false);

    await db
      .update(organisations)
      .set({ name: 'Stirling Reuse Hub', verified: true })
      .where(eq(organisations.id, organisationId));
  });
});
