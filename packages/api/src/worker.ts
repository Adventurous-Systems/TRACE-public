import 'dotenv/config';
import { startAnchorWorker } from './workers/anchor-passport.worker.js';
import { startOrderLifecycleWorker } from './workers/order-lifecycle.worker.js';

const worker = startAnchorWorker();
const orderWorker = startOrderLifecycleWorker();

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(`Received ${signal}; waiting for the workers to stop.\n`);
  await Promise.all([worker.close(), orderWorker.close()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

worker.on('error', (error) => {
  process.stderr.write(`Anchor worker error: ${String(error)}\n`);
});
