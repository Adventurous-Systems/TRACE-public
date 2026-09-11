import type { FastifyInstance } from 'fastify';
import { authenticate, authorize } from '../../middleware/auth.js';
import { CreateProposalSchema, CastVoteSchema, GovernanceQuerySchema } from '@trace/core';
import {
  createProposal,
  listProposals,
  getProposalById,
  castVote,
  cancelProposal,
  finalizeProposal,
} from './governance.service.js';

export async function governanceRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/v1/governance/proposals ─────────────────────────────────────
  app.get('/proposals', async (request, reply) => {
    const query = GovernanceQuerySchema.parse(request.query);
    const result = await listProposals(query);
    return reply.send({ success: true, data: result });
  });

  // ── POST /api/v1/governance/proposals ────────────────────────────────────
  app.post('/proposals', { preHandler: [authenticate] }, async (request, reply) => {
    const input = CreateProposalSchema.parse(request.body);
    const { sub: creatorId, organisationId } = request.user;
    const proposal = await createProposal(input, creatorId, organisationId ?? null);
    return reply.status(201).send({ success: true, data: proposal });
  });

  // ── GET /api/v1/governance/proposals/:id ─────────────────────────────────
  app.get<{ Params: { id: string } }>('/proposals/:id', async (request, reply) => {
    const proposal = await getProposalById(request.params.id);
    return reply.send({ success: true, data: proposal });
  });

  // ── POST /api/v1/governance/proposals/:id/vote ───────────────────────────
  app.post<{ Params: { id: string } }>(
    '/proposals/:id/vote',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { support } = CastVoteSchema.omit({ proposalId: true }).parse(request.body);
      const voterId = request.user.sub;
      const vote = await castVote(request.params.id, voterId, support);
      return reply.status(201).send({ success: true, data: vote });
    },
  );

  // ── POST /api/v1/governance/proposals/:id/cancel ─────────────────────────
  app.post<{ Params: { id: string } }>(
    '/proposals/:id/cancel',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { sub: userId, role } = request.user;
      const isAdmin = role === 'platform_admin' || role === 'hub_admin';
      await cancelProposal(request.params.id, userId, isAdmin);
      return reply.send({ success: true, data: { message: 'Proposal cancelled' } });
    },
  );

  // ── POST /api/v1/governance/proposals/:id/finalize ───────────────────────
  app.post<{ Params: { id: string } }>(
    '/proposals/:id/finalize',
    { preHandler: [authenticate, authorize('platform_admin')] },
    async (request, reply) => {
      const result = await finalizeProposal(request.params.id);
      return reply.send({ success: true, data: result });
    },
  );
}
