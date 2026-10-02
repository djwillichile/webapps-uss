// End-to-end test with a real Redis: API -> queue -> 2 workers -> result.
// Skipped automatically if Redis is not reachable (TEST_REDIS_PORT, default 6379).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createApp } from '../src/app.js';
import { createProcessor } from '../src/processor.js';
import { createQueues } from '../src/redis.js';
import { KEY_A, KEY_B, request, startServer, testConfig, validBody } from './helpers.js';

const port = Number(process.env.TEST_REDIS_PORT ?? 6379);
const newRedis = () => new Redis({ host: '127.0.0.1', port, maxRetriesPerRequest: null, lazyConnect: true });

async function redisAvailable() {
  const probe = new Redis({ host: '127.0.0.1', port, lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0 });
  probe.on('error', () => {});
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const available = await redisAvailable();
const config = testConfig({ QUEUE_NAME: `it-${process.pid}`, GEO_QUEUE_NAME: `it-geo-${process.pid}` });
const ctx = {};

before(async () => {
  if (!available) return;
  ctx.conns = [newRedis(), newRedis(), newRedis()];
  ctx.queues = createQueues(config, ctx.conns[0]);
  ctx.queue = ctx.queues['series-stats'];
  const processor = createProcessor({ maxSeriesLength: 2000, simulatedWorkMs: 50 });
  ctx.workers = [1, 2].map((i) => new Worker(config.QUEUE_NAME, processor, { connection: ctx.conns[i], concurrency: 2, name: `w${i}` }));
  ctx.server = await startServer(createApp({ queues: ctx.queues, config }));
});

after(async () => {
  if (!available) return;
  await ctx.server.close();
  await Promise.all(ctx.workers.map((w) => w.close()));
  for (const q of Object.values(ctx.queues)) {
    await q.obliterate({ force: true });
    await q.close();
  }
  ctx.conns.forEach((c) => c.disconnect());
});

async function waitForFinal(jobId, key) {
  for (let i = 0; i < 100; i++) {
    const body = await (await request(ctx.server.base, `/api/jobs/${jobId}`, { key })).json();
    if (body.state === 'completed' || body.state === 'failed') return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout waiting for job');
}

test('jobs flow through Redis and are processed by the workers', { skip: !available && 'Redis not available' }, async () => {
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const res = await request(ctx.server.base, '/api/jobs', { body: validBody, key: KEY_A });
    assert.equal(res.status, 202);
    ids.push((await res.json()).jobId);
  }
  const results = await Promise.all(ids.map((id) => waitForFinal(id, KEY_A)));
  for (const r of results) {
    assert.equal(r.state, 'completed');
    assert.equal(r.progress, 100);
    assert.equal(r.result.stats.n, 5);
    assert.ok(Math.abs(r.result.stats.senSlope - 5 / 6) < 1e-9); // median of the 10 pairwise slopes
  }
  assert.equal((await request(ctx.server.base, `/api/jobs/${ids[0]}`, { key: KEY_B })).status, 404);
});

test('tampered payloads in Redis fail permanently without retries', { skip: !available && 'Redis not available' }, async () => {
  // Simulates someone writing directly to Redis, bypassing API validation.
  const job = await ctx.queue.add('series-stats', { type: 'series-stats', series: { name: 'x', values: 'boom' }, ownerId: 'alice' }, { jobId: crypto.randomUUID() });
  const final = await waitForFinal(job.id, KEY_A);
  assert.equal(final.state, 'failed');
  assert.equal(final.attemptsMade, 1);
  assert.equal(final.error, 'job failed');
});
