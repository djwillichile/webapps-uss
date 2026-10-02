// Descriptive statistics and monotonic trend tests for an evenly spaced time series
// (e.g. annual precipitation at a station). Slopes are expressed per time step.
//
// Mann-Kendall and Sen's slope are O(n^2): this is the "heavy" work that justifies
// running it in a worker instead of inside the HTTP request.

function median(sorted) {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Abramowitz & Stegun 7.1.26 (abs. error < 1.5e-7).
function erf(x) {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

export function mannKendall(values) {
  const n = values.length;
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) s += Math.sign(values[j] - values[i]);
  }

  // Variance corrected for tied groups.
  const tieCounts = new Map();
  for (const v of values) tieCounts.set(v, (tieCounts.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of tieCounts.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;

  let z = 0;
  if (variance > 0 && s > 0) z = (s - 1) / Math.sqrt(variance);
  else if (variance > 0 && s < 0) z = (s + 1) / Math.sqrt(variance);

  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { s, variance, z, pValue };
}

export function senSlope(values) {
  const n = values.length;
  const slopes = new Float64Array((n * (n - 1)) / 2);
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) slopes[k++] = (values[j] - values[i]) / (j - i);
  }
  slopes.sort();
  return median(slopes);
}

export function olsSlope(values) {
  const n = values.length;
  const tMean = (n - 1) / 2;
  const xMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let t = 0; t < n; t++) {
    num += (t - tMean) * (values[t] - xMean);
    den += (t - tMean) ** 2;
  }
  return num / den;
}

export function computeSeriesStats(values, { alpha = 0.05 } = {}) {
  if (!Array.isArray(values) || values.length < 3 || !values.every(Number.isFinite)) {
    throw new TypeError('values must be an array of at least 3 finite numbers');
  }
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1));
  const sorted = Float64Array.from(values).sort();
  const mk = mannKendall(values);

  return {
    n,
    mean,
    sd,
    min: sorted[0],
    max: sorted[n - 1],
    median: median(sorted),
    olsSlope: olsSlope(values),
    senSlope: senSlope(values),
    mannKendall: mk,
    trend: mk.pValue < alpha ? (mk.z > 0 ? 'increasing' : 'decreasing') : 'no significant trend',
  };
}
