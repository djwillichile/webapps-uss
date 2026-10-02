import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { fakeQueues, KEY_A, KEY_B, request, startServer, testConfig, validBody, validZonalBody } from './helpers.js';

let server;
let queues;
let queue; // the series-stats queue, used by most tests

before(async () => {
  queues = fakeQueues();
  queue = queues['series-stats'];
  server = await startServer(createApp({ queues, config: testConfig() }));
});
after(() => server.close());

test('health check is public', async () => {
  const res = await request(server.base, '/health');
  assert.equal(res.status, 200);
});

test('security headers are set and X-Powered-By is hidden', async () => {
  const res = await request(server.base, '/health');
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('rejects requests without or with a wrong API key', async () => {
  assert.equal((await request(server.base, '/api/jobs', { body: validBody })).status, 401);
  assert.equal((await request(server.base, '/api/jobs', { body: validBody, key: 'x'.repeat(30) })).status, 401);
});

test('enqueues a valid job and returns 202 with a status URL', async () => {
  const res = await request(server.base, '/api/jobs', { body: validBody, key: KEY_A });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.match(body.jobId, /^[0-9a-f-]{36}$/);
  assert.equal(queue.jobs.get(body.jobId).data.ownerId, 'alice');
});

test('rejects invalid payloads and unknown fields', async () => {
  const bad = [
    { type: 'rm -rf', series: validBody.series },
    { type: 'series-stats', series: { name: 'x', values: [1, 2] } },
    { type: 'series-stats', series: { name: 'x', values: [1, 2, 'a'] } },
    { ...validBody, ownerId: 'bob' },
  ];
  for (const body of bad) {
    const res = await request(server.base, '/api/jobs', { body, key: KEY_A });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('malformed and oversized bodies are rejected without leaking internals', async () => {
  const malformed = await request(server.base, '/api/jobs', { raw: '{nope', key: KEY_A });
  assert.equal(malformed.status, 400);
  const huge = await request(server.base, '/api/jobs', { raw: JSON.stringify({ x: 'a'.repeat(100_000) }), key: KEY_A });
  assert.equal(huge.status, 413);
  assert.doesNotMatch(await huge.text(), /at .*\.js/);
});

test('a client cannot read another client\'s job (404, not 403)', async () => {
  const { jobId } = await (await request(server.base, '/api/jobs', { body: validBody, key: KEY_A })).json();
  assert.equal((await request(server.base, `/api/jobs/${jobId}`, { key: KEY_A })).status, 200);
  assert.equal((await request(server.base, `/api/jobs/${jobId}`, { key: KEY_B })).status, 404);
  assert.equal((await request(server.base, '/api/jobs/not-a-uuid', { key: KEY_A })).status, 404);
});

test('backpressure: returns 503 + Retry-After when the queue is full', async () => {
  queue.pending = 100;
  const res = await request(server.base, '/api/jobs', { body: validBody, key: KEY_A });
  queue.pending = 0;
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '30');
});

test('rate limit is applied per client', async () => {
  const limited = await startServer(createApp({ queues: fakeQueues(), config: testConfig({ RATE_LIMIT_PER_MIN: 2 }) }));
  try {
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await request(limited.base, '/api/jobs', { body: validBody, key: KEY_A })).status);
    assert.deepEqual(statuses, [202, 202, 429]);
    // A different client still has its own budget.
    assert.equal((await request(limited.base, '/api/jobs', { body: validBody, key: KEY_B })).status, 202);
  } finally {
    await limited.close();
  }
});

test('zonal-stats jobs are routed to the geo queue', async () => {
  const res = await request(server.base, '/api/jobs', { body: validZonalBody, key: KEY_A });
  assert.equal(res.status, 202);
  const { jobId } = await res.json();
  assert.ok(queues['zonal-stats'].jobs.has(jobId));
  assert.ok(!queue.jobs.has(jobId));
  // The status endpoint finds it regardless of the queue it lives in.
  assert.equal((await request(server.base, `/api/jobs/${jobId}`, { key: KEY_A })).status, 200);
});

test('rejects invalid geometries and datasets outside the allowlist', async () => {
  const ring = validZonalBody.geometry.coordinates[0];
  const bad = [
    { ...validZonalBody, dataset: '../../etc/passwd' },
    { ...validZonalBody, geometry: { type: 'Point', coordinates: [-70, -33] } },
    { ...validZonalBody, geometry: { type: 'Polygon', coordinates: [ring.slice(0, -1)] } }, // not closed
    { ...validZonalBody, geometry: { type: 'Polygon', coordinates: [[[-200, 0], [1, 0], [1, 1], [-200, 0]]] } },
    { ...validZonalBody, series: validBody.series }, // fields of another job type
  ];
  for (const body of bad) {
    const res = await request(server.base, '/api/jobs', { body, key: KEY_A });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('only errors marked "user: " by a worker are shown to the client', async () => {
  const geo = queues['zonal-stats'];
  for (const [reason, expected] of [
    ['user: polygon does not intersect the dataset extent', 'polygon does not intersect the dataset extent'],
    ['ECONNREFUSED 10.0.0.5:6379 at /app/src/x.js', 'job failed'],
  ]) {
    const { jobId } = await (await request(server.base, '/api/jobs', { body: validZonalBody, key: KEY_A })).json();
    Object.assign(geo.jobs.get(jobId), { failedReason: reason, getState: async () => 'failed' });
    const body = await (await request(server.base, `/api/jobs/${jobId}`, { key: KEY_A })).json();
    assert.equal(body.error, expected);
  }
});
