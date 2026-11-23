/* Collects ARR's website traffic from Cloudflare and writes the snapshot the Hub's Web Traffic pages read.
 *
 *   npm run traffic:refresh                     zone traffic, Web Analytics, AI crawlers (last 30 days)
 *   npm run traffic:refresh -- --days=90        a longer window for the daily series
 *   npm run traffic:refresh -- --only=zone,rum  some steps only (zone, rum, crawlers)
 *   npm run traffic:load                        put the snapshot in the Hub's local TRAFFIC KV
 *
 * Credentials (.env or the environment):
 *   CLOUDFLARE_API_TOKEN       required. A read-only token: Zone › Zone › Read, Zone › Analytics › Read,
 *                              Zone › DNS › Read (to tell whether the site is proxied), Account › Account Analytics › Read.
 *   CLOUDFLARE_ZONE_ID         optional; found from the zone name (TRAFFIC_ZONE, default the site domain) if unset.
 *   CLOUDFLARE_ACCOUNT_ID      optional; taken from the zone if unset.
 *   CLOUDFLARE_WEB_ANALYTICS_SITE_TAG  optional; looked up by host if unset. Without Web Analytics the visit
 *                              panels say so and the rest still works.
 *
 * Reading analytics is free. Output: .traffic/snapshot.json. Daily series and crawler counts merge into the previous
 * snapshot by date (400 days kept), so running it daily builds history past Cloudflare's own retention. A step that
 * fails is reported and skipped; the previous snapshot's data for that step is kept. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EdgeCoverage, TrafficSnapshot, Window } from '../src/domain/traffic.ts';
import { SITE_DOMAIN } from '../src/data/seo/targets.ts';
import { BOTS } from '../src/data/traffic/bots.ts';
import {
  createCfClient, crawlerQuery, parseCrawlers, parseRum, parseZoneDays, RUM, ZONE_DAYS,
  type CrawlerResponse, type RumResponse, type ZoneDaysResponse
} from '../src/lib/traffic/cloudflare.ts';
import { edgeCoverage, mergeHistory, shiftDay } from '../src/lib/traffic/stats.ts';

const STEPS = ['zone', 'rum', 'crawlers'] as const;
type Step = (typeof STEPS)[number];
const KEEP_DAYS = 400;
/** Adaptive datasets cap how far back and how wide one query can reach, and the cap depends on the plan. The
 *  crawler step asks one day at a time, newest first, and stops at the first day Cloudflare refuses. */
const CRAWLER_DAYS = 7;
/** Web Analytics queries are split into windows of this many days. */
const RUM_CHUNK = 7;

const HUB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(HUB, '.traffic');

const argv = process.argv.slice(2);
const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
if (argv.includes('--help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}
const only = value('only')?.split(',').map((s) => s.trim()) as Step[] | undefined;
const bad = only?.filter((s) => !STEPS.includes(s));
if (bad?.length) fail(`Unknown step(s): ${bad.join(', ')}. Steps: ${STEPS.join(', ')}.`);
const steps = new Set<Step>(only ?? STEPS);
const days = Number(value('days') ?? 30);
if (!Number.isInteger(days) || days < 1 || days > 365) fail('--days must be a whole number from 1 to 365.');

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
const log = (msg: string) => console.log(msg);

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) fail('No CLOUDFLARE_API_TOKEN. Create a read-only API token (see the top of this file for permissions) and put it in .env.');
const cf = createCfClient(token);
const zoneName = process.env.TRAFFIC_ZONE ?? SITE_DOMAIN;

// Complete UTC days only: today is still filling in.
const todayUtc = new Date().toISOString().slice(0, 10);
const to = shiftDay(todayUtc, 1);
const from = shiftDay(to, days - 1);
const window: Window = { from, to };
const failures: string[] = [];

async function step<T>(name: Step, fn: () => Promise<T>): Promise<T | null> {
  if (!steps.has(name)) return null;
  log(`\n▶ ${name}`);
  try {
    const out = await fn();
    log(`✓ ${name}`);
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    log(`✖ ${name} failed: ${msg}. Keeping the previous snapshot's ${name} data.`);
    return null;
  }
}

log(`ARR traffic refresh · ${zoneName} · ${[...steps].join(', ')} · ${from} → ${to} (UTC)`);

// ── Zone and account ──
let zoneId = process.env.CLOUDFLARE_ZONE_ID;
let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!zoneId || !accountId) {
  const zones = await cf.rest<{ id: string; name: string; account: { id: string } }[]>(`/zones?name=${encodeURIComponent(zoneName)}`).catch((e: Error) => fail(`${e.message}. Set CLOUDFLARE_ZONE_ID, or give the token Zone › Zone › Read.`));
  const z = zones[0];
  if (!z) fail(`The token can't see a zone named ${zoneName}. Set TRAFFIC_ZONE or CLOUDFLARE_ZONE_ID.`);
  zoneId ??= z.id;
  accountId ??= z.account.id;
}
log(`  zone ${zoneId} · account ${accountId}`);

