import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { apiKeyAuth } from './auth.js';
import { logger } from './logger.js';
import { buildJobRequestSchema, JobIdSchema } from './schemas.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PENDING_STATES = ['waiting', 'active', 'delayed', 'prioritized'];

// The app receives its dependencies (queue, config) instead of creating them,
// which lets tests run it with an in-memory fake queue.
export function createApp({ queue, config }) {
  const app = express();
  const jobRequestSchema = buildJobRequestSchema({ maxSeriesLength: config.MAX_SERIES_LENGTH });

  app.set('trust proxy', config.TRUST_PROXY);
  app.use(helmet()); // security headers: CSP, HSTS, nosniff, frame-ancestors...
  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(PUBLIC_DIR));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  const api = express.Router();
  api.use(apiKeyAuth(config.clients));
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.RATE_LIMIT_PER_MIN,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => req.clientId, // limit per client, not per IP
      message: { error: 'too many requests' },
    }),
  );

  api.post('/jobs', async (req, res) => {
    const parsed = jobRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid request',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    // Backpressure: if the backlog is full, refuse new work instead of letting it grow forever.
    const counts = await queue.getJobCounts(...PENDING_STATES);
    const pending = PENDING_STATES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
    if (pending >= config.MAX_QUEUE_SIZE) {
      res.set('Retry-After', '30');
      return res.status(503).json({ error: 'queue is full, try again later' });
    }

    // Random, unguessable IDs + owner stored in the job -> clients cannot read other clients' jobs.
    const jobId = randomUUID();
    await queue.add(parsed.data.type, { ...parsed.data, ownerId: req.clientId }, { jobId });
    logger.info('job enqueued', { jobId, clientId: req.clientId, type: parsed.data.type });

    res.status(202).location(`/api/jobs/${jobId}`).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  });

  api.get('/jobs/:id', async (req, res) => {
    const id = JobIdSchema.safeParse(req.params.id);
    const job = id.success ? await queue.getJob(id.data) : null;
    // 404 (not 403) for someone else's job: do not even confirm that it exists.
    if (!job || job.data?.ownerId !== req.clientId) {
      return res.status(404).json({ error: 'not found' });
    }

    const state = await job.getState();
    res.json({
      jobId: job.id,
      type: job.name,
      state,
      progress: job.progress ?? 0,
      attemptsMade: job.attemptsMade ?? 0,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      result: state === 'completed' ? job.returnvalue : null,
      // Internal error messages stay in the worker logs; the client gets a generic one.
      error: state === 'failed' ? 'job failed' : null,
    });
  });

  app.use('/api', api);
  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  // Central error handler: log details, never leak stack traces to the client.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'malformed JSON' });
    logger.error('unhandled error', { path: req.path, err: err.message });
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
