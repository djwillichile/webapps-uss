import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSeriesStats, mannKendall, senSlope } from '../src/tasks/seriesStats.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('descriptive stats and slopes of a perfect linear series', () => {
  const s = computeSeriesStats([1, 2, 3, 4, 5]);
  assert.equal(s.n, 5);
  close(s.mean, 3);
  close(s.sd, Math.sqrt(2.5));
  close(s.olsSlope, 1);
  close(s.senSlope, 1);
  assert.equal(s.median, 3);
});

test('Mann-Kendall S and Z match the textbook formula (no ties)', () => {
  const mk = mannKendall([1, 2, 3, 4, 5]);
  assert.equal(mk.s, 10);
  close(mk.variance, (5 * 4 * 15) / 18);
  close(mk.z, 9 / Math.sqrt((5 * 4 * 15) / 18));
});

test('Mann-Kendall variance is corrected for ties', () => {
  const mk = mannKendall([1, 1, 2, 3]); // one tie group of size 2
  close(mk.variance, (4 * 3 * 13 - 2 * 1 * 9) / 18);
});

test('constant series has no trend', () => {
  const s = computeSeriesStats([7, 7, 7, 7]);
  assert.equal(s.mannKendall.z, 0);
  assert.equal(s.trend, 'no significant trend');
});

test('Sen slope is robust to an outlier, OLS is not', () => {
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 100];
  close(senSlope(values), 1);
  assert.ok(computeSeriesStats(values).olsSlope > 3);
});

test('detects a significant decreasing trend', () => {
  const values = Array.from({ length: 40 }, (_, i) => 100 - i + (i % 3));
  assert.equal(computeSeriesStats(values).trend, 'decreasing');
});

test('rejects invalid input', () => {
  assert.throws(() => computeSeriesStats([1, 2]), TypeError);
  assert.throws(() => computeSeriesStats([1, NaN, 3]), TypeError);
});
