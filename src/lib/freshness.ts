import type { Freshness, ISODateTime } from '../domain/types.ts';

const DAY = 86_400_000;

/** How old each kind of data may get before the UI calls it stale. County assessor data is released yearly, so a
 *  property record is "current" for months; weather observations go stale in hours. */
export const STALE_AFTER_DAYS = {
  property: 120,
  coverage: 120,
  weatherObs: 2,
  forecast: 0.5,
  demand: 3,
  ingestion: 7,
  /** SEO rankings, map pack and AI answers refresh weekly; a missed week shows. */
  seo: 8,
  /** The site crawl is monthly. */
  audit: 35
} as const;

export type FreshnessKind = keyof typeof STALE_AFTER_DAYS;

export function freshness(at: ISODateTime | null | undefined, kind: FreshnessKind, now: Date): Freshness {
  if (!at) return 'missing';
  const t = Date.parse(at);
  if (Number.isNaN(t)) return 'missing';
  return now.getTime() - t > STALE_AFTER_DAYS[kind] * DAY ? 'stale' : 'current';
}

export function ageInDays(at: ISODateTime, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(at)) / DAY);
}

/** Newest timestamp in a list (ISO strings in one format sort lexically). */
export function newest(times: (ISODateTime | null | undefined)[]): ISODateTime | null {
  let best: string | null = null;
  for (const t of times) if (t && (!best || t > best)) best = t;
  return best;
}
