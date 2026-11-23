import { mockRepositories } from './mock/index.ts';
import { mockSeoRepository } from './mock/seo.ts';
import { mockTrafficRepository } from './mock/traffic.ts';
import { kvSeoRepository, seoRepositoryFrom, type SeoKv } from './seo.ts';
import { kvTrafficRepository, trafficRepositoryFrom, type TrafficKv } from './traffic.ts';
import type { Repositories, SeoRepository, TrafficRepository } from './types.ts';

type HubEnv = { DATA_SOURCE?: string; SEO_DATA_SOURCE?: string; SEO?: SeoKv; TRAFFIC_DATA_SOURCE?: string; TRAFFIC?: TrafficKv };

/* Picks the data source for a request. `DATA_SOURCE=supabase` is reserved for the Supabase repositories (README,
 * "Connecting Supabase"). Until they exist, that setting yields repositories whose every call rejects. Each panel
 * then shows its error state with the reason, and a misconfigured deploy never quietly falls back to mock numbers. */
export function getRepositories(env: HubEnv | undefined): Repositories {
  const source = (env?.DATA_SOURCE ?? 'mock').toLowerCase();
  const base =
    source === 'mock' ? mockRepositories()
    : source === 'supabase' ? failingRepositories('supabase', 'DATA_SOURCE=supabase, but the Supabase repositories are not implemented yet.')
    : failingRepositories('supabase', `Unknown DATA_SOURCE "${source}". Expected "mock" or "supabase".`);
  // Spread would read every property through the failing proxy, so build the object explicitly.
  return Object.assign(Object.create(base) as Repositories, { kind: base.kind, seo: getSeoRepository(env), traffic: getTrafficRepository(env) });
}

/* SEO has its own switch: its real data (DataForSEO + a site crawl) can be live while the property data is still
 * mock. `SEO_DATA_SOURCE=snapshot` reads the snapshot from the SEO KV namespace; an unknown value errors the same
 * way DATA_SOURCE does instead of falling back to synthetic numbers. */
export function getSeoRepository(env: { SEO_DATA_SOURCE?: string; SEO?: SeoKv } | undefined): SeoRepository {
  const source = (env?.SEO_DATA_SOURCE ?? 'mock').toLowerCase();
  if (source === 'mock') return mockSeoRepository();
  if (source === 'snapshot') return kvSeoRepository(env?.SEO);
  return seoRepositoryFrom('snapshot', () => Promise.reject(new Error(`Unknown SEO_DATA_SOURCE "${source}". Expected "mock" or "snapshot".`)));
}

/* Web traffic (Cloudflare) has its own switch too, for the same reason. `snapshot` reads the TRAFFIC KV namespace. */
export function getTrafficRepository(env: Pick<HubEnv, 'TRAFFIC_DATA_SOURCE' | 'TRAFFIC'> | undefined): TrafficRepository {
  const source = (env?.TRAFFIC_DATA_SOURCE ?? 'mock').toLowerCase();
  if (source === 'mock') return mockTrafficRepository();
  if (source === 'snapshot') return kvTrafficRepository(env?.TRAFFIC);
  return trafficRepositoryFrom('snapshot', () => Promise.reject(new Error(`Unknown TRAFFIC_DATA_SOURCE "${source}". Expected "mock" or "snapshot".`)));
}

function failingRepositories(kind: Repositories['kind'], message: string): Repositories {
  const failingRepo = new Proxy({}, { get: () => () => Promise.reject(new Error(message)) });
  return new Proxy({ kind } as Repositories, { get: (target, prop) => (prop === 'kind' ? target.kind : failingRepo) });
}

export type { Repositories } from './types.ts';
