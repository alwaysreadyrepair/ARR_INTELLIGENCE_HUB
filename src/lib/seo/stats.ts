/* Roll-ups for the SEO & AEO pages. Pure functions over repository rows, so they're unit-tested and identical in
 * mock and snapshot mode. Every figure is a count with its denominator; there is no blended "SEO score". */

import type { AiAnswer, AiEngine, AuditIssue, AuditSeverity, LocalPackResult, RankObservation, SeoBrand, SiteAudit, GscMetrics, GscQueryRow, TrackedKeyword } from '../../domain/seo.ts';

export const ENGINE_LABEL: Record<AiEngine, string> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  claude: 'Claude',
  google_ai_overview: 'Google AI Overview'
};

/** Short names for chart end labels, which have about 10 characters of room. */
export const ENGINE_SHORT: Record<AiEngine, string> = { ...ENGINE_LABEL, google_ai_overview: 'Google AIO' };

export const SERVICE_LABEL: Record<string, string> = {
  furnace: 'Furnace', ac: 'Air conditioning', 'heat-pump': 'Heat pump', boiler: 'Boiler',
  maintenance: 'Maintenance', emergency: 'Emergency', general: 'General HVAC'
};

/** Distinct dates in ascending order. */
export function dates<T extends { date: string }>(rows: T[]): string[] {
  return [...new Set(rows.map((r) => r.date))].sort();
}

export function latest<T extends { date: string }>(rows: T[]): { date: string | null; rows: T[] } {
  const d = dates(rows).at(-1) ?? null;
  return { date: d, rows: d ? rows.filter((r) => r.date === d) : [] };
}

export function previous<T extends { date: string }>(rows: T[]): { date: string | null; rows: T[] } {
  const d = dates(rows).at(-2) ?? null;
  return { date: d, rows: d ? rows.filter((r) => r.date === d) : [] };
}

export const RANK_BUCKETS = [
  { key: 'top3', label: 'Positions 1–3', test: (p: number | null) => p != null && p <= 3 },
  { key: 'top10', label: 'Positions 4–10', test: (p: number | null) => p != null && p > 3 && p <= 10 },
  { key: 'top20', label: 'Positions 11–20', test: (p: number | null) => p != null && p > 10 && p <= 20 },
  { key: 'deep', label: 'Position 21 or lower', test: (p: number | null) => p != null && p > 20 },
  { key: 'none', label: 'Not ranked', test: (p: number | null) => p == null }
] as const;

export function rankBuckets(rows: RankObservation[]): { key: string; label: string; count: number }[] {
  return RANK_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: rows.filter((r) => b.test(r.position)).length }));
}

/** Per refresh: how many keyword × city searches had ARR in the top 3 and in the top 10. */
export function rankTrend(rows: RankObservation[]): { date: string; top3: number; top10: number; checks: number }[] {
  return dates(rows).map((date) => {
    const day = rows.filter((r) => r.date === date);
    return {
      date,
      top3: day.filter((r) => r.position != null && r.position <= 3).length,
      top10: day.filter((r) => r.position != null && r.position <= 10).length,
      checks: day.length
    };
  });
}

/** Latest position per keyword × market with the change since the previous refresh. A positive `delta` is an
 *  improvement (moved up the page). */
export function rankChanges(rows: RankObservation[]): (RankObservation & { prev: number | null; delta: number | null })[] {
  const cur = latest(rows).rows;
  const prior = new Map(previous(rows).rows.map((r) => [`${r.keyword}|${r.marketId}`, r.position]));
  return cur.map((r) => {
    const prev = prior.get(`${r.keyword}|${r.marketId}`) ?? null;
    return { ...r, prev, delta: r.position != null && prev != null ? prev - r.position : null };
  });
}

/** Share of answered prompts that name ARR, per engine per refresh. Unanswered checks (e.g. no AI Overview shown)
 *  are left out of the denominator and reported separately. */
export function mentionTrend(answers: AiAnswer[], engines: AiEngine[]): { date: string; byEngine: Record<string, { mentioned: number; cited: number; answered: number; asked: number }> }[] {
  return dates(answers).map((date) => {
    const day = answers.filter((a) => a.date === date);
    const byEngine: Record<string, { mentioned: number; cited: number; answered: number; asked: number }> = {};
    for (const e of engines) {
      const rows = day.filter((a) => a.engine === e);
      byEngine[e] = {
        mentioned: rows.filter((a) => a.mentioned).length,
        cited: rows.filter((a) => a.cited).length,
        answered: rows.filter((a) => a.answered).length,
        asked: rows.length
      };
    }
    return { date, byEngine };
  });
}

/** How many answers name each brand (ARR first, then competitors by count). One answer naming three brands counts
 *  once for each. */
export function shareOfVoice(answers: AiAnswer[], brand: SeoBrand, competitors: SeoBrand[]): { domain: string; name: string; own: boolean; answers: number }[] {
  const answered = answers.filter((a) => a.answered);
  const rows = [
    { domain: brand.domain, name: brand.name, own: true, answers: answered.filter((a) => a.mentioned).length },
    ...competitors.map((c) => ({ domain: c.domain, name: c.name, own: false, answers: answered.filter((a) => a.competitorsMentioned.includes(c.domain)).length }))
  ];
  return [rows[0]!, ...rows.slice(1).sort((a, b) => b.answers - a.answers)];
}

/** Domains AI answers cite most, across the given answers. */
export function topCitedDomains(answers: AiAnswer[], limit = 10): { domain: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of answers) for (const d of new Set(a.citedDomains)) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, limit);
}

