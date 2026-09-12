import type { FastifyInstance } from 'fastify';
import { db } from '@trace/db';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { env } from '../../env.js';
import { minioClient } from '../../lib/storage.js';

async function checkDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1500,
    commandTimeout: 1500,
    maxRetriesPerRequest: 1,
  });
  redis.on('error', () => undefined);

  try {
    await redis.connect();
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

async function checkMinio(): Promise<boolean> {
  try {
    const results = await Promise.all([
      minioClient.bucketExists(env.MINIO_BUCKET_PASSPORTS),
      minioClient.bucketExists(env.MINIO_BUCKET_REPORTS),
    ]);
    return results.every(Boolean);
  } catch {
    return false;
  }
}

async function checkThor(): Promise<boolean> {
  try {
    const endpoint = new URL('/blocks/best', env.VECHAIN_NODE_URL);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/live', async (_request, reply) =>
    reply.status(200).send({
      success: true,
      data: { status: 'live', timestamp: new Date().toISOString() },
    }),
  );

  app.get('/ready', async (_request, reply) => {
    const [database, redis, minio, thor] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkMinio(),
      checkThor(),
    ]);
    const ready = database && redis && minio && (env.DEMO_SIMULATE_ANCHOR || thor);

    return reply.status(ready ? 200 : 503).send({
      success: ready,
      data: {
        status: ready ? 'ready' : 'degraded',
        checks: { database, redis, minio, thor },
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Compatibility endpoint retained for existing monitors and local tooling.
  app.get('/', async (_request, reply) => {
    const dbOk = await checkDatabase();

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
