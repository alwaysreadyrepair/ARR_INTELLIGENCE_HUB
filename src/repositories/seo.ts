/* The SEO repository over one `SeoSnapshot`. Both sources produce a snapshot: mock mode builds a synthetic one
 * (repositories/mock/seo.ts), snapshot mode reads the one `npm run seo:refresh` wrote and `seo:load` put in
 * the SEO KV namespace. Pages never see the difference except for `kind`. */

import type { SeoSnapshot } from '../domain/seo.ts';
import type { SeoRepository } from './types.ts';

/** KV key the loader writes and this repository reads. */
export const SEO_SNAPSHOT_KEY = 'seo:snapshot';

const byDate = <T extends { date: string }>(rows: T[]) => [...rows].sort((a, b) => a.date.localeCompare(b.date));

export function seoRepositoryFrom(kind: SeoRepository['kind'], get: () => Promise<SeoSnapshot | null>): SeoRepository {
  // One read per repository instance (one per request), however many panels ask.
  let pending: Promise<SeoSnapshot | null> | null = null;
  const snap = () => (pending ??= get());
  const need = async () => {
    const s = await snap();
    if (!s) throw new Error('No SEO snapshot loaded yet. Run `npm run seo:refresh`, then `npm run seo:load`.');
    return s;
  };
  return {
    kind,
    async takenAt() {
      return (await snap())?.takenAt ?? null;
    },
    async targets() {
      return (await need()).targets;
    },
    async rankings(f = {}) {
      const s = await need();
      const service = f.service ? new Set(s.targets.keywords.filter((k) => k.service === f.service).map((k) => k.keyword)) : null;
      return byDate(s.rankings.filter((r) => (!f.marketId || r.marketId === f.marketId) && (!service || service.has(r.keyword))));
    },
    async local(f = {}) {
      return byDate((await need()).local.filter((r) => !f.marketId || r.marketId === f.marketId));
    },
    async aiAnswers(f = {}) {
      return byDate((await need()).ai.filter((a) => (!f.engine || a.engine === f.engine) && (!f.promptId || a.promptId === f.promptId)));
    },
    async keywords() {
      return (await need()).keywords;
    },
    async competitors() {
      return (await need()).competitors;
    },
    async audit() {
      return (await need()).audit;
    },
    async searchConsole() {
      return (await need()).searchConsole ?? null;
    },
    async spend() {
      return byDate((await need()).spend);
    }
  };
}

/** The one KV method this needs, so the Hub doesn't take a dependency on @cloudflare/workers-types. */
export interface SeoKv {
  get(key: string, type: 'json'): Promise<unknown>;
}

/** Snapshot mode: read the JSON the loader put in KV. A missing binding or key is an error the panels show. */
export function kvSeoRepository(kv: SeoKv | undefined): SeoRepository {
  return seoRepositoryFrom('snapshot', async () => {
    if (!kv) throw new Error('SEO_DATA_SOURCE=snapshot, but the SEO KV binding is missing (see wrangler.json).');
    const snapshot = (await kv.get(SEO_SNAPSHOT_KEY, 'json')) as SeoSnapshot | null;
    if (snapshot && snapshot.version !== 1) throw new Error(`SEO snapshot version ${String(snapshot.version)} isn't supported by this build.`);
    return snapshot;
  });
}
