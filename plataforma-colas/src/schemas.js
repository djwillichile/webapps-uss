import { z } from 'zod';

export const JOB_TYPES = ['series-stats'];

export function buildJobRequestSchema({ maxSeriesLength }) {
  return z
    .object({
      type: z.enum(JOB_TYPES),
      series: z
        .object({
          name: z.string().trim().min(1).max(100),
          unit: z.string().trim().max(20).optional(),
          values: z.array(z.number().finite()).min(3).max(maxSeriesLength),
        })
        .strict(),
    })
    .strict(); // reject unknown fields instead of silently storing them in Redis
}

export const JobIdSchema = z.uuid();
