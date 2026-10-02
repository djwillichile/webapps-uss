import { parseApiKeys } from '../src/config.js';
import { hashApiKey } from '../src/auth.js';

export const KEY_A = 'test-key-client-a-0123456789';
export const KEY_B = 'test-key-client-b-0123456789';

export function testConfig(overrides = {}) {
  const apiKeys = `alice:${hashApiKey(KEY_A).toString('hex')},bob:${hashApiKey(KEY_B).toString('hex')}`;
  return {
    PORT: 0,
    TRUST_PROXY: 0,
    QUEUE_NAME: 'test',
    MAX_QUEUE_SIZE: 100,
    MAX_SERIES_LENGTH: 2000,
    RATE_LIMIT_PER_MIN: 1000,
    clients: parseApiKeys(apiKeys),
    geoDatasets: ['dem-demo'],
    ...overrides,
  };
}

// In-memory stand-in for a BullMQ Queue, exposing only what the API uses.
export class FakeQueue {
  constructor() {
    this.jobs = new Map();
    this.pending = 0;
  }
  async add(name, data, opts) {
    const job = {
      id: opts.jobId, name, data, progress: 0, attemptsMade: 0, timestamp: Date.now(),
      returnvalue: null, getState: async () => 'waiting',
    };
    this.jobs.set(job.id, job);
    return job;
  }
  async getJob(id) {
    return this.jobs.get(id) ?? null;
  }
  async getJobCounts() {
    return { waiting: this.pending, active: 0, delayed: 0, prioritized: 0 };
  }
}

export async function startServer(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

export function request(base, path, { key, body, raw, method = body || raw ? 'POST' : 'GET' } = {}) {
  return fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key && { 'X-API-Key': key }) },
    body: raw ?? (body && JSON.stringify(body)),
  });
}

export function fakeQueues() {
  return { 'series-stats': new FakeQueue(), 'zonal-stats': new FakeQueue() };
}

export const validZonalBody = {
  type: 'zonal-stats',
  dataset: 'dem-demo',
  geometry: { type: 'Polygon', coordinates: [[[-70.6, -33.5], [-70.4, -33.5], [-70.4, -33.3], [-70.6, -33.3], [-70.6, -33.5]]] },
};

export const validBody = { type: 'series-stats', series: { name: 'pp', unit: 'mm', values: [3, 1, 2, 5, 4] } };
