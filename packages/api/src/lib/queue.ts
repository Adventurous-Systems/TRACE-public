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

export { Queue, Worker, type Job };
export { connectionOptions as redisConnection };
