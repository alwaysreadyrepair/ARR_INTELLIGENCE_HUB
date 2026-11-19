import type { ISODate, SourceId } from '../domain/types.ts';

/* The top-bar filters (territory, date range, data source) live in the query string, so any view can be linked and
 * every page works without client JS. Pages read them with readGlobalFilters() and build links with href(), which
 * carries them along. */

export type RangeKey = '30d' | '90d' | '12m';
export const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '12m', label: 'Last 12 months', days: 365 }
];

export const PROPERTY_SOURCES: { key: SourceId; label: string }[] = [
  { key: 'cook-assessor', label: 'Cook County Assessor' },
  { key: 'dupage-assessor', label: 'DuPage County Assessor' },
  { key: 'will-assessor', label: 'Will County Assessor' }
];

export interface GlobalFilters {
  territory?: string;
  range: RangeKey;
  source?: SourceId;
}

const GLOBAL_KEYS = ['territory', 'range', 'source', 'simulate'] as const;

export function readGlobalFilters(url: URL): GlobalFilters {
  const p = url.searchParams;
  const range = RANGES.find((r) => r.key === p.get('range'))?.key ?? '90d';
  const source = PROPERTY_SOURCES.find((s) => s.key === p.get('source'))?.key;
  const territory = p.get('territory') || undefined;
  return { territory: territory?.startsWith('twp-') ? territory : undefined, range, source };
}

/** Inclusive date window ending yesterday. Observations are daily, so today isn't complete yet. */
export function rangeDates(range: RangeKey, now: Date): { from: ISODate; to: ISODate } {
  const days = RANGES.find((r) => r.key === range)!.days;
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000;
  return { from: new Date(end - (days - 1) * 86_400_000).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10) };
}

/** Build a link to `path` that keeps the current global filters, plus `params` (undefined/'' values are dropped). */
export function href(path: string, current: URL, params: Record<string, string | number | undefined | null> = {}): string {
  const out = new URLSearchParams();
  for (const k of GLOBAL_KEYS) {
    const v = current.searchParams.get(k);
    if (v) out.set(k, v);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') out.delete(k);
    else out.set(k, String(v));
  }
  const qs = out.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Parse an optional integer query param within bounds. Anything else is treated as absent. */
export function intParam(url: URL, key: string, min: number, max: number): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw == null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/** Parse an enum query param. Returns undefined unless the value is one of `allowed`. */
export function enumParam<T extends string>(url: URL, key: string, allowed: readonly T[]): T | undefined {
  const v = url.searchParams.get(key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}
