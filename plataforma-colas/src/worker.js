import os from 'node:os';
import { Worker } from 'bullmq';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createProcessor } from './processor.js';
import { createRedis } from './redis.js';

const config = loadConfig();
const connection = createRedis(config);
connection.on('error', (err) => logger.error('redis error', { err: err.message }));
const workerName = `${os.hostname()}-${process.pid}`;

const processor = createProcessor({
  maxSeriesLength: config.MAX_SERIES_LENGTH,
  simulatedWorkMs: config.SIMULATED_WORK_MS,
});

// Each worker pulls jobs from Redis at its own pace: the queue distributes work,
// a worker never takes more than `concurrency` jobs at once.
const worker = new Worker(config.QUEUE_NAME, processor, {
  connection,
  concurrency: config.WORKER_CONCURRENCY,
  name: workerName,
});

worker.on('active', (job) => logger.info('job started', { jobId: job.id, worker: workerName, attempt: job.attemptsMade + 1 }));
worker.on('completed', (job) => logger.info('job completed', { jobId: job.id, worker: workerName }));
worker.on('failed', (job, err) =>
  logger.warn('job failed', { jobId: job?.id, worker: workerName, attempt: job?.attemptsMade, err: err.message }),
);
worker.on('error', (err) => logger.error('worker error', { err: err.message }));

logger.info('worker ready', { worker: workerName, queue: config.QUEUE_NAME, concurrency: config.WORKER_CONCURRENCY });

// Graceful shutdown: close() waits for active jobs to finish before exiting,
// so a deploy or scale-down does not cut a job in half.
async function shutdown(signal) {
  logger.info('shutting down worker', { signal, worker: workerName });
  setTimeout(() => process.exit(1), 30_000).unref();
  await worker.close();
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