const prev: TrafficSnapshot | null = existsSync(join(OUT, 'snapshot.json')) ? (JSON.parse(readFileSync(join(OUT, 'snapshot.json'), 'utf8')) as TrafficSnapshot) : null;

// ── Is the site proxied? Without it, zone, crawler and 404 counts miss the site's own traffic. ──
let edge: EdgeCoverage | null = null;
try {
  const records = await cf.rest<{ name: string; type: string; content: string; proxied?: boolean }[]>(`/zones/${zoneId}/dns_records?per_page=500`);
  edge = edgeCoverage(records, zoneName);
  for (const h of edge.hosts) log(`  ${h.name} → ${h.target} · ${h.proxied ? 'proxied' : 'DNS-only'}`);
  if (edge.proxied === false) log('  ⚠ The site isn\'t fully proxied: edge, crawler and 404 counts will miss its traffic. Web Analytics is unaffected.');
} catch (err) {
  log(`  couldn't read DNS records (${err instanceof Error ? err.message : String(err)}); add Zone › DNS › Read to the token to check proxying.`);
}

// ── Steps ──
const zone = await step('zone', async () => {
  const rows = parseZoneDays(await cf.graphql<ZoneDaysResponse>(ZONE_DAYS, { zone: zoneId, from, to }));
  log(`  ${rows.length} days`);
  return rows;
});

const rum = await step('rum', async () => {
  let site = process.env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG;
  if (!site) {
    const sites = await cf.rest<{ site_tag: string; ruleset?: { zone_name?: string }; host?: string }[]>(`/accounts/${accountId}/rum/site_info/list?per_page=100`);
    site = sites.find((s) => [s.host, s.ruleset?.zone_name].some((h) => h && h.replace(/^www\./, '') === zoneName))?.site_tag;
    if (!site) throw new Error(`No Web Analytics site for ${zoneName}. Turn on Web Analytics for it in the Cloudflare dashboard, or set CLOUDFLARE_WEB_ANALYTICS_SITE_TAG.`);
  }
  const all = { days: [] as ReturnType<typeof parseRum>['days'], pages: new Map<string, { path: string; pageViews: number; visits: number }>(), referrers: new Map<string, number>() };
  for (let start = from; start <= to; start = shiftDay(start, -RUM_CHUNK)) {
    const endDay = [shiftDay(start, -(RUM_CHUNK - 1)), to].sort()[0]!;
    const part = parseRum(await cf.graphql<RumResponse>(RUM, { account: accountId, site, from: `${start}T00:00:00Z`, to: `${shiftDay(endDay, -1)}T00:00:00Z` }), zoneName);
    all.days.push(...part.days);
    // Top-N per chunk, summed: exact for anything that's in every chunk's top 50, which is everything that matters here.
    for (const p of part.pages) {
      const row = all.pages.get(p.path) ?? { path: p.path, pageViews: 0, visits: 0 };
      row.pageViews += p.pageViews;
      row.visits += p.visits;
      all.pages.set(p.path, row);
    }
    for (const x of part.referrers) all.referrers.set(x.host, (all.referrers.get(x.host) ?? 0) + x.visits);
  }
  log(`  ${all.days.length} days · ${all.pages.size} pages · ${all.referrers.size} referrers`);
  return {
    days: all.days,
    pages: [...all.pages.values()].sort((a, b) => b.pageViews - a.pageViews).slice(0, 50),
    referrers: [...all.referrers].map(([host, visits]) => ({ host, visits })).sort((a, b) => b.visits - a.visits).slice(0, 50)
  };
});

