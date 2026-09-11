import type { FastifyInstance } from 'fastify';
import {
  AccessRequestQuerySchema,
  ApproveAccessRequestSchema,
  CreateAccessRequestSchema,
  RejectAccessRequestSchema,
  UpdateAccessRequestOrganisationSchema,
  UpdateApprovedUserAccessSchema,
  UpdatePendingAccessRequestSchema,
} from '@trace/core';
import { authenticate, authorize } from '../../middleware/auth.js';
import { recordAuditEvent } from '../../lib/audit.js';
import {
  approveAccessRequest,
  listAccessRequests,
  listAccessRequestOrganisations,
  listMyAccessRequests,
  rejectAccessRequest,
  submitAccessRequest,
  updateAccessRequestOrganisation,
  updateApprovedUserAccess,
  updatePendingAccessRequest,
} from './access-request.service.js';

export async function accessRequestRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const input = CreateAccessRequestSchema.parse(request.body);
    const created = await submitAccessRequest(request.user.sub, request.user.role, input);
    await recordAuditEvent({
      actor: request.user,
      action: 'access_request.submit',
      resourceType: 'access_request',
      resourceId: created.id,
      status: 'succeeded',
      metadata: {
        requestedRole: created.requestedRole,
        organisationName: created.organisationName,
      },
    });

    return reply.status(201).send({
      success: true,
      data: created,
    });
  });

  app.get('/mine', { preHandler: [authenticate] }, async (request, reply) => {
    const data = await listMyAccessRequests(request.user.sub);
    return reply.send({
      success: true,
      data,
    });
  });

  app.get(
    '/',
    { preHandler: [authenticate, authorize('platform_admin')] },
    async (request, reply) => {
      const query = AccessRequestQuerySchema.parse(request.query);
      const data = await listAccessRequests(query);
      return reply.send({
        success: true,
        data,
      });
    },
  );

  app.get(
    '/organisations',
    { preHandler: [authenticate, authorize('platform_admin')] },
    async (_request, reply) => {
      const data = await listAccessRequestOrganisations();
      return reply.send({
        success: true,
        data,
      });
    },
  );

  app.patch(
    '/organisations/:id',
    { preHandler: [authenticate, authorize('platform_admin')] },
    async (request, reply) => {
      const input = UpdateAccessRequestOrganisationSchema.parse(request.body);
      const params = request.params as { id: string };
      const data = await updateAccessRequestOrganisation(params.id, input);
      await recordAuditEvent({
        actor: request.user,
        action: 'organisation.update',
        resourceType: 'organisation',
        resourceId: params.id,
        status: 'succeeded',
        metadata: { name: data.name, verified: data.verified },
      });
      return reply.send({
        success: true,
        data,
      });
    },
  );

  app.patch(
    '/:id',
    { preHandler: [authenticate, authorize('platform_admin')] },
    async (request, reply) => {
      const input = UpdatePendingAccessRequestSchema.parse(request.body);
      const params = request.params as { id: string };
      const data = await updatePendingAccessRequest(params.id, input);
      await recordAuditEvent({
        actor: request.user,
        action: 'access_request.update_pending',
        resourceType: 'access_request',
        resourceId: params.id,
        status: 'succeeded',
        metadata: { requestedRole: input.requestedRole },
      });
      return reply.send({
        success: true,
        data,
      });
    },
  );

  app.post(
    '/:id/approve',
    { preHandler: [authenticate, authorize('platform_admin')] },
    async (request, reply) => {
      const input = ApproveAccessRequestSchema.parse(request.body);
      const params = request.params as { id: string };
      const data = await approveAccessRequest(params.id, request.user.sub, input);
      await recordAuditEvent({
        actor: request.user,
        action: 'access_request.approve',
        resourceType: 'access_request',
        resourceId: params.id,
        status: 'succeeded',
        metadata: {
          approvedRole: input.role,
          organisationId: input.organisationId ?? data?.targetOrganisationId ?? null,
          organisationName: input.organisationName ?? data?.targetOrganisation?.name ?? null,
        },
      });

      return reply.send({
        success: true,
        data,
      });
    },
  );

  app.patch(
    '/:id/approved-user',
    { preHandler: [authenticate, authorize('platform_admin')] },
    async (request, reply) => {
      const input = UpdateApprovedUserAccessSchema.parse(request.body);
      const params = request.params as { id: string };
      const data = await updateApprovedUserAccess(params.id, request.user.sub, input);
      await recordAuditEvent({
        actor: request.user,
        action: 'access_request.update_approved_user',
        resourceType: 'access_request',
        resourceId: params.id,
        status: 'succeeded',
        metadata: { role: input.role },
      });

      return reply.send({
        success: true,
        data,
      });
    },
  );

  app.post(
    '/:id/reject',
    { preHandler: [authenticate, authorize('platform_admin')] },
    async (request, reply) => {
      const input = RejectAccessRequestSchema.parse(request.body);
      const params = request.params as { id: string };
      const data = await rejectAccessRequest(params.id, request.user.sub, input);
      await recordAuditEvent({
        actor: request.user,
        action: 'access_request.reject',
        resourceType: 'access_request',
        resourceId: params.id,
        status: 'succeeded',
      });

      return reply.send({
        success: true,
        data,
      });
    },
  );
}
