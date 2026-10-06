import { createLogger } from '@trace/core';
import { orderSweepQueue, Worker, redisConnection } from '../lib/queue.js';
import { sweepOrderLifecycle } from '../modules/marketplace/marketplace.service.js';

/**
 * Applies the order time limits and listing expiry on a schedule: an
 * unanswered order lapses, an accepted order with no word from the buyer
 * completes, and a listing past its date leaves the marketplace.
 *
 * The sweep is not what makes the limits true: a person's own action, and the
 * orders list, apply them first for the orders they touch. The sweep is for
 * the orders nobody is looking at.
 *
 * Started by the API process (index.ts), so it runs in every deployment,
 * whether or not the anchor worker does.
 */
const SWEEP_EVERY_MS = 60 * 1000;
const logger = createLogger('order-lifecycle-worker');

async function processOrderSweep(): Promise<void> {
  const result = await sweepOrderLifecycle();
  if (result.lapsed || result.completed || result.expiredListings) {
    logger.info(result, 'Order lifecycle sweep closed orders or expired listings');
  }
}

export function startOrderLifecycleWorker() {
  const worker = new Worker('order-sweep', processOrderSweep, {
    connection: redisConnection,
    concurrency: 1,
  });
  worker.on('failed', (_job, err) => {
    logger.error({ err }, 'Order lifecycle sweep failed');
  });
  void orderSweepQueue
    .upsertJobScheduler('order-sweep', { every: SWEEP_EVERY_MS })
    .catch((err: unknown) => logger.error({ err }, 'Could not schedule the order sweep'));

  logger.info('Order lifecycle worker started');
  return { close: () => worker.close() };
}
