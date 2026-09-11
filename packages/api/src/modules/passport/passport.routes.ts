import type { FastifyInstance } from 'fastify';
import { CreatePassportSchema, UpdatePassportSchema, PassportQuerySchema } from '@trace/core';
import { authenticate, authorize } from '../../middleware/auth.js';
import { recordAuditEvent } from '../../lib/audit.js';
import {
  createPassport,
  getPassportById,
  listPassports,
  updatePassport,
  verifyPassport,
  verifyPassportIntegrity,
  getPassportHistory,
  uploadPassportPhoto,
  getPassportCertificate,
} from './passport.service.js';

export async function passportRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /api/v1/passports ────────────────────────────────────────────────
  // Hub staff / admin creates a new material passport
  app.post(
    '/',
    {
      preHandler: [authenticate, authorize('hub_staff', 'hub_admin', 'platform_admin', 'supplier')],
    },
    async (request, reply) => {
      const input = CreatePassportSchema.parse(request.body);
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

      const passport = await createPassport(input, userId, organisationId);
      await recordAuditEvent({
        actor: request.user,
        action: 'passport.create',
        resourceType: 'passport',
        resourceId: passport.id,
        status: 'succeeded',
        metadata: { productName: passport.productName, status: passport.status },
      });
      return reply.status(201).send({ success: true, data: passport });
    },
  );

  // ── GET /api/v1/passports ─────────────────────────────────────────────────
  // List passports for the authenticated user's organisation
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const query = PassportQuerySchema.parse(request.query);
    const { organisationId } = request.user;

    if (!organisationId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_ORGANISATION', message: 'User is not associated with an organisation' },
      });
    }

    const result = await listPassports(query, organisationId);
    return reply.send({ success: true, data: result });
  });

  // ── GET /api/v1/passports/:id ─────────────────────────────────────────────
  // Public — anyone can view an active passport (drafts require org membership)
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    // Optionally extract user if authenticated
    let requestingOrgId: string | undefined;
    try {
      await request.jwtVerify();
      requestingOrgId = request.user.organisationId;
    } catch {
      // unauthenticated — that's fine for public passports
    }

    const passport = await getPassportById(request.params.id, requestingOrgId);
    return reply.send({ success: true, data: passport });
  });

  // ── PATCH /api/v1/passports/:id ───────────────────────────────────────────
  app.patch<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [authenticate, authorize('hub_staff', 'hub_admin', 'platform_admin', 'supplier')],
    },
    async (request, reply) => {
      const input = UpdatePassportSchema.parse(request.body);
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

      const passport = await updatePassport(request.params.id, input, userId, organisationId);
      await recordAuditEvent({
        actor: request.user,
        action: 'passport.update',
        resourceType: 'passport',
        resourceId: passport.id,
        status: 'succeeded',
        metadata: { productName: passport.productName, status: passport.status },
      });
      return reply.send({ success: true, data: passport });
    },
  );

  // ── GET /api/v1/passports/:id/verify ─────────────────────────────────────
  // Public — returns passport with blockchain verification status
  app.get<{ Params: { id: string } }>('/:id/verify', async (request, reply) => {
    const passport = await verifyPassport(request.params.id);
    return reply.send({ success: true, data: passport });
  });

  // ── GET /api/v1/passports/:id/verify-integrity ────────────────────────────
  // Public — recompute the canonical fingerprint and compare to the stored one
  app.get<{ Params: { id: string } }>('/:id/verify-integrity', async (request, reply) => {
    const result = await verifyPassportIntegrity(request.params.id);
    return reply.send({ success: true, data: result });
  });

  // ── GET /api/v1/passports/:id/certificate ────────────────────────────────
  // Public — certificate-oriented blockchain verification metadata
  app.get<{ Params: { id: string } }>('/:id/certificate', async (request, reply) => {
    const certificate = await getPassportCertificate(request.params.id);
    return reply.send({ success: true, data: certificate });
  });

  // ── GET /api/v1/passports/:id/history ────────────────────────────────────
  // EPCIS event history for a passport
  app.get<{ Params: { id: string } }>('/:id/history', async (request, reply) => {
    const events = await getPassportHistory(request.params.id);
    return reply.send({ success: true, data: events });
  });

  // ── POST /api/v1/passports/:id/photos ────────────────────────────────────
  // Upload a condition photo for a passport (multipart/form-data, field: "file")
  app.post<{ Params: { id: string } }>(
    '/:id/photos',
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

      const file = await request.file();
      if (!file) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_FILE', message: 'No file provided' },
        });
      }

      // Broad gate; the service re-encodes everything to JPEG via sharp (which is the
      // real validator). Some mobile browsers send HEIC as image/heif or with a generic
      // application/octet-stream type, so accept those too.
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
        'application/octet-stream',
      ];
      if (!allowedTypes.includes(file.mimetype)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_TYPE',
            message: 'Only JPEG, PNG, WebP, and HEIC images are allowed',
          },
        });
      }

      const buffer = await file.toBuffer();
      const passport = await uploadPassportPhoto(
        request.params.id,
        buffer,
        file.mimetype,
        organisationId,
      );
      return reply.send({ success: true, data: passport });
    },
  );
}
