import { z } from 'zod';

const MAX_RING_VERTICES = 2000;
const MAX_RINGS = 10;

export function buildSeriesJobSchema({ maxSeriesLength }) {
  return z
    .object({
      type: z.literal('series-stats'),
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

// GeoJSON Polygon in WGS84 (RFC 7946): [lon, lat] positions, closed linear rings.
const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const LinearRing = z
  .array(Position)
  .min(4)
  .max(MAX_RING_VERTICES)
  .refine((ring) => ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1], {
    message: 'linear ring must be closed (first and last positions equal)',
  });
export const PolygonSchema = z
  .object({ type: z.literal('Polygon'), coordinates: z.array(LinearRing).min(1).max(MAX_RINGS) })
  .strict();

export function buildZonalJobSchema({ geoDatasets }) {
  return z
    .object({
      type: z.literal('zonal-stats'),
      // The client picks a dataset by ID from an allowlist, never by file path.
      dataset: z.enum(geoDatasets),
      geometry: PolygonSchema,
    })
    .strict();
}

export function buildJobRequestSchema({ maxSeriesLength, geoDatasets }) {
  return z.discriminatedUnion('type', [
    buildSeriesJobSchema({ maxSeriesLength }),
    buildZonalJobSchema({ geoDatasets }),
  ]);
}

export const JobIdSchema = z.uuid();
