import 'dotenv/config';
import { buildApp } from './server.js';
import { env } from './env.js';
import { startAnchorWorker } from './workers/anchor-passport.worker.js';
import { startOrderLifecycleWorker } from './workers/order-lifecycle.worker.js';

async function main() {
  const app = await buildApp();

  // Start background workers (not in test environment — avoids hanging Redis connections)
  if (env.NODE_ENV !== 'test' && env.ANCHOR_WORKER_ENABLED) {
    startAnchorWorker();
  }
  // The order time limits run with the API itself, not with the anchor
  // worker: a deployment may run without that worker, or with it in another
  // slot, and an order must still lapse or complete on time. Several API
  // processes may run it at once: each order is re-checked under its lock.
  if (env.NODE_ENV !== 'test') {
    startOrderLifecycleWorker();
  }

  await app.listen({
    port: env.API_PORT,
    host: '0.0.0.0',
  });
}

main().catch((err) => {
  process.stderr.write(`Fatal startup error: ${String(err)}\n`);
  process.exit(1);
});
