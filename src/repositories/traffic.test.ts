import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockTrafficSnapshot } from '../data/mock/traffic.ts';
import { BOTS } from '../data/traffic/bots.ts';
import { getRepositories, getTrafficRepository } from './index.ts';
import { TRAFFIC_SNAPSHOT_KEY, kvTrafficRepository, trafficRepositoryFrom } from './traffic.ts';

const NOW = new Date('2026-11-20T15:00:00Z');
const snap = buildMockTrafficSnapshot(NOW);

test('mock traffic snapshot is deterministic and internally consistent', () => {
  assert.deepEqual(buildMockTrafficSnapshot(NOW).days.slice(-5), snap.days.slice(-5));
  assert.equal(snap.days.at(-1)!.date, '2026-11-19', 'ends on the last complete UTC day');
  assert.ok(snap.days.every((d) => d.cachedRequests <= d.requests && d.status5xx >= 0));
  assert.ok(snap.crawlers.every((c) => BOTS.some((b) => b.id === c.bot)));
  assert.ok(snap.takenAt <= NOW.toISOString());
});

test('repository limits daily series to the window asked for', async () => {
  const repo = trafficRepositoryFrom('mock', async () => snap);
  const days = await repo.days('2026-11-01', '2026-11-10');
  assert.deepEqual([days[0]!.date, days.at(-1)!.date, days.length], ['2026-11-01', '2026-11-10', 10]);
  assert.equal((await repo.visits('2026-11-01', '2026-11-10'))!.length, 10);
  assert.equal(await trafficRepositoryFrom('mock', async () => ({ ...snap, visits: null })).visits('2026-11-01', '2026-11-10'), null);
});

test('snapshot mode reads KV once per request and explains what is missing', async () => {
  let reads = 0;
  const kv = { get: async (key: string) => (reads++, key === TRAFFIC_SNAPSHOT_KEY ? JSON.parse(JSON.stringify(snap)) : null) };
  const repo = kvTrafficRepository(kv);
  await Promise.all([repo.days('2026-11-01', '2026-11-19'), repo.pages(), repo.crawlers('2026-11-01', '2026-11-19')]);
  assert.equal(reads, 1);
  await assert.rejects(kvTrafficRepository({ get: async () => null }).pages(), /traffic:refresh/);
  await assert.rejects(kvTrafficRepository(undefined).zone(), /TRAFFIC KV binding is missing/);
  await assert.rejects(kvTrafficRepository({ get: async () => ({ ...snap, version: 2 }) }).zone(), /version 2/);
});

test('TRAFFIC_DATA_SOURCE is its own switch', async () => {
  assert.equal(getTrafficRepository(undefined).kind, 'mock');
  assert.equal(getTrafficRepository({ TRAFFIC_DATA_SOURCE: 'snapshot' }).kind, 'snapshot');
  await assert.rejects(getTrafficRepository({ TRAFFIC_DATA_SOURCE: 'live' }).zone(), /Unknown TRAFFIC_DATA_SOURCE "live"/);
  const repos = getRepositories({ DATA_SOURCE: 'supabase', TRAFFIC_DATA_SOURCE: 'mock' });
  assert.equal(repos.traffic.kind, 'mock');
  assert.ok((await repos.traffic.days('2026-01-01', '2026-12-31')).length > 0);
});
