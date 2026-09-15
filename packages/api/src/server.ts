import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { errorHandler } from './middleware/error-handler.js';
import { ensureBucket } from './lib/storage.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { accessRequestRoutes } from './modules/access-request/access-request.routes.js';
import { passportRoutes } from './modules/passport/passport.routes.js';
import { marketplaceRoutes } from './modules/marketplace/marketplace.routes.js';
import { qualityRoutes } from './modules/quality/quality.routes.js';
import { feedbackRoutes } from './modules/feedback/feedback.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { blockchainRoutes } from './modules/blockchain/blockchain.routes.js';
import { registerAuditFailureHooks } from './lib/audit.js';
import { enforceDeploymentProfile } from './middleware/deployment-profile.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    // nginx overwrites X-Forwarded-For with its immediate client address before
    // proxying, so Fastify never receives a caller-supplied address chain.
    trustProxy: true,
  });

  // ── Plugins ────────────────────────────────────────────────────────────────

  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? env.WEB_URL : true,
    credentials: true,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRY },
  });

  // Rate limit is not applied in test environment to keep tests fast
  if (env.NODE_ENV !== 'test') {
    await app.register(rateLimit, {
      max: env.RATE_LIMIT_MAX,
      timeWindow: '1 minute',
    });
  }

  // Public exposure profiles fail closed before body parsing or route handlers.
  app.addHook('onRequest', enforceDeploymentProfile);

  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024, // 20 MB — modern phone photos can exceed 10 MB
      files: 10,
    },
  });

  // ── Storage ────────────────────────────────────────────────────────────────
  // Pre-create buckets at startup to avoid lazy-init race conditions
  if (env.NODE_ENV !== 'test') {
    await ensureBucket(env.MINIO_BUCKET_PASSPORTS, { publicRead: env.MINIO_PUBLIC_READ });
    await ensureBucket(env.MINIO_BUCKET_REPORTS);
  }

  // ── Error handler ──────────────────────────────────────────────────────────

  app.setErrorHandler(errorHandler);
  registerAuditFailureHooks(app);

  // ── Routes ─────────────────────────────────────────────────────────────────

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(accessRequestRoutes, { prefix: '/api/v1/access-requests' });
  await app.register(passportRoutes, { prefix: '/api/v1/passports' });
  await app.register(marketplaceRoutes, { prefix: '/api/v1/marketplace' });
  await app.register(qualityRoutes, { prefix: '/api/v1/quality' });
  await app.register(feedbackRoutes, { prefix: '/api/v1/feedback' });
  await app.register(auditRoutes, { prefix: '/api/v1/audit' });
  await app.register(blockchainRoutes, { prefix: '/api/v1/blockchain' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
