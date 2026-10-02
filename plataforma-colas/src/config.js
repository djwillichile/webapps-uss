import { z } from 'zod';

// Fail fast: if the environment is misconfigured, the process refuses to start
// instead of running in an insecure or undefined state.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  REDIS_HOST: z.string().min(1).default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Comma-separated "clientId:sha256hex" pairs. Only hashes are stored, never raw keys.
  API_KEYS: z.string().min(1, 'API_KEYS is required (run: npm run hash-key)'),

  QUEUE_NAME: z.string().regex(/^[a-z0-9-]+$/).default('analisis'),
  MAX_QUEUE_SIZE: z.coerce.number().int().min(1).default(100),
  MAX_SERIES_LENGTH: z.coerce.number().int().min(3).max(5000).default(2000),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  SIMULATED_WORK_MS: z.coerce.number().int().min(0).max(60000).default(3000),
});

export function parseApiKeys(raw) {
  const clients = [];
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [clientId, hash] = entry.split(':');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(clientId ?? '') || !/^[a-f0-9]{64}$/.test(hash ?? '')) {
      throw new Error(`Invalid API_KEYS entry for client "${clientId ?? '?'}" (expected clientId:sha256hex)`);
    }
    clients.push({ clientId, hash: Buffer.from(hash, 'hex') });
  }
  if (clients.length === 0) throw new Error('API_KEYS must contain at least one client');
  return clients;
}

export function loadConfig(env = process.env) {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const config = result.data;
  if (config.NODE_ENV === 'production' && !config.REDIS_PASSWORD) {
    throw new Error('REDIS_PASSWORD is required in production');
  }
  return { ...config, clients: parseApiKeys(config.API_KEYS) };
}
