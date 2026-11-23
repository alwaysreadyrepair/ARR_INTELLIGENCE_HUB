/* Synthetic web-traffic snapshot. Deterministic (seeded) and anchored to "today", like the other mocks.
 * ONLY src/repositories/mock/* may import this file.
 *
 * Bots and AI assistants are the real catalog (src/data/traffic/bots.ts); every count is invented. The paths are
 * plausible page paths for an HVAC site, not a crawl of ARR's. */

import type { CrawledPath, CrawlerDay, NotFoundPath, PageCount, ReferrerCount, TrafficSnapshot, VisitDay, ZoneDay } from '../../domain/traffic.ts';
import { rng } from '../../lib/rng.ts';
import { BOTS } from '../traffic/bots.ts';
import { SITE_DOMAIN } from '../seo/targets.ts';

const DAY = 86_400_000;
const HISTORY_DAYS = 400;
const TOP_WINDOW = 30;

const PAGES: [string, number][] = [
  ['/', 30], ['/furnace-repair', 12], ['/ac-repair', 11], ['/furnace-replacement', 7], ['/ac-installation', 6],
  ['/boiler-repair', 4], ['/maintenance-plan', 4], ['/contact', 6], ['/financing', 3], ['/reviews', 3],
  ['/service-areas/orland-park', 4], ['/service-areas/tinley-park', 3], ['/service-areas/palos-heights', 2],
  ['/service-areas/homer-glen', 2], ['/blog/furnace-short-cycling', 2], ['/blog/how-long-do-furnaces-last', 2],
  ['/blog/ac-not-cooling', 2], ['/coupons', 3], ['/about', 2], ['/careers', 1]
];

const REFERRERS: [string, number][] = [
  ['www.google.com', 62], ['www.bing.com', 6], ['duckduckgo.com', 2], ['l.facebook.com', 5], ['nextdoor.com', 3],
  ['www.yelp.com', 2], ['chatgpt.com', 4], ['perplexity.ai', 1.2], ['gemini.google.com', 0.6], ['copilot.microsoft.com', 0.4],
  ['claude.ai', 0.2], ['search.yahoo.com', 1], ['www.angi.com', 1]
];

/** Requests per day for each bot, before noise. User-triggered AI fetches grow over the year. */
const BOT_RATE: Record<string, number> = {
  googlebot: 420, bingbot: 160, gptbot: 70, 'oai-searchbot': 35, 'chatgpt-user': 14, claudebot: 55, 'claude-searchbot': 8, 'claude-user': 3,
  perplexitybot: 22, 'perplexity-user': 6, applebot: 30, amazonbot: 25, 'meta-externalagent': 40, bytespider: 18, ccbot: 6,
  'google-cloudvertexbot': 2, duckassistbot: 4
};
const GROWING = new Set(['chatgpt-user', 'oai-searchbot', 'claude-user', 'perplexity-user', 'claude-searchbot']);

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** HVAC demand is two-humped: summer AC and winter heating, quiet in spring and fall. */
function season(t: number): number {
  const doy = (new Date(t).getUTCMonth() * 30.4 + new Date(t).getUTCDate()) / 365;
  // |cos| peaks mid-July and mid-January.
  return 1 + 0.35 * Math.abs(Math.cos(2 * Math.PI * (doy - 0.55)));
}

