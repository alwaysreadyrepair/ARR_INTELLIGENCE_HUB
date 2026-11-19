export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function sum(values: number[]): number {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

/** Share as 0–1. Returns 0 (not NaN) when the denominator is 0. */
export const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

export function countBy<T, K extends string | number>(items: T[], key: (t: T) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const it of items) {
    const k = key(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export const decadeOf = (year: number) => Math.floor(year / 10) * 10;

export const SQFT_BANDS = [
  { band: '< 1,200', max: 1200 },
  { band: '1,200–1,799', max: 1800 },
  { band: '1,800–2,499', max: 2500 },
  { band: '2,500–3,499', max: 3500 },
  { band: '3,500+', max: Infinity }
] as const;

export function sqftBand(sqft: number): string {
  return SQFT_BANDS.find((b) => sqft < b.max)!.band;
}

/** Heating / cooling degree days for a daily mean temperature, on NOAA's 65°F base. */
export const hdd = (tAvgF: number) => Math.max(0, Math.round(65 - tAvgF));
export const cdd = (tAvgF: number) => Math.max(0, Math.round(tAvgF - 65));

/** Pearson correlation. Null for fewer than 3 points or zero variance. The UI labels it correlation, never cause. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = sum(xs.slice(0, n)) / n;
  const my = sum(ys.slice(0, n)) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}
