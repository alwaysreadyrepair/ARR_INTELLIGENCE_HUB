/* Pure helpers for the Web Traffic pages and the refresh: classify bots and referrers, merge history, roll up. */

import type { AiAssistantDef, BotDef, CrawlerDay, EdgeCoverage, ReferrerCount } from '../../domain/traffic.ts';
import type { ISODate } from '../../domain/types.ts';
import { AI_ASSISTANTS, BOTS } from '../../data/traffic/bots.ts';

/** The first known bot whose `match` appears in the User-Agent, or null. */
export function classifyBot(userAgent: string, bots: BotDef[] = BOTS): BotDef | null {
  for (const b of bots) if (userAgent.includes(b.match)) return b;
  return null;
}

export const botById = (id: string): BotDef | undefined => BOTS.find((b) => b.id === id);

/** The AI assistant a referrer host belongs to, or null. Subdomains count (www.perplexity.ai). */
export function assistantFor(host: string, assistants: AiAssistantDef[] = AI_ASSISTANTS): AiAssistantDef | null {
  const h = host.toLowerCase();
  return assistants.find((a) => a.hosts.some((x) => h === x || h.endsWith(`.${x}`))) ?? null;
}

/** Visits from AI assistants, summed per assistant, biggest first. */
export function aiReferrals(rows: ReferrerCount[]): { assistant: AiAssistantDef; visits: number }[] {
  const m = new Map<string, { assistant: AiAssistantDef; visits: number }>();
  for (const r of rows) {
    const a = assistantFor(r.host);
    if (!a) continue;
    const row = m.get(a.id) ?? { assistant: a, visits: 0 };
    row.visits += r.visits;
    m.set(a.id, row);
  }
  return [...m.values()].sort((a, b) => b.visits - a.visits);
}

/** Merge history: rows from `next` replace rows in `prev` with the same key; sorted by date; older than `keepFrom` dropped. */
export function mergeHistory<T extends { date: string }>(prev: T[], next: T[], key: (r: T) => string, keepFrom?: ISODate): T[] {
  const m = new Map(prev.map((r) => [key(r), r]));
  // A refreshed day is replaced whole, so a bot that vanished from a re-queried day doesn't linger.
  const refreshed = new Set(next.map((r) => r.date));
  for (const [k, r] of m) if (refreshed.has(r.date)) m.delete(k);
  for (const r of next) m.set(key(r), r);
  return [...m.values()].filter((r) => !keepFrom || r.date >= keepFrom).sort((a, b) => a.date.localeCompare(b.date));
}

/** Rows with from <= date <= to. */
export const within = <T extends { date: string }>(rows: T[], from: ISODate, to: ISODate) => rows.filter((r) => r.date >= from && r.date <= to);

/** ISO day `n` days before `d`. */
export function shiftDay(d: ISODate, n: number): ISODate {
  return new Date(Date.parse(`${d}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** Every day from..to inclusive, so charts show gaps as zeros instead of skipping them. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Sum `pick` over rows. */
export const total = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);

/** Change as a 0–1 ratio from `before` to `after`; null without a baseline. */
export const change = (after: number, before: number) => (before > 0 ? (after - before) / before : null);

/** Crawler requests per bot over rows, with last-seen day, biggest first. */
export function crawlerTotals(rows: CrawlerDay[]): { bot: BotDef; requests: number; lastSeen: ISODate }[] {
  const m = new Map<string, { bot: BotDef; requests: number; lastSeen: ISODate }>();
  for (const r of rows) {
    const bot = botById(r.bot);
    if (!bot) continue;
    const row = m.get(r.bot) ?? { bot, requests: 0, lastSeen: r.date };
    row.requests += r.requests;
    if (r.date > row.lastSeen) row.lastSeen = r.date;
    m.set(r.bot, row);
  }
  return [...m.values()].sort((a, b) => b.requests - a.requests);
}

/** Bucket daily values into weeks (7-day groups ending on the last day) when a range is too long to read per day. */
export function bucketDays(days: ISODate[], size: number): { label: ISODate; from: ISODate; to: ISODate; days: ISODate[] }[] {
  if (size <= 1) return days.map((d) => ({ label: d, from: d, to: d, days: [d] }));
  const out: { label: ISODate; from: ISODate; to: ISODate; days: ISODate[] }[] = [];
  for (let end = days.length; end > 0; end -= size) {
    const chunk = days.slice(Math.max(0, end - size), end);
    out.unshift({ label: chunk[0]!, from: chunk[0]!, to: chunk.at(-1)!, days: chunk });
  }
  return out;
}

/** Proxy coverage of the site's own hostnames (the apex and www) from the zone's DNS records. */
export function edgeCoverage(records: { name: string; type: string; content: string; proxied?: boolean }[], zone: string): EdgeCoverage {
  const site = new Set([zone, `www.${zone}`]);
  const hosts = new Map<string, { name: string; proxied: boolean; target: string }>();
  for (const r of records) {
    if (!site.has(r.name) || !['A', 'AAAA', 'CNAME'].includes(r.type)) continue;
    const prev = hosts.get(r.name);
    // A host with several records is proxied only if all of them are.
    hosts.set(r.name, { name: r.name, proxied: (prev?.proxied ?? true) && !!r.proxied, target: prev?.target ?? r.content });
  }
  const list = [...hosts.values()].sort((a, b) => a.name.length - b.name.length);
  return { proxied: list.length ? list.every((h) => h.proxied) : null, hosts: list };
}

/** The mock data is proxied. `?edge=dns-only` previews the not-proxied state, like `?simulate=` (mock mode only). */
export function reviewEdge(edge: EdgeCoverage | null, kind: 'mock' | 'snapshot', url: URL): EdgeCoverage | null {
  if (kind !== 'mock' || url.searchParams.get('edge') !== 'dns-only' || !edge) return edge;
  return { proxied: false, hosts: edge.hosts.map((h) => ({ ...h, proxied: false, target: 'cdn.webflow.com' })) };
}

/** Why edge-based panels (requests, crawlers, 404s) are empty or partial, or null when they're complete. */
export function edgeGap(edge: EdgeCoverage | null): string | null {
  if (!edge || edge.proxied !== false) return null;
  const direct = edge.hosts.filter((h) => !h.proxied);
  const names = direct.map((h) => h.name).join(' and ');
  const target = [...new Set(direct.map((h) => h.target))].join(', ');
  return `${names} ${direct.length === 1 ? 'is' : 'are'} DNS-only in Cloudflare (grey cloud), so visitors and crawlers go straight to ${target} and never pass through Cloudflare. These counts only cover the zone's proxied subdomains. Visits, pages and referrers still work: they come from Web Analytics, which runs in the page.`;
}

export const bytes = (n: number) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) (n /= 1000), i++;
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
};