export function buildMockTrafficSnapshot(now: Date): TrafficSnapshot {
  const r = rng(9191);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = today - DAY; // last complete UTC day
  const dayTimes = Array.from({ length: HISTORY_DAYS }, (_, i) => end - (HISTORY_DAYS - 1 - i) * DAY);

  const visits: VisitDay[] = [];
  const days: ZoneDay[] = [];
  const crawlers: CrawlerDay[] = [];
  dayTimes.forEach((t, i) => {
    const date = isoDay(t);
    const growth = 0.8 + 0.25 * (i / HISTORY_DAYS);
    const weekend = [0, 6].includes(new Date(t).getUTCDay()) ? 0.72 : 1;
    const v = Math.max(5, Math.round(r.normal(95 * season(t) * growth * weekend, 9)));
    const pv = Math.round(v * r.normal(2.3, 0.15));
    visits.push({ date, visits: v, pageViews: pv });

    let botReq = 0;
    for (const b of BOTS) {
      const base = BOT_RATE[b.id] ?? 0;
      const rate = base * (GROWING.has(b.id) ? 0.3 + 1.4 * (i / HISTORY_DAYS) : 1) * (r.next() < 0.04 ? 3 : 1);
      const n = Math.max(0, Math.round(r.normal(rate, rate * 0.25)));
      if (n > 0) crawlers.push({ date, bot: b.id, requests: n });
      botReq += n;
    }
    // Everything through the zone: humans (pages + assets), known bots, and unattributed automated traffic.
    const requests = Math.round(pv * r.normal(28, 2) + botReq + r.normal(1800, 250));
    const cachedRequests = Math.round(requests * r.normal(0.71, 0.03));
    const bytesPer = r.normal(42_000, 3000);
    days.push({
      date, requests, cachedRequests,
      bytes: Math.round(requests * bytesPer), cachedBytes: Math.round(cachedRequests * bytesPer * 1.1),
      pageViews: Math.round(pv * 1.9 + botReq * 0.7),
      uniques: Math.round(v * 1.6 + r.normal(260, 30)),
      threats: Math.max(0, Math.round(r.normal(14, 8))),
      status4xx: Math.round(requests * r.normal(0.012, 0.003)),
      status5xx: Math.max(0, Math.round(r.normal(3, 3)))
    });
  });

  const window = { from: isoDay(end - (TOP_WINDOW - 1) * DAY), to: isoDay(end) };
  const recent = visits.slice(-TOP_WINDOW);
  const winVisits = recent.reduce((s, d) => s + d.visits, 0);
  const winViews = recent.reduce((s, d) => s + d.pageViews, 0);
  const pw = PAGES.reduce((s, [, w]) => s + w, 0);
  const pages: PageCount[] = PAGES.map(([path, w]) => ({
    path,
    pageViews: Math.round((winViews * w) / pw * r.normal(1, 0.08)),
    visits: Math.round((winVisits * w) / pw * r.normal(path === '/' ? 1.3 : 0.9, 0.1))
  })).sort((a, b) => b.pageViews - a.pageViews);
  const rw = REFERRERS.reduce((s, [, w]) => s + w, 0);
  const referred = winVisits * 0.68; // the rest arrive with no referrer (typed, bookmarks, apps)
  const referrers: ReferrerCount[] = REFERRERS.map(([host, w]) => ({ host, visits: Math.max(1, Math.round((referred * w) / rw * r.normal(1, 0.1))) })).sort((a, b) => b.visits - a.visits);

  const recentCrawl = crawlers.filter((c) => c.date >= window.from);
  const crawledPaths: CrawledPath[] = [];
  for (const b of BOTS) {
    const n = recentCrawl.filter((c) => c.bot === b.id).reduce((s, c) => s + c.requests, 0);
    if (!n) continue;
    const paths = [...PAGES.map(([p]) => p), '/robots.txt', '/sitemap.xml', '/llms.txt'];
    let left = n;
    for (const p of paths) {
      const share = p === '/robots.txt' ? 0.08 : p === '/sitemap.xml' ? 0.04 : p === '/llms.txt' ? (b.purpose === 'search-engine' ? 0 : 0.01) : r.next() * 0.09;
      const k = Math.min(left, Math.round(n * share));
      if (k > 0) crawledPaths.push({ bot: b.id, path: p, requests: k });
      left -= k;
    }
  }
  crawledPaths.sort((a, b) => b.requests - a.requests);

  const notFound: NotFoundPath[] = [
    ['/wp-login.php', 340], ['/xmlrpc.php', 120], ['/services/furnace-repair-old', 64], ['/blog/2019-rebates', 41], ['/.env', 38],
    ['/apple-touch-icon.png', 33], ['/service-areas/mokena', 22], ['/specials', 17], ['/hvac-tips', 9]
  ].map(([path, n]) => ({ path: path as string, requests: Math.round((n as number) * r.normal(1, 0.15)) })).sort((a, b) => b.requests - a.requests);

  return {
    version: 1,
    takenAt: new Date(Math.min(now.getTime(), today + 6 * 3_600_000)).toISOString(),
    zone: SITE_DOMAIN,
    edge: { proxied: true, hosts: [{ name: SITE_DOMAIN, proxied: true, target: 'origin.example' }, { name: `www.${SITE_DOMAIN}`, proxied: true, target: 'origin.example' }] },
    days, visits, crawlers,
    pages: { window, rows: pages },
    referrers: { window, rows: referrers },
    crawledPaths: { window, rows: crawledPaths.slice(0, 200) },
    notFound: { window, rows: notFound }
  };
}
