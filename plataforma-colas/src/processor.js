import { UnrecoverableError } from 'bullmq';
import { buildSeriesJobSchema } from './schemas.js';
import { computeSeriesStats } from './tasks/seriesStats.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Factory so tests and the worker can inject settings.
export function createProcessor({ maxSeriesLength, simulatedWorkMs = 0 }) {
  const schema = buildSeriesJobSchema({ maxSeriesLength });

  return async function processJob(job) {
    // Defense in depth: never trust what is in Redis, even if the API validated it.
    const parsed = schema.safeParse({ type: job.data?.type, series: job.data?.series });
    if (!parsed.success) {
      // Retrying cannot fix bad input, so fail permanently.
      throw new UnrecoverableError('invalid job payload');
    }

    await job.updateProgress(10);

    // Simulates a long task (download, raster processing...) in steps, reporting progress.
    const steps = 4;
    for (let i = 1; i <= steps && simulatedWorkMs > 0; i++) {
      await sleep(simulatedWorkMs / steps);
      await job.updateProgress(10 + Math.round((70 * i) / steps));
    }

    const { series } = parsed.data;
    const stats = computeSeriesStats(series.values);
    await job.updateProgress(100);

    return { series: { name: series.name, unit: series.unit ?? null }, stats };
  };
}
