import type { FastifyInstance } from 'fastify';
import { contentTypeFor } from '@trace/db';
import { objectStore } from '../../lib/storage.js';

/**
 * GET /minio/<bucket>/<key>: stored files, for running without nginx (the
 * local stack and e2e, STORAGE_SERVE=true). A deployment's nginx serves the
 * same paths straight from disk and never sends them here.
 */
export async function storageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { '*': string } }>('/*', async (request, reply) => {
    const [bucket = '', ...rest] = request.params['*'].split('/');
    const key = rest.join('/');
    let body: Buffer;
    try {
      body = await objectStore().read(bucket, key);
    } catch {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'File not found' },
      });
    }
    return reply
      .header('content-type', contentTypeFor(key))
      .header('cache-control', 'public, max-age=604800')
      .header('x-content-type-options', 'nosniff')
      .send(body);
  });
}
