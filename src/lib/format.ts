const nf = new Intl.NumberFormat('en-US');
const pf = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const cf = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const df = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
const dtf = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

export const num = (n: number | null | undefined) => (n == null ? '—' : nf.format(n));
export const pct = (r: number | null | undefined) => (r == null ? '—' : pf.format(r));
export const usd = (n: number | null | undefined) => (n == null ? '—' : cf.format(n));

/** Date-only values (YYYY-MM-DD) are calendar days. Formatting them at noon UTC keeps the timezone from shifting the day. */
export const date = (iso: string | null | undefined) => (!iso ? '—' : df.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)));
export const dateTime = (iso: string | null | undefined) => (!iso ? '—' : dtf.format(new Date(iso)));

export function relative(iso: string | null | undefined, now: Date): string {
  if (!iso) return 'never';
  const mins = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

export const HEATING_LABEL: Record<string, string> = {
  'forced-air-gas': 'Forced-air gas',
  boiler: 'Boiler',
  electric: 'Electric',
  'heat-pump': 'Heat pump',
  other: 'Other',
  unknown: 'Unknown'
};

export const SOURCE_LABEL: Record<string, string> = {
  'cook-assessor': 'Cook County Assessor',
  'cook-permits': 'Cook County permits',
  'will-assessor': 'Will County Assessor',
  'dupage-assessor': 'DuPage County Assessor',
  manual: 'Manual entry',
  'noaa-ncei': 'NOAA NCEI',
  nws: 'National Weather Service',
  sera: 'Sera'
};

export const COUNTY_LABEL: Record<string, string> = { cook: 'Cook', will: 'Will', dupage: 'DuPage' };