const crawl = await step('crawlers', async () => {
  const query = crawlerQuery(BOTS.map((b) => b.match));
  const out = { days: [] as ReturnType<typeof parseCrawlers>['days'], paths: new Map<string, { bot: string; path: string; requests: number }>(), notFound: new Map<string, number>(), from: to };
  for (let i = 0; i < Math.min(CRAWLER_DAYS, days); i++) {
    const day = shiftDay(to, i);
    let part;
    try {
      part = parseCrawlers(await cf.graphql<CrawlerResponse>(query, { zone: zoneId, from: `${day}T00:00:00Z`, to: `${shiftDay(day, -1)}T00:00:00Z` }));
    } catch (err) {
      if (i === 0) throw err;
      log(`  stopped at ${day}: ${err instanceof Error ? err.message : String(err)} (older days are outside this plan's retention)`);
      break;
    }
    out.from = day;
    out.days.push(...part.days);
    for (const p of part.paths) {
      const key = `${p.bot}|${p.path}`;
      const row = out.paths.get(key) ?? { ...p, requests: 0 };
      row.requests += p.requests;
      out.paths.set(key, row);
    }
    for (const n of part.notFound) out.notFound.set(n.path, (out.notFound.get(n.path) ?? 0) + n.requests);
  }
  log(`  ${out.days.reduce((s, d) => s + d.requests, 0)} crawler requests · ${out.from} → ${to}`);
  return {
    days: out.days,
    window: { from: out.from, to },
    paths: [...out.paths.values()].sort((a, b) => b.requests - a.requests).slice(0, 300),
    notFound: [...out.notFound].map(([path, requests]) => ({ path, requests })).sort((a, b) => b.requests - a.requests).slice(0, 25)
  };
});

// ── Write ──
const keepFrom = shiftDay(to, KEEP_DAYS - 1);
const snapshot: TrafficSnapshot = {
  version: 1,
  takenAt: new Date().toISOString(),
  zone: zoneName,
  edge: edge ?? prev?.edge,
  days: mergeHistory(prev?.days ?? [], zone ?? [], (d) => d.date, keepFrom),
  visits: rum ? mergeHistory(prev?.visits ?? [], rum.days, (d) => d.date, keepFrom) : (prev?.visits ?? null),
  crawlers: mergeHistory(prev?.crawlers ?? [], crawl?.days ?? [], (d) => `${d.date}|${d.bot}`, keepFrom),
  pages: rum ? { window, rows: rum.pages } : (prev?.pages ?? null),
  referrers: rum ? { window, rows: rum.referrers } : (prev?.referrers ?? null),
  crawledPaths: crawl ? { window: crawl.window, rows: crawl.paths } : (prev?.crawledPaths ?? null),
  notFound: crawl ? { window: crawl.window, rows: crawl.notFound } : (prev?.notFound ?? null)
};
mkdirSync(join(OUT, 'history'), { recursive: true });
writeFileSync(join(OUT, 'snapshot.json'), JSON.stringify(snapshot));
writeFileSync(join(OUT, 'history', `${todayUtc}.json`), JSON.stringify(snapshot));
log(`\nWrote .traffic/snapshot.json. Next: npm run traffic:load, and TRAFFIC_DATA_SOURCE=snapshot in .dev.vars.`);
if (failures.length) {
  log(`\n${failures.length} step(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(2);
}
