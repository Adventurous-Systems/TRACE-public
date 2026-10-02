import type { FastifyInstance } from 'fastify';
import { CreateQualityReportSchema, InspectionMaterialsQuerySchema } from '@trace/core';
import { authenticate, authorize } from '../../middleware/auth.js';
import { recordAuditEvent } from '../../lib/audit.js';
import {
  createQualityReport,
  getReportsByPassport,
  getReportById,
  listInspectorReports,
  listMaterialsForInspection,
  getInspectionSummary,
  disputeReport,
  type Reporter,
} from './quality.service.js';

function reporterOf(user: { sub: string; role: string; organisationId?: string | null }): Reporter {
  return { id: user.sub, role: user.role, organisationId: user.organisationId ?? null };
}

export async function qualityRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /api/v1/quality/reports ──────────────────────────────────────────
  // Inspector: submit a quality assessment for a passport
  app.post(
    '/reports',
    { preHandler: [authenticate, authorize('inspector', 'hub_admin', 'platform_admin')] },
    async (request, reply) => {
      const input = CreateQualityReportSchema.parse(request.body);
      const report = await createQualityReport(input, reporterOf(request.user));
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

  // ── GET /api/v1/quality/materials ─────────────────────────────────────────
  // The registered materials to choose from when starting a report, least
  // recently inspected first. Search by name, serial number or ID. An
  // inspector and the platform see every organisation's; a hub admin, the
  // hub's own.
  app.get(
    '/materials',
    { preHandler: [authenticate, authorize('inspector', 'hub_admin', 'platform_admin')] },
    async (request, reply) => {
      const query = InspectionMaterialsQuerySchema.parse(request.query);
      return reply.send({
        success: true,
        data: await listMaterialsForInspection(query, reporterOf(request.user)),
      });
    },
  );

  // ── GET /api/v1/quality/summary ───────────────────────────────────────────
  // Inspector: the counts on their dashboard
  app.get(
    '/summary',
    { preHandler: [authenticate, authorize('inspector', 'hub_admin', 'platform_admin')] },
    async (request, reply) => {
      return reply.send({
        success: true,
        data: await getInspectionSummary(reporterOf(request.user)),
      });
    },
  );

  // ── GET /api/v1/quality/reports/passport/:passportId ─────────────────────
  // Public: the quality reports for a passport, with each reporter's name and
  // role (never their email address or id)
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
