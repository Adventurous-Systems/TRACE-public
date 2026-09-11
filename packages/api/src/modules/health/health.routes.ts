import type { FastifyInstance } from 'fastify';
import { db } from '@trace/db';
import { sql } from 'drizzle-orm';
import { env } from '../../env.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_request, reply) => {
    let dbOk = false;

    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      // DB unreachable — return degraded state, do not throw
    }

    return reply.status(dbOk ? 200 : 503).send({
      success: dbOk,
      data: {
        status: dbOk ? 'ok' : 'degraded',
        db: dbOk,
        // Which trust story this deployment is telling. DEMO_SIMULATE_ANCHOR
        // lives only in the deployment's .env, which is not version-controlled,
        // so a rebuilt .env can silently turn every new passport's "Trust layer
        // prepared" seal into a permanent "Pending verification". Reporting it
        // makes that visible instead of mysterious.
        //   'simulated' — real keccak256 fingerprint, no chain transaction
        //   'onchain'   — anchored via MATERIAL_REGISTRY_ADDRESS
        anchorMode: env.DEMO_SIMULATE_ANCHOR ? 'simulated' : 'onchain',
        anchoringConfigured: Boolean(env.MATERIAL_REGISTRY_ADDRESS),
        timestamp: new Date().toISOString(),
      },
    });
  });
}
