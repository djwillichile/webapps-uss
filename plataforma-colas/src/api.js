import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createQueues, createRedis } from './redis.js';

const config = loadConfig();
const connection = createRedis(config, { failFast: true });
connection.on('error', (err) => logger.error('redis error', { err: err.message }));
const queues = createQueues(config, connection);

const server = createApp({ queues, config }).listen(config.PORT, () => {
  logger.info('api listening', { port: config.PORT, queues: [config.QUEUE_NAME, config.GEO_QUEUE_NAME] });
});

// Graceful shutdown: stop accepting connections, finish in-flight requests, close Redis.
async function shutdown(signal) {
  logger.info('shutting down api', { signal });
  server.close(async () => {
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await connection.quit();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
