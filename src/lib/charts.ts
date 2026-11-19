/* Geometry for the server-rendered SVG charts. No chart library, just scales and ticks. The components in
 * components/charts turn these into marks. One y-axis per chart: two measures on different scales get two charts
 * that share an x-axis, never a dual axis. */

/** Shared frame for Columns and Lines, so the two line up when stacked on one time axis. The right margin holds
 *  the line chart's direct end labels. */
export const FRAME = { W: 560, PL: 38, PR: 76 } as const;

/** Round a maximum up to a readable axis bound: 1, 2, 2.5 or 5 × 10^n. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * base) return m * base;
  return 10 * base;
}

/** Evenly spaced ticks from 0 to `max`: 4 intervals, or 5 when quarters would land on fractions (250 → 50s, not 62.5s). */
export function ticks(max: number): number[] {
  const count = Number.isInteger(max / 4) || !Number.isInteger(max / 5) ? 4 : 5;
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

/** Axis tick text. Five-digit values get a k suffix so they fit the 38px label gutter; the table view keeps the
 *  exact numbers. */
export const axisLabel = (v: number) => (v >= 10_000 ? `${Number((v / 1000).toFixed(1))}k` : new Intl.NumberFormat('en-US').format(v));

export const scale = (domainMax: number, rangePx: number) => (v: number) => (domainMax > 0 ? (v / domainMax) * rangePx : 0);

/** SVG path for a column whose top corners are rounded by `r` (0 = square). The baseline end stays square. */
export function colPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  if (rr <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}z`;
}

/** Group daily rows into ISO weeks (Mon-start) or calendar months, summing each numeric field. */
export function bucket<T extends { date: string }>(rows: T[], by: 'week' | 'month', fields: (keyof T)[]): { key: string; label: string; values: Record<string, number>; days: number }[] {
  const out = new Map<string, { key: string; label: string; values: Record<string, number>; days: number }>();
  for (const row of rows) {
    const d = new Date(`${row.date}T12:00:00Z`);
    let key: string, label: string;
    if (by === 'month') {
      key = row.date.slice(0, 7);
      label = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    } else {
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      key = monday.toISOString().slice(0, 10);
      label = monday.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    let b = out.get(key);
    if (!b) out.set(key, (b = { key, label, values: {}, days: 0 }));
    b.days++;
    for (const f of fields) b.values[f as string] = (b.values[f as string] ?? 0) + Number(row[f]);
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}
