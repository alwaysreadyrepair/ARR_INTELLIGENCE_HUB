import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockSeoSnapshot } from '../data/mock/seo.ts';
import { getRepositories, getSeoRepository } from './index.ts';
import { SEO_SNAPSHOT_KEY, kvSeoRepository, seoRepositoryFrom } from './seo.ts';
import { RANK_DEPTH } from '../data/seo/targets.ts';

const NOW = new Date('2026-11-19T15:00:00Z');
const snap = buildMockSeoSnapshot(NOW);

test('mock SEO snapshot is deterministic and internally consistent', () => {
  assert.deepEqual(buildMockSeoSnapshot(NOW).rankings.slice(0, 20), snap.rankings.slice(0, 20));
  const t = snap.targets;
  assert.equal(new Set(snap.rankings.map((r) => r.date)).size, 12);
  assert.equal(snap.rankings.length, 12 * t.keywords.length * t.markets.length);
  assert.ok(snap.rankings.every((r) => r.position == null || (r.position >= 1 && r.position <= RANK_DEPTH)));
  assert.ok(snap.ai.every((a) => (!a.mentioned || a.answered) && (!a.cited || a.mentioned)));
  assert.ok(snap.targets.competitors.every((c) => c.domain.endsWith('.example')), 'mock never puts made-up numbers on a real company');
  assert.ok(snap.local.every((l) => l.topThree.length <= 3));
  assert.ok(snap.keywords.every((k) => k.monthly.length === 12));
});

test('snapshot repository filters and sorts by date', async () => {
  const repo = seoRepositoryFrom('mock', async () => snap);
  const orland = await repo.rankings({ marketId: 'orland-park', service: 'furnace' });
  assert.ok(orland.length > 0 && orland.every((r) => r.marketId === 'orland-park' && ['furnace repair', 'furnace replacement', 'furnace installation'].includes(r.keyword)));
  assert.deepEqual(orland.map((r) => r.date), [...orland.map((r) => r.date)].sort());
  const gpt = await repo.aiAnswers({ engine: 'chatgpt', promptId: 'best-hvac-orland' });
  assert.equal(gpt.length, 12);
  assert.equal(await repo.takenAt(), snap.takenAt);
});

test('snapshot mode reads KV once per request and explains what is missing', async () => {
  let reads = 0;
  const kv = { get: async (key: string) => (reads++, key === SEO_SNAPSHOT_KEY ? JSON.parse(JSON.stringify(snap)) : null) };
  const repo = kvSeoRepository(kv);
  assert.equal(repo.kind, 'snapshot');
  await Promise.all([repo.rankings(), repo.local(), repo.audit()]);
  assert.equal(reads, 1);

  await assert.rejects(kvSeoRepository({ get: async () => null }).rankings(), /seo:refresh/);
  assert.equal(await kvSeoRepository({ get: async () => null }).takenAt(), null);
  await assert.rejects(kvSeoRepository(undefined).targets(), /KV binding is missing/);
  await assert.rejects(kvSeoRepository({ get: async () => ({ ...snap, version: 2 }) }).targets(), /version 2/);
});

test('SEO_DATA_SOURCE picks the source independently of DATA_SOURCE', async () => {
  assert.equal(getSeoRepository(undefined).kind, 'mock');
  assert.equal(getSeoRepository({ SEO_DATA_SOURCE: 'SNAPSHOT' }).kind, 'snapshot');
  await assert.rejects(getSeoRepository({ SEO_DATA_SOURCE: 'live' }).targets(), /Unknown SEO_DATA_SOURCE "live"/);

  // Property data failing (supabase not built) must not take the SEO pages down, and vice versa.
  const repos = getRepositories({ DATA_SOURCE: 'supabase', SEO_DATA_SOURCE: 'mock' });
  assert.equal(repos.kind, 'supabase');
  assert.equal(repos.seo.kind, 'mock');
  assert.ok((await repos.seo.rankings()).length > 0);
  await assert.rejects(repos.coverage.list(), /not implemented/);
});
