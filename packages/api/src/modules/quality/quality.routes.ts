import type { FastifyInstance } from 'fastify';
import { CreateQualityReportSchema } from '@trace/core';
import { authenticate, authorize } from '../../middleware/auth.js';
import { recordAuditEvent } from '../../lib/audit.js';
import {
  createQualityReport,
  getReportsByPassport,
  getReportById,
  listInspectorReports,
  disputeReport,
} from './quality.service.js';

export async function qualityRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /api/v1/quality/reports ──────────────────────────────────────────
  // Inspector: submit a quality assessment for a passport
  app.post(
    '/reports',
    { preHandler: [authenticate, authorize('inspector', 'hub_admin', 'platform_admin')] },
    async (request, reply) => {
      const input = CreateQualityReportSchema.parse(request.body);
      const { sub: inspectorId } = request.user;

      const report = await createQualityReport(input, inspectorId);
      await recordAuditEvent({
        actor: request.user,
        action: 'quality_report.create',
        resourceType: 'quality_report',
        resourceId: report.id,
        status: 'succeeded',
        metadata: {
          passportId: report.passportId,
          overallGrade: report.overallGrade,
        },
      });
      return reply.status(201).send({ success: true, data: report });
    },
  );

  // ── GET /api/v1/quality/reports/passport/:passportId ─────────────────────
  // Public: get all quality reports for a passport
  app.get<{ Params: { passportId: string } }>(
    '/reports/passport/:passportId',
    async (request, reply) => {
      const reports = await getReportsByPassport(request.params.passportId);
      return reply.send({ success: true, data: reports });
    },
  );

  // ── GET /api/v1/quality/reports/mine ─────────────────────────────────────
  // Inspector: list own submitted reports
  app.get(
    '/reports/mine',
    { preHandler: [authenticate, authorize('inspector', 'hub_admin', 'platform_admin')] },
    async (request, reply) => {
      const { sub: inspectorId } = request.user;
      const reports = await listInspectorReports(inspectorId);
      return reply.send({ success: true, data: reports });
    },
  );

  // ── GET /api/v1/quality/reports/:id ──────────────────────────────────────
  app.get<{ Params: { id: string } }>('/reports/:id', async (request, reply) => {
    const report = await getReportById(request.params.id);
    return reply.send({ success: true, data: report });
  });

  // ── POST /api/v1/quality/reports/:id/dispute ─────────────────────────────
  // Authenticated: flag a report as disputed
  app.post<{ Params: { id: string } }>(
    '/reports/:id/dispute',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const report = await disputeReport(request.params.id);
      await recordAuditEvent({
        actor: request.user,
        action: 'quality_report.dispute',
        resourceType: 'quality_report',
        resourceId: report.id,
        status: 'succeeded',
        metadata: { passportId: report.passportId },
      });
      return reply.send({ success: true, data: report });
    },
  );
}