/** Map-pack summary for the latest refresh. */
export function localSummary(rows: LocalPackResult[]): { checks: number; top3: number; listed: number } {
  const cur = latest(rows).rows;
  return {
    checks: cur.length,
    top3: cur.filter((r) => r.position != null && r.position <= 3).length,
    listed: cur.filter((r) => r.position != null).length
  };
}

/** Page findings whose message carries a page-specific number get a generic one when grouped across pages. */
const GROUP_MESSAGE: Record<string, string> = {
  'thin-content': 'Under 300 words of body text. Thin pages rarely get quoted.',
  'images-missing-alt': 'Images without alt text.',
  'h1-multiple': 'More than one H1 heading.',
  'schema-invalid': "Structured data that can't be parsed as JSON.",
  'http-error': 'Returns an HTTP error.',
  'fetch-failed': "Couldn't be fetched."
};

const SEVERITY_ORDER: Record<AuditSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Audit findings grouped by issue code: how many pages each affects, most severe first. */
export function auditIssues(audit: SiteAudit): { code: string; severity: AuditSeverity; message: string; aeo: boolean; pages: number; urls: string[] }[] {
  const out = new Map<string, { code: string; severity: AuditSeverity; message: string; aeo: boolean; pages: number; urls: string[] }>();
  const add = (i: AuditIssue, url: string | null) => {
    const row = out.get(i.code) ?? { code: i.code, severity: i.severity, message: GROUP_MESSAGE[i.code] ?? i.message, aeo: i.aeo, pages: 0, urls: [] };
    if (url) {
      row.pages++;
      row.urls.push(url);
    }
    out.set(i.code, row);
  };
  for (const i of audit.siteIssues) add(i, null);
  for (const p of audit.pages) for (const i of p.issues) add(i, p.url);
  return [...out.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.pages - a.pages);
}

/** "ac repair" → "AC repair", "hvac company" → "HVAC company". */
export const sentence = (s: string) => {
  const t = s.replace(/\b(hvac|ac)\b/gi, (m) => m.toUpperCase());
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Fixed series colour per engine, so an engine keeps its colour on every chart. */
export const ENGINE_COLOR: Record<AiEngine, string> = {
  chatgpt: 'var(--series-1)',
  perplexity: 'var(--series-2)',
  gemini: 'var(--series-3)',
  claude: 'var(--series-4)',
  google_ai_overview: 'var(--series-5)'
};

/** "2026-11-16" → "Nov 16". */
export const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Percentage 0–100, rounded, for charts. 0 when there's no denominator. */
export const pct100 = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// ── Search Console ──

/** Lower case, "&" and "+" read as "and", punctuation dropped, single spaces. */
const norm = (s: string) => ` ${s.toLowerCase().replace(/[&+]/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** A search for ARR by name: any of the brand's spellings, its domain stem, or "arr" next to an HVAC word. Clicks from
 *  these come from people who already know us, so they say little about SEO. */
export function isBrandQuery(query: string, brand: SeoBrand): boolean {
  const q = norm(query);
  const stem = brand.domain.split('.')[0]!;
  if (q.replace(/ /g, '').includes(stem)) return true;
  if (brand.names.some((name) => q.includes(norm(name)))) return true;
  return / arr (heating|hvac|cooling|air|furnace|ac) /.test(q) || / always ready /.test(q);
}

/** Totals over rows, with the impression-weighted average position the way Search Console computes it. */
export function sumMetrics(rows: GscMetrics[]): GscMetrics {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const position = impressions > 0 ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : 0;
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0, position };
}

/** Relative change, or null when there's nothing to compare against. */
export const change = (now: number, before: number | null | undefined) => (before == null || before === 0 ? null : (now - before) / before);

/** Daily rows rolled up to weeks starting Monday. Partial weeks at either end are dropped so the bars compare. */
export function gscWeekly(daily: (GscMetrics & { date: string })[]): { week: string; clicks: number; impressions: number }[] {
  const weeks = new Map<string, { clicks: number; impressions: number; days: number }>();
  for (const d of daily) {
    const t = Date.parse(`${d.date}T00:00:00Z`);
    const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    const w = weeks.get(monday) ?? { clicks: 0, impressions: 0, days: 0 };
    w.clicks += d.clicks;
    w.impressions += d.impressions;
    w.days++;
    weeks.set(monday, w);
  }
  return [...weeks].filter(([, w]) => w.days === 7).sort(([a], [b]) => a.localeCompare(b)).map(([week, w]) => ({ week, clicks: w.clicks, impressions: w.impressions }));
}

/** Each tracked keyword's real search traffic: every search term containing all its words ("furnace repair" picks up
 *  "furnace repair orland park" and "orland park furnace repair near me"). Brand searches are left out. */
export function trackedKeywordTraffic(queries: GscQueryRow[], keywords: TrackedKeyword[], brand: SeoBrand) {
  const open = queries.filter((q) => !isBrandQuery(q.query, brand)).map((q) => ({ q, words: new Set(norm(q.query).trim().split(' ')) }));
  return keywords.map((k) => {
    const want = norm(k.keyword).trim().split(' ');
    const hits = open.filter((o) => want.every((w) => o.words.has(w))).map((o) => o.q);
    return { keyword: k.keyword, service: k.service, terms: hits.length, ...sumMetrics(hits), prev: hits.some((h) => h.prev) ? sumMetrics(hits.flatMap((h) => (h.prev ? [h.prev] : []))) : null };
  });
}

/** Non-brand search terms Google already shows us for, but low on page one or on page two (average position 4–20):
 *  the closest to turning impressions into calls. Most impressions first. */
export function gscOpportunities(queries: GscQueryRow[], brand: SeoBrand, limit = 15): GscQueryRow[] {
  return queries
    .filter((q) => q.position >= 4 && q.position <= 20 && q.impressions >= 20 && !isBrandQuery(q.query, brand))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}
