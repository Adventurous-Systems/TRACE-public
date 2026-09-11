import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import {
  auditEvents,
  blockchainTransactions,
  db,
  type AuditEvent,
  type BlockchainTransaction,
} from '@trace/db';
import { createLogger } from '@trace/core';

const logger = createLogger('audit');

export type AuditStatus = 'attempted' | 'succeeded' | 'failed';
export type BlockchainTxStatus = 'pending' | 'submitted' | 'succeeded' | 'failed';

export interface AuditActor {
  id?: string | null;
  sub?: string | null;
  role?: string | null;
  email?: string | null;
  organisationId?: string | null;
}

interface AuditTarget {
  action: string;
  resourceType: string;
  resourceId?: string | null | undefined;
}

const auditedFailureRequests = new WeakSet<FastifyRequest>();

function pathWithoutQuery(request: FastifyRequest): string {
  return request.url.split('?')[0] ?? request.url;
}

function paramsFor(request: FastifyRequest): { id?: string; passportId?: string } {
  return (request.params ?? {}) as { id?: string; passportId?: string };
}

function mutationAuditTarget(request: FastifyRequest): AuditTarget | null {
  const method = request.method.toUpperCase();
  const path = pathWithoutQuery(request);
  const params = paramsFor(request);

  if (method === 'POST' && path === '/api/v1/passports') {
    return { action: 'passport.create', resourceType: 'passport' };
  }
  if (method === 'PATCH' && path.startsWith('/api/v1/passports/')) {
    return { action: 'passport.update', resourceType: 'passport', resourceId: params.id };
  }
  if (method === 'POST' && path === '/api/v1/access-requests') {
    return { action: 'access_request.submit', resourceType: 'access_request' };
  }
  if (method === 'PATCH' && path.startsWith('/api/v1/access-requests/organisations/')) {
    return { action: 'organisation.update', resourceType: 'organisation', resourceId: params.id };
  }
  if (method === 'PATCH' && path.endsWith('/approved-user')) {
    return {
      action: 'access_request.update_approved_user',
      resourceType: 'access_request',
      resourceId: params.id,
    };
  }
  if (method === 'PATCH' && path.startsWith('/api/v1/access-requests/')) {
    return {
      action: 'access_request.update_pending',
      resourceType: 'access_request',
      resourceId: params.id,
    };
  }
  if (method === 'POST' && path.endsWith('/approve')) {
    return {
      action: 'access_request.approve',
      resourceType: 'access_request',
      resourceId: params.id,
    };
  }
  if (method === 'POST' && path.endsWith('/reject')) {
    return {
      action: 'access_request.reject',
      resourceType: 'access_request',
      resourceId: params.id,
    };
  }
  if (method === 'POST' && path === '/api/v1/marketplace/listings') {
    return { action: 'listing.create', resourceType: 'listing' };
  }
  if (method === 'PATCH' && path.startsWith('/api/v1/marketplace/listings/')) {
    return { action: 'listing.update', resourceType: 'listing', resourceId: params.id };
  }
  if (method === 'POST' && path === '/api/v1/marketplace/offers') {
    return { action: 'marketplace.offer', resourceType: 'transaction' };
  }
  if (method === 'PATCH' && path.startsWith('/api/v1/marketplace/transactions/')) {
    return {
      action: 'marketplace.transaction.update',
      resourceType: 'transaction',
      resourceId: params.id,
    };
  }
  if (method === 'POST' && path === '/api/v1/quality/reports') {
    return { action: 'quality_report.create', resourceType: 'quality_report' };
  }
  if (method === 'POST' && path.endsWith('/dispute')) {
    return {
      action: 'quality_report.dispute',
      resourceType: 'quality_report',
      resourceId: params.id,
    };
  }

  return null;
}

function requestOrigin(request: FastifyRequest): string {
  const origin = request.headers.origin;
  const referer = request.headers.referer;
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof origin === 'string' && origin) return origin;
  if (typeof referer === 'string' && referer) return referer;
  if (typeof forwardedFor === 'string' && forwardedFor)
    return forwardedFor.split(',')[0]?.trim() ?? request.ip;
  return request.ip;
}

