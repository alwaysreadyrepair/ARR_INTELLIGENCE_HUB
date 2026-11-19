import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshness, newest } from './freshness.ts';
import { load } from './load.ts';
import { cdd, hdd, median, pearson, ratio, sqftBand } from './stats.ts';
import { bucket, niceMax, ticks } from './charts.ts';
import { enumParam, href, intParam, rangeDates, readGlobalFilters } from './filters.ts';
import { weatherStress } from './weather.ts';

const NOW = new Date('2026-09-24T15:00:00Z');

test('freshness: current, stale and missing', () => {
  assert.equal(freshness('2026-09-20T00:00:00Z', 'property', NOW), 'current');
  assert.equal(freshness('2026-01-01T00:00:00Z', 'property', NOW), 'stale');
  assert.equal(freshness('2026-09-21T00:00:00Z', 'weatherObs', NOW), 'stale');
  assert.equal(freshness(null, 'coverage', NOW), 'missing');
  assert.equal(freshness('not a date', 'coverage', NOW), 'missing');
  assert.equal(newest(['2026-01-02', null, '2026-03-01', '2025-12-31']), '2026-03-01');
});

test('load: ok, empty, stale, error and simulated states', async () => {
  assert.deepEqual(await load(async () => [1]), { status: 'ok', data: [1], asOf: null });
  assert.equal((await load(async () => [])).status, 'empty');
  assert.equal((await load(async () => ({ items: [], total: 0 }))).status, 'empty');
  const stale = await load(async () => ({ at: '2025-01-01T00:00:00Z' }), { asOf: (d) => d.at, staleKind: 'coverage', now: NOW });
  assert.equal(stale.status, 'stale');
  assert.ok('data' in stale, 'stale results keep their data');
  const origError = console.error;
  console.error = () => {};
  try {
    const err = await load(async () => { throw new Error('boom'); });
    assert.deepEqual(err, { status: 'error', message: 'boom' });
  } finally {
    console.error = origError;
  }
  assert.equal((await load(async () => [1], { simulate: 'error' })).status, 'error');
  assert.equal((await load(async () => [1], { simulate: 'empty' })).status, 'empty');
});

test('stats', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3); // rounds the midpoint of 2 and 3
  assert.equal(ratio(1, 0), 0);
  assert.equal(sqftBand(1199), '< 1,200');
  assert.equal(sqftBand(1200), '1,200–1,799');
  assert.equal(sqftBand(9000), '3,500+');
  assert.equal(hdd(30), 35);
  assert.equal(hdd(80), 0);
  assert.equal(cdd(80), 15);
  assert.equal(cdd(64.6), 0);
  assert.equal(pearson([1, 2], [1, 2]), null);
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [2, 4, 6, 8])! - 1) < 1e-9);
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [8, 6, 4, 2])! + 1) < 1e-9);
});

test('charts: niceMax and bucketing', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(180), 200);
  assert.equal(niceMax(230), 250);
  assert.deepEqual(ticks(200), [0, 50, 100, 150, 200]);
  assert.deepEqual(ticks(250), [0, 50, 100, 150, 200, 250]);
  assert.deepEqual(ticks(10), [0, 2, 4, 6, 8, 10]);
  const rows = [
    { date: '2026-09-21', v: 1 }, // Monday
    { date: '2026-09-27', v: 2 }, // Sunday, same week
    { date: '2026-09-28', v: 4 }  // next Monday
  ];
  const weeks = bucket(rows, 'week', ['v']);
  assert.deepEqual(weeks.map((w) => [w.key, w.values.v, w.days]), [['2026-09-21', 3, 2], ['2026-09-28', 4, 1]]);
  assert.deepEqual(bucket(rows, 'month', ['v']).map((m) => m.values.v), [7]);
});

test('weather stress compares degree days with the normal for the same days', () => {
  const normals = Array.from({ length: 12 }, (_, i) => ({ areaId: 'a', month: i + 1, hdd: i === 0 ? 1240 : 0, cdd: i === 6 ? 310 : 0, precipIn: 2 }));
  const day = (date: string, h: number, c: number) => ({ areaId: 'a', date, tMaxF: 0, tMinF: 0, tAvgF: 0, hdd: h, cdd: c, precipIn: 0, snowIn: 0, source: { source: 'noaa-ncei' as const, label: '', retrievedAt: '' } });
  // January normal = 40 HDD/day. A week at 55/day is high heating load.
  const cold = weatherStress(Array.from({ length: 7 }, (_, i) => day(`2026-01-0${i + 1}`, 55, 0)), normals)!;
  assert.equal(cold.label, 'High heating load');
  assert.equal(cold.hddNormal, 280);
  // July normal = 10 CDD/day. A week at 10/day is normal cooling load.
  assert.equal(weatherStress(Array.from({ length: 7 }, (_, i) => day(`2026-07-0${i + 1}`, 0, 10)), normals)!.label, 'Normal cooling load');
  // Under 3 degree days a day reads as mild, whatever the ratio.
  assert.equal(weatherStress([day('2026-05-01', 1, 0)], normals)!.level, 'low');
  assert.equal(weatherStress([], normals), null);
});

test('filters: parsing and link building', () => {
  const url = new URL('http://x/markets?territory=twp-orland&range=12m&source=nope&simulate=empty&page=3');
  assert.deepEqual(readGlobalFilters(url), { territory: 'twp-orland', range: '12m', source: undefined });
  assert.equal(readGlobalFilters(new URL('http://x/?territory=zip-60462')).territory, undefined);
  assert.equal(href('/properties', url, { zip: '60462' }), '/properties?territory=twp-orland&range=12m&source=nope&simulate=empty&zip=60462');
  assert.equal(href('/', new URL('http://x/?page=2')), '/');
  assert.equal(href('/', url, { range: undefined }), '/?territory=twp-orland&source=nope&simulate=empty');
  assert.deepEqual(rangeDates('30d', NOW), { from: '2026-08-25', to: '2026-09-23' }); // 30 days inclusive
  assert.equal(intParam(new URL('http://x/?y=1950'), 'y', 1800, 2030), 1950);
  assert.equal(intParam(new URL('http://x/?y=19.5'), 'y', 1800, 2030), undefined);
  assert.equal(intParam(new URL('http://x/?y='), 'y', 1800, 2030), undefined);
  assert.equal(enumParam(new URL('http://x/?s=2'), 's', ['1', '2'] as const), '2');
  assert.equal(enumParam(new URL('http://x/?s=9'), 's', ['1', '2'] as const), undefined);
});
