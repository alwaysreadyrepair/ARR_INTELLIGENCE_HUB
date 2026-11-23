/* The traffic repository over one `TrafficSnapshot`, the same shape as the SEO one: mock mode builds a synthetic
 * snapshot (repositories/mock/traffic.ts), snapshot mode reads the one `npm run traffic:refresh` wrote and
 * `traffic:load` put in the TRAFFIC KV namespace. */

import type { TrafficSnapshot } from '../domain/traffic.ts';
import { within } from '../lib/traffic/stats.ts';
import type { TrafficRepository } from './types.ts';

/** KV key the loader writes and this repository reads. */
export const TRAFFIC_SNAPSHOT_KEY = 'traffic:snapshot';

export function trafficRepositoryFrom(kind: TrafficRepository['kind'], get: () => Promise<TrafficSnapshot | null>): TrafficRepository {
  // One read per repository instance (one per request), however many panels ask.
  let pending: Promise<TrafficSnapshot | null> | null = null;
  const snap = () => (pending ??= get());
  const need = async () => {
    const s = await snap();
    if (!s) throw new Error('No traffic snapshot loaded yet. Run `npm run traffic:refresh`, then `npm run traffic:load`.');
    return s;
  };
  return {
    kind,
    async takenAt() {
      return (await snap())?.takenAt ?? null;
    },
    async zone() {
      return (await need()).zone;
    },
    async edge() {
      return (await need()).edge ?? null;
    },
    async days(from, to) {
      return within((await need()).days, from, to);
    },
    async visits(from, to) {
      const v = (await need()).visits;
      return v ? within(v, from, to) : null;
    },
    async crawlers(from, to) {
      return within((await need()).crawlers, from, to);
    },
    async pages() {
      return (await need()).pages;
    },
    async referrers() {
      return (await need()).referrers;
    },
    async crawledPaths() {
      return (await need()).crawledPaths;
    },
    async notFound() {
      return (await need()).notFound;
    }
  };
}

/** The one KV method this needs. */
export interface TrafficKv {
  get(key: string, type: 'json'): Promise<unknown>;
}

/** Snapshot mode: read the JSON the loader put in KV. A missing binding or key is an error the panels show. */
export function kvTrafficRepository(kv: TrafficKv | undefined): TrafficRepository {
  return trafficRepositoryFrom('snapshot', async () => {
    if (!kv) throw new Error('TRAFFIC_DATA_SOURCE=snapshot, but the TRAFFIC KV binding is missing (see wrangler.json).');
    const snapshot = (await kv.get(TRAFFIC_SNAPSHOT_KEY, 'json')) as TrafficSnapshot | null;
    if (snapshot && snapshot.version !== 1) throw new Error(`Traffic snapshot version ${String(snapshot.version)} isn't supported by this build.`);
    return snapshot;
  });
}
