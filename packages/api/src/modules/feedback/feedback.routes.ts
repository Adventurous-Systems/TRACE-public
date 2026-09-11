import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { authenticate, authorize } from '../../middleware/auth.js';
import { submitFeedback, listFeedback } from './feedback.service.js';

const SubmitFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  category: z.enum(['bug', 'ux', 'feature', 'general']),
  message: z.string().min(1).max(2000),
  pageUrl: z.string().url().optional(),
});

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /api/v1/feedback ─────────────────────────────────────────────────
  // Public — attaches user_id if a valid JWT is present
  app.post('/', async (request, reply) => {
    const input = SubmitFeedbackSchema.parse(request.body);

    let userId: string | undefined;
    try {
      await request.jwtVerify();
      userId = request.user.sub;
    } catch {
      // unauthenticated — still accept feedback
    }

    const submission = await submitFeedback(
      {
        rating: input.rating,
        category: input.category,
        message: input.message,
        ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
      },
      userId,
    );
    return reply.status(201).send({ success: true, data: submission });
  });

  // ── GET /api/v1/feedback ──────────────────────────────────────────────────
  // Admin only — list all feedback submissions
  app.get(
    '/',
    { preHandler: [authenticate, authorize('platform_admin', 'hub_admin')] },
    async (_request, reply) => {
      const items = await listFeedback();
      return reply.send({ success: true, data: items });
    },
  );
}
