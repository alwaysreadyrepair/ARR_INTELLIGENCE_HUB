import { freshness, type FreshnessKind } from './freshness.ts';

/* Every panel renders one of these. `stale` still carries data: the panel shows it with a warning instead of
 * hiding it. Loading isn't a status here. Pages are server-rendered, so the loading skeleton is the fallback a
 * deferred server island shows while its data is in flight (components/ui/Skeleton.astro). */
export type Loaded<T> =
  | { status: 'ok'; data: T; asOf: string | null }
  | { status: 'stale'; data: T; asOf: string | null }
  | { status: 'empty'; asOf: string | null }
  | { status: 'error'; message: string };

/** Dev aid: `?simulate=error|empty|slow` forces a state on every panel so each state can be reviewed. Mock mode only. */
export type Simulate = 'error' | 'empty' | 'slow' | null;

export interface LoadOptions<T> {
  isEmpty?: (data: T) => boolean;
  /** Timestamp the data is "as of", for the freshness stamp and the stale check. */
  asOf?: (data: T) => string | null;
  staleKind?: FreshnessKind;
  now?: Date;
  simulate?: Simulate;
}

const defaultEmpty = (d: unknown) =>
  d == null ||
  (Array.isArray(d) && d.length === 0) ||
  (typeof d === 'object' && 'items' in d && Array.isArray((d as { items: unknown }).items) && (d as { items: unknown[] }).items.length === 0);

export async function load<T>(fn: () => Promise<T>, opts: LoadOptions<T> = {}): Promise<Loaded<T>> {
  if (opts.simulate === 'error') return { status: 'error', message: 'Simulated failure (?simulate=error).' };
  if (opts.simulate === 'empty') return { status: 'empty', asOf: null };
  if (opts.simulate === 'slow') await new Promise((r) => setTimeout(r, 1500));
  try {
    const data = await fn();
    const asOf = opts.asOf ? opts.asOf(data) : null;
    if ((opts.isEmpty ?? defaultEmpty)(data)) return { status: 'empty', asOf };
    if (opts.staleKind && freshness(asOf, opts.staleKind, opts.now ?? new Date()) !== 'current') return { status: 'stale', data, asOf };
    return { status: 'ok', data, asOf };
  } catch (err) {
    // Full detail goes to the server log; the operator gets the message without a stack trace.
    console.error('[hub] load failed', err);
    return { status: 'error', message: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export const hasData = <T>(r: Loaded<T>): r is Extract<Loaded<T>, { data: T }> => r.status === 'ok' || r.status === 'stale';

/** The error message of a failed load, for a Kpi's `error` prop; undefined otherwise. */
export const errorOf = (r: Loaded<unknown>): string | undefined => (r.status === 'error' ? r.message : undefined);
