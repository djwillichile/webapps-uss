import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

const hash = 'a'.repeat(64);

test('fails fast without API_KEYS', () => {
  assert.throws(() => loadConfig({}), /API_KEYS/);
});

test('rejects malformed API_KEYS entries', () => {
  assert.throws(() => loadConfig({ API_KEYS: 'alice:not-a-hash' }), /Invalid API_KEYS/);
});

test('requires REDIS_PASSWORD in production', () => {
  assert.throws(() => loadConfig({ API_KEYS: `alice:${hash}`, NODE_ENV: 'production' }), /REDIS_PASSWORD/);
  assert.ok(loadConfig({ API_KEYS: `alice:${hash}`, NODE_ENV: 'production', REDIS_PASSWORD: 'x' }));
});
