/* Cloudflare API client for the traffic refresh: a few REST lookups and the GraphQL Analytics API.
 * Reading analytics is free, and the token only needs read permissions (see README, "Web Traffic").
 * The query builders and parsers are pure so they can be tested without the network. */

import type { CrawledPath, CrawlerDay, NotFoundPath, PageCount, ReferrerCount, VisitDay, ZoneDay } from '../../domain/traffic.ts';
import { classifyBot } from './stats.ts';

export const API = 'https://api.cloudflare.com/client/v4';

export interface CfClient {
  rest<T>(path: string): Promise<T>;
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export function createCfClient(token: string, fetchFn: typeof fetch = fetch): CfClient {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  return {
    async rest<T>(path: string) {
      const res = await fetchFn(`${API}${path}`, { headers });
      const body = (await res.json().catch(() => null)) as { success?: boolean; result?: T; errors?: { message: string }[] } | null;
      if (!res.ok || !body?.success) throw new Error(`Cloudflare ${path}: ${body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`}`);
      return body.result as T;
    },
    async graphql<T>(query: string, variables: Record<string, unknown>) {
      const res = await fetchFn(`${API}/graphql`, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
      const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] | null } | null;
      if (!res.ok) throw new Error(`Cloudflare GraphQL: HTTP ${res.status}`);
      if (body?.errors?.length) throw new Error(`Cloudflare GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
      if (!body?.data) throw new Error('Cloudflare GraphQL: empty response');
      return body.data;
    }
  };
}

// ── Queries ──

/** Daily totals for the zone. httpRequests1dGroups is on every plan. */
export const ZONE_DAYS = `query ZoneDays($zone: String!, $from: Date!, $to: Date!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequests1dGroups(limit: 400, filter: { date_geq: $from, date_leq: $to }, orderBy: [date_ASC]) {
      dimensions { date }
      sum { requests cachedRequests bytes cachedBytes pageViews threats responseStatusMap { edgeResponseStatus requests } }
      uniq { uniques }
    }
  } }
}`;

/** Web Analytics (RUM) for one site over one window: per day, top pages, top referrers. */
export const RUM = `query Rum($account: String!, $site: String!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    days: rumPageloadEventsAdaptiveGroups(limit: 100, filter: { siteTag: $site, datetime_geq: $from, datetime_lt: $to }, orderBy: [date_ASC]) {
      count sum { visits } dimensions { date }
    }
    pages: rumPageloadEventsAdaptiveGroups(limit: 50, filter: { siteTag: $site, datetime_geq: $from, datetime_lt: $to }, orderBy: [count_DESC]) {
      count sum { visits } dimensions { requestPath }
    }
    referrers: rumPageloadEventsAdaptiveGroups(limit: 50, filter: { siteTag: $site, datetime_geq: $from, datetime_lt: $to, refererHost_neq: "" }, orderBy: [sum_visits_DESC]) {
      sum { visits } dimensions { refererHost }
    }
  } }
}`;

/** Requests from known crawlers, by day and User-Agent, plus the paths they fetched, and the top 404s. The
 *  `OR` filter is built from BOTS, so only matching requests are counted. */
export function crawlerQuery(matches: string[]): string {
  const or = matches.map((m) => `{ userAgent_like: ${JSON.stringify(`%${m}%`)} }`).join(', ');
  return `query Crawlers($zone: String!, $from: Time!, $to: Time!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    byDay: httpRequestsAdaptiveGroups(limit: 5000, filter: { datetime_geq: $from, datetime_lt: $to, OR: [${or}] }, orderBy: [count_DESC]) {
      count dimensions { date userAgent }
    }
    byPath: httpRequestsAdaptiveGroups(limit: 2000, filter: { datetime_geq: $from, datetime_lt: $to, OR: [${or}] }, orderBy: [count_DESC]) {
      count dimensions { userAgent clientRequestPath }
    }
    notFound: httpRequestsAdaptiveGroups(limit: 25, filter: { datetime_geq: $from, datetime_lt: $to, edgeResponseStatus: 404 }, orderBy: [count_DESC]) {
      count dimensions { clientRequestPath }
    }
  } }
}`;
}

// ── Response shapes ──

export interface ZoneDaysResponse {
  viewer: { zones: { httpRequests1dGroups: {
    dimensions: { date: string };
    sum: { requests: number; cachedRequests: number; bytes: number; cachedBytes: number; pageViews: number; threats: number; responseStatusMap: { edgeResponseStatus: number; requests: number }[] };
    uniq: { uniques: number };
  }[] }[] };
}

export interface RumResponse {
  viewer: { accounts: {
    days: { count: number; sum: { visits: number }; dimensions: { date: string } }[];
    pages: { count: number; sum: { visits: number }; dimensions: { requestPath: string } }[];
    referrers: { sum: { visits: number }; dimensions: { refererHost: string } }[];
  }[] };
}

export interface CrawlerResponse {
  viewer: { zones: {
    byDay: { count: number; dimensions: { date: string; userAgent: string } }[];
    byPath: { count: number; dimensions: { userAgent: string; clientRequestPath: string } }[];
    notFound: { count: number; dimensions: { clientRequestPath: string } }[];
  }[] };
}

// ── Parsers ──

export function parseZoneDays(r: ZoneDaysResponse): ZoneDay[] {
  const groups = r.viewer.zones[0]?.httpRequests1dGroups ?? [];
  return groups.map((g) => {
    const byClass = (lo: number) => g.sum.responseStatusMap.filter((s) => s.edgeResponseStatus >= lo && s.edgeResponseStatus < lo + 100).reduce((t, s) => t + s.requests, 0);
    return {
      date: g.dimensions.date,
      requests: g.sum.requests,
      cachedRequests: g.sum.cachedRequests,
      bytes: g.sum.bytes,
      cachedBytes: g.sum.cachedBytes,
      pageViews: g.sum.pageViews,
      uniques: g.uniq.uniques,
      threats: g.sum.threats,
      status4xx: byClass(400),
      status5xx: byClass(500)
    };
  });
}

export function parseRum(r: RumResponse, ownHost: string): { days: VisitDay[]; pages: PageCount[]; referrers: ReferrerCount[] } {
  const a = r.viewer.accounts[0];
  if (!a) return { days: [], pages: [], referrers: [] };
  const own = ownHost.replace(/^www\./, '');
  return {
    days: a.days.map((d) => ({ date: d.dimensions.date, visits: d.sum.visits, pageViews: d.count })),
    pages: a.pages.map((p) => ({ path: p.dimensions.requestPath || '/', pageViews: p.count, visits: p.sum.visits })),
    // Internal navigation shows up with our own host as referrer. It isn't a source.
    referrers: a.referrers
      .map((x) => ({ host: x.dimensions.refererHost.toLowerCase(), visits: x.sum.visits }))
      .filter((x) => x.host && x.visits > 0 && x.host.replace(/^www\./, '') !== own)
  };
}

export function parseCrawlers(r: CrawlerResponse): { days: CrawlerDay[]; paths: CrawledPath[]; notFound: NotFoundPath[] } {
  const z = r.viewer.zones[0];
  if (!z) return { days: [], paths: [], notFound: [] };
  const days = new Map<string, CrawlerDay>();
  for (const g of z.byDay) {
    const bot = classifyBot(g.dimensions.userAgent);
    if (!bot) continue;
    const key = `${g.dimensions.date}|${bot.id}`;
    const row = days.get(key) ?? { date: g.dimensions.date, bot: bot.id, requests: 0 };
    row.requests += g.count;
    days.set(key, row);
  }
  const paths = new Map<string, CrawledPath>();
  for (const g of z.byPath) {
    const bot = classifyBot(g.dimensions.userAgent);
    if (!bot) continue;
    const key = `${bot.id}|${g.dimensions.clientRequestPath}`;
    const row = paths.get(key) ?? { bot: bot.id, path: g.dimensions.clientRequestPath, requests: 0 };
    row.requests += g.count;
    paths.set(key, row);
  }
  return {
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date) || b.requests - a.requests),
    paths: [...paths.values()].sort((a, b) => b.requests - a.requests),
    notFound: z.notFound.map((n) => ({ path: n.dimensions.clientRequestPath, requests: n.count }))
  };
}
