import 'dotenv/config';
import { startAnchorWorker } from './workers/anchor-passport.worker.js';

const worker = startAnchorWorker();

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(`Received ${signal}; waiting for the anchor worker to stop.\n`);
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

worker.on('error', (error) => {
  process.stderr.write(`Anchor worker error: ${String(error)}\n`);
});
