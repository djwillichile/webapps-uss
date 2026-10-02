import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export function createRedis(config, { failFast = false } = {}) {
  return new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    // Required by BullMQ for blocking connections used by workers.
    maxRetriesPerRequest: null,
    // In the API we prefer an immediate error (-> HTTP 503) over requests piling up
    // in memory while Redis is unreachable.
    enableOfflineQueue: !failFast,
  });
}

// Default policy applied to every job: bounded retries and bounded retention,
// so Redis memory cannot grow without limit.
export const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 5000 },
};

export function createQueue(config, connection) {
  return new Queue(config.QUEUE_NAME, { connection, defaultJobOptions });
}
