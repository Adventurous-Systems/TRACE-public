import type { FastifyRequest, FastifyReply } from 'fastify';
import { ForbiddenError } from '@trace/core';

/**
 * Ensures request.user has an organisationId.
 * Used for routes that operate on hub-specific data.
 * Must be used after `authenticate`.
 */
export async function requireTenant(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user?.organisationId) {
    throw new ForbiddenError('This action requires an organisation context');
  }
}