async function recordFailureForRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  failureReason: string,
  statusCode: number,
): Promise<void> {
  const target = mutationAuditTarget(request);
  if (!target) return;

  await recordAuditEvent({
    actor: request.user as AuditActor | undefined,
    action: target.action,
    resourceType: target.resourceType,
    resourceId: target.resourceId,
    status: 'failed',
    failureReason,
    origin: requestOrigin(request),
    metadata: {
      method: request.method,
      url: request.url,
      routePath: request.routeOptions.url,
      statusCode,
      userAgent: request.headers['user-agent'] ?? null,
      replyStatusCode: reply.statusCode,
    },
  });
}

export async function recordAuditEvent(input: {
  actor?: AuditActor | null | undefined;
  action: string;
  resourceType: string;
  resourceId?: string | null | undefined;
  status: AuditStatus;
  failureReason?: string | null | undefined;
  origin?: string | null | undefined;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      actorId: input.actor?.id ?? input.actor?.sub ?? null,
      actorRole: input.actor?.role ?? null,
      actorEmail: input.actor?.email ?? null,
      organisationId: input.actor?.organisationId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      status: input.status,
      failureReason: input.failureReason ?? null,
      origin: input.origin ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    logger.error(
      { err, action: input.action, resourceId: input.resourceId },
      'Failed to write audit event',
    );
  }
}

export function registerAuditFailureHooks(app: FastifyInstance): void {
  app.addHook('onError', async (request, reply, error) => {
    if (auditedFailureRequests.has(request)) return;
    auditedFailureRequests.add(request);
    await recordFailureForRequest(
      request,
      reply,
      error.message,
      error.statusCode ?? reply.statusCode ?? 500,
    );
  });

  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode < 400 || auditedFailureRequests.has(request)) return;
    auditedFailureRequests.add(request);
    await recordFailureForRequest(request, reply, `HTTP ${reply.statusCode}`, reply.statusCode);
  });
}

export async function createBlockchainTransaction(input: {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  organisationId?: string | null;
  actorId?: string | null;
  originAddress?: string | null;
  gasPayerAddress?: string | null;
  contractAddress?: string | null;
  gasLimit?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<BlockchainTransaction | null> {
  try {
    const [row] = await db
      .insert(blockchainTransactions)
      .values({
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        organisationId: input.organisationId ?? null,
        actorId: input.actorId ?? null,
        originAddress: input.originAddress ?? null,
        gasPayerAddress: input.gasPayerAddress ?? null,
        contractAddress: input.contractAddress ?? null,
        gasLimit: input.gasLimit ?? null,
        metadata: input.metadata ?? {},
        status: 'pending',
      })
      .returning();
    return row ?? null;
  } catch (err) {
    logger.error(
      { err, action: input.action, resourceId: input.resourceId },
      'Failed to create blockchain transaction log',
    );
    return null;
  }
}

export async function updateBlockchainTransaction(
  id: string,
  update: {
    txHash?: string | null;
    status?: BlockchainTxStatus;
    originAddress?: string | null;
    gasPayerAddress?: string | null;
    gasLimit?: number | null;
    gasUsed?: number | null;
    vthoPaidWei?: string | null;
    blockNumber?: number | null;
    blockId?: string | null;
    failureReason?: string | null;
    metadata?: Record<string, unknown>;
    submittedAt?: Date | null;
    confirmedAt?: Date | null;
  },
): Promise<void> {
  try {
    await db
      .update(blockchainTransactions)
      .set({
        ...update,
        updatedAt: new Date(),
      })
      .where(eq(blockchainTransactions.id, id));
  } catch (err) {
    logger.error({ err, id }, 'Failed to update blockchain transaction log');
  }
}

export async function listRecentAuditEvents(limit = 50): Promise<AuditEvent[]> {
  return db.query.auditEvents.findMany({
    orderBy: [desc(auditEvents.createdAt)],
    limit,
  });
}

export async function listRecentBlockchainTransactions(
  limit = 50,
): Promise<BlockchainTransaction[]> {
  return db.query.blockchainTransactions.findMany({
    orderBy: [desc(blockchainTransactions.createdAt)],
    limit,
  });
}
