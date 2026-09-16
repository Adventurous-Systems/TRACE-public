import type { FastifyInstance } from 'fastify';
import {
  CreateListingSchema,
  UpdateListingSchema,
  MakeOfferSchema,
  MarketplaceQuerySchema,
  UpdateTransactionSchema,
} from '@trace/core';
import { env } from '../../env.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { curatedBrowseOnly } from '../../middleware/deployment-profile.js';
import { recordAuditEvent } from '../../lib/audit.js';
import {
  createListing,
  getListingById,
  searchListings,
  getMarketplaceStats,
  getMarketplaceFacets,
  listHubListings,
  updateListing,
  cancelListing,
  makeOffer,
  updateTransaction,
  getTransactionById,
  listUserTransactions,
} from './marketplace.service.js';

export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/v1/marketplace/listings ─────────────────────────────────────
  // Public: search/browse all active listings. On the public buyer demo,
  // browse is scoped to the curated catalogue only — a visitor's own
  // listings stay in their seller dashboard (getListingById, listHubListings)
  // and never enter the public marketplace, since the demo host retains
  // visitor data indefinitely with no sweep. See curatedBrowseOnly.
  app.get('/listings', async (request, reply) => {
    const query = MarketplaceQuerySchema.parse(request.query);
    const result = await searchListings(query, {
      curatedOnly: curatedBrowseOnly(env.TRACE_DEPLOYMENT_PROFILE),
    });
    return reply.send({ success: true, data: result });
  });

  // ── GET /api/v1/marketplace/stats ─────────────────────────────────────────
  // Public: aggregate impact (carbon saved + active listing count)
  app.get('/stats', async (_request, reply) => {
    const stats = await getMarketplaceStats({
      curatedOnly: curatedBrowseOnly(env.TRACE_DEPLOYMENT_PROFILE),
    });
    return reply.send({ success: true, data: stats });
  });

  // ── GET /api/v1/marketplace/facets ────────────────────────────────────────
  // Public: category/grade values browse can actually return, so the filter
  // UI never offers an option that would return zero results. Reuses the same
  // curatedOnly scoping as /listings and /stats — see getMarketplaceFacets.
  app.get('/facets', async (_request, reply) => {
    const facets = await getMarketplaceFacets({
      curatedOnly: curatedBrowseOnly(env.TRACE_DEPLOYMENT_PROFILE),
    });
    return reply.send({ success: true, data: facets });
  });

  // ── POST /api/v1/marketplace/listings ─────────────────────────────────────
  // Hub staff/admin: create a listing for a passport
  app.post(
    '/listings',
    {
      preHandler: [authenticate, authorize('hub_staff', 'hub_admin', 'platform_admin', 'supplier')],
    },
    async (request, reply) => {
      const input = CreateListingSchema.parse(request.body);
      const { sub: userId, organisationId } = request.user;

      if (!organisationId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'NO_ORGANISATION',
            message: 'User is not associated with an organisation',
          },
        });
      }

      const listing = await createListing(input, userId, organisationId);
      await recordAuditEvent({
        actor: request.user,
        action: 'listing.create',
        resourceType: 'listing',
        resourceId: listing.id,
        status: 'succeeded',
        metadata: {
          passportId: listing.passportId,
          pricePence: listing.pricePence,
          quantity: listing.quantity,
        },
      });
      return reply.status(201).send({ success: true, data: listing });
    },
  );

  // ── GET /api/v1/marketplace/listings/hub ──────────────────────────────────
  // Hub staff: view own hub's listings (all statuses)
  app.get(
    '/listings/hub',
    {
      preHandler: [authenticate, authorize('hub_staff', 'hub_admin', 'platform_admin', 'supplier')],
    },
    async (request, reply) => {
      const { organisationId } = request.user;

      if (!organisationId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'NO_ORGANISATION',
            message: 'User is not associated with an organisation',
          },
        });
      }

      const data = await listHubListings(organisationId);
      return reply.send({ success: true, data });
    },
  );

  // ── GET /api/v1/marketplace/listings/:id ──────────────────────────────────
  app.get<{ Params: { id: string } }>('/listings/:id', async (request, reply) => {
    const listing = await getListingById(request.params.id);
    return reply.send({ success: true, data: listing });
  });

  // ── PATCH /api/v1/marketplace/listings/:id ────────────────────────────────
  // Hub staff: update price/quantity/shipping, or cancel
  app.patch<{ Params: { id: string } }>(
    '/listings/:id',
    {
      preHandler: [authenticate, authorize('hub_staff', 'hub_admin', 'platform_admin', 'supplier')],
    },
    async (request, reply) => {
      const { organisationId } = request.user;

      if (!organisationId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'NO_ORGANISATION',
            message: 'User is not associated with an organisation',
          },
        });
      }

      // Check if this is a cancel action
      const body = request.body as Record<string, unknown>;
      if (body['action'] === 'cancel') {
        const listing = await cancelListing(request.params.id, organisationId);
        await recordAuditEvent({
          actor: request.user,
          action: 'listing.cancel',
          resourceType: 'listing',
          resourceId: listing.id,
          status: 'succeeded',
          metadata: { passportId: listing.passportId },
        });
        return reply.send({ success: true, data: listing });
      }

      const input = UpdateListingSchema.parse(request.body);
      const listing = await updateListing(request.params.id, input, organisationId);
      await recordAuditEvent({
        actor: request.user,
        action: 'listing.update',
        resourceType: 'listing',
        resourceId: listing.id,
        status: 'succeeded',
        metadata: { passportId: listing.passportId },
      });
      return reply.send({ success: true, data: listing });
    },
  );

  // ── POST /api/v1/marketplace/offers ───────────────────────────────────────
  // Buyer: make an offer on a listing (creates a transaction)
  app.post(
    '/offers',
    {
      preHandler: [
        authenticate,
        authorize('buyer', 'supplier', 'hub_staff', 'hub_admin', 'platform_admin'),
      ],
    },
    async (request, reply) => {
      const input = MakeOfferSchema.parse(request.body);
      const { sub: buyerId } = request.user;

      const tx = await makeOffer(input, buyerId);
      await recordAuditEvent({
        actor: request.user,
        action: 'marketplace.offer',
        resourceType: 'transaction',
        resourceId: tx.id,
        status: 'succeeded',
        metadata: {
          listingId: tx.listingId,
          amountPence: tx.amountPence,
          buyerModel: request.user.organisationId ? 'organisation_user' : 'walletless_buyer',
        },
      });
      return reply.status(201).send({ success: true, data: tx });
    },
  );

  // ── GET /api/v1/marketplace/transactions ──────────────────────────────────
  // Authenticated: list own transactions (as buyer or seller)
  app.get('/transactions', { preHandler: [authenticate] }, async (request, reply) => {
    const { sub: userId } = request.user;
    const data = await listUserTransactions(userId);
    return reply.send({ success: true, data });
  });

  // ── GET /api/v1/marketplace/transactions/:id ──────────────────────────────
  // Scoped to the buyer, the seller, or a platform admin — see D-03.
  app.get<{ Params: { id: string } }>(
    '/transactions/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { sub: userId, role } = request.user;
      const tx = await getTransactionById(request.params.id, userId, role);
      return reply.send({ success: true, data: tx });
    },
  );

  // ── PATCH /api/v1/marketplace/transactions/:id ────────────────────────────
  // Buyer/seller: confirm_delivery | flag_dispute | cancel
  // Platform admin only: resolve_dispute — see D-03
  app.patch<{ Params: { id: string } }>(
    '/transactions/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const input = UpdateTransactionSchema.parse(request.body);
      const { sub: userId, role } = request.user;

      const tx = await updateTransaction(request.params.id, input, userId, role);
      await recordAuditEvent({
        actor: request.user,
        action: `marketplace.transaction.${input.action}`,
        resourceType: 'transaction',
        resourceId: tx.id,
        status: 'succeeded',
        metadata: {
          listingId: tx.listingId,
          transactionStatus: tx.status,
        },
      });
      return reply.send({ success: true, data: tx });
    },
  );
}
