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

export function createQueue(name, connection) {
  return new Queue(name, { connection, defaultJobOptions });
}

// Each job type is routed to the queue whose workers know how to process it:
// BullMQ workers cannot pick jobs by name, so different runtimes need different queues.
export function createQueues(config, connection) {
  const series = createQueue(config.QUEUE_NAME, connection);
  const geo = createQueue(config.GEO_QUEUE_NAME, connection);
  return { 'series-stats': series, 'zonal-stats': geo };
}
