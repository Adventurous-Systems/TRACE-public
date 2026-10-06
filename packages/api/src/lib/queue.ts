import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../env.js';

export interface AnchorPassportJob {
  passportId: string;
  organisationId: string;
}

const connectionOptions = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null as null,
};

export const anchorQueue = new Queue<AnchorPassportJob>('anchor-passport', {
  connection: connectionOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

/**
 * Periodic sweep that queues anchor jobs for passports that have a
 * fingerprint but were never submitted to a chain — passports written by the
 * seed/replenish/restore scripts (which can't reach this queue) or created
 * while the deployment was still simulating. Scheduled by the anchor worker.
 */
export const anchorSweepQueue = new Queue('anchor-sweep', {
  connection: connectionOptions,
  defaultJobOptions: {
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
  },
});

/** Periodic sweep that applies the order time limits and listing expiry. */
export const orderSweepQueue = new Queue('order-sweep', {
  connection: connectionOptions,
  defaultJobOptions: {
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
  },
});

export { Queue, Worker, type Job };
export { connectionOptions as redisConnection };
