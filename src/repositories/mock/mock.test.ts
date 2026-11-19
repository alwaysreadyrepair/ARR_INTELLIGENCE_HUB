import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockDataset } from '../../data/mock/dataset.ts';
import { createMockRepositories } from './index.ts';
import { getRepositories } from '../index.ts';

const NOW = new Date('2026-09-24T15:00:00Z');
const data = buildMockDataset(NOW);
const repos = createMockRepositories(data);

test('mock dataset is deterministic', () => {
  const again = buildMockDataset(NOW);
  assert.deepEqual(again.properties.slice(0, 5), data.properties.slice(0, 5));
  assert.equal(again.properties.length, data.properties.length);
});

test('property search filters, sorts and pages', async () => {
  const orland = await repos.properties.search({ township: 'Orland', pageSize: 10 });
  assert.equal(orland.items.length, 10);
  assert.ok(orland.total > 10);
  assert.ok(orland.items.every((p) => p.township === 'Orland'));
  assert.ok(!('permits' in orland.items[0]!), 'list results omit detail-only fields');

  const old = await repos.properties.search({ yearBuiltMax: 1950, sort: 'yearBuilt', dir: 'desc', pageSize: 100 });
  const years = old.items.map((p) => p.yearBuilt!);
  assert.ok(years.every((y) => y <= 1950));
  assert.deepEqual(years, [...years].sort((a, b) => b - a));

  const since = '2016-01-01';
  const noPermit = await repos.properties.search({ noHvacPermitSince: since, pageSize: 100 });
  assert.ok(noPermit.items.every((p) => !p.lastHvacPermitOn || p.lastHvacPermitOn < since));

  const byPin = data.properties[3]!;
  const hit = await repos.properties.search({ q: byPin.pin.replace(/-/g, '') });
  assert.ok(hit.items.some((p) => p.id === byPin.id), 'PIN search ignores dashes');

  const last = await repos.properties.search({ page: 9999 });
  assert.equal(last.items.length, 0);
});

test('property detail carries source history', async () => {
  const withTwo = data.properties.find((p) => p.versions.length === 2)!;
  const detail = await repos.properties.get(withTwo.id);
  assert.ok(detail);
  assert.equal(detail.versions[0]!.version, 1);
  assert.equal(await repos.properties.get('nope'), null);
});

test('coverage agrees with the properties it summarises', async () => {
  const zips = await repos.coverage.list({ kind: 'zip' });
  const total = zips.reduce((s, a) => s + a.homesIndexed, 0);
  assert.equal(total, data.properties.length);
  const will = zips.filter((a) => a.county === 'will');
  assert.ok(will.length > 0 && will.every((a) => a.homesIndexed === 0 && a.lastRefreshedAt === null), 'Will County is not ingested');
  const twps = await repos.coverage.list({ kind: 'township' });
  assert.equal(twps.reduce((s, a) => s + a.homesIndexed, 0), total);
});

test('market profile adds up', async () => {
  const p = await repos.markets.profile({});
  assert.equal(p.homes, data.properties.length);
  assert.equal(p.byDecade.reduce((s, d) => s + d.homes, 0) + p.yearBuiltUnknown, p.homes);
  assert.equal(p.centralAir.yes + p.centralAir.no + p.centralAir.unknown, p.homes);
  assert.equal(p.byHeatingType.reduce((s, h) => s + h.homes, 0), p.homes);
  const orland = await repos.markets.profile({ territory: 'twp-orland' });
  assert.ok(orland.homes > 0 && orland.homes < p.homes);
  const c = await repos.markets.countByAgeAndPermit({ builtBefore: 1980, noPermitSince: '2011-01-01' });
  assert.ok(c.matching > 0 && c.matching < c.of);
});

test('weather is stored per area with degree days on a 65°F base', async () => {
  const [area] = await repos.weather.areas();
  const obs = await repos.weather.observations(area!.id, '2026-01-01', '2026-09-23');
  assert.ok(obs.length > 200);
  for (const o of obs) {
    assert.equal(o.hdd, Math.max(0, Math.round(65 - o.tAvgF)));
    assert.equal(o.cdd, Math.max(0, Math.round(o.tAvgF - 65)));
    assert.ok(o.tMaxF >= o.tMinF);
  }
  assert.ok(!('hdd' in data.properties[0]!), 'weather is never copied onto properties');
  const f = await repos.weather.forecast(area!.id);
  assert.equal(f?.periods.length, 7);
  assert.equal((await repos.weather.normals(area!.id)).length, 12);
});

test('quality issues point at real records', async () => {
  const issues = await repos.quality.list();
  const ids = new Set(data.properties.map((p) => p.id));
  for (const i of issues) if (i.propertyId) assert.ok(ids.has(i.propertyId), `${i.id} → ${i.propertyId}`);
  const dups = issues.filter((i) => i.kind === 'duplicate-parcel');
  assert.equal(dups.length, 2, 'the two seeded duplicates are detected');
  assert.equal(new Set(data.properties.map((p) => p.pin)).size, data.properties.length, 'every PIN is unique, duplicates included');
});

test('repository factory', async () => {
  assert.equal(getRepositories(undefined).kind, 'mock');
  const broken = getRepositories({ DATA_SOURCE: 'supabase' });
  await assert.rejects(broken.properties.search({}), /not implemented/);
  await assert.rejects(getRepositories({ DATA_SOURCE: 'bogus' }).coverage.list(), /Unknown DATA_SOURCE/);
});
