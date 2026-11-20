/* Synthetic SEO/AEO snapshot. Deterministic (seeded) and anchored to "today", the same way as the property dataset.
 * ONLY src/repositories/mock/* may import this file.
 *
 * The markets, keywords and prompts are ARR's real targets (src/data/seo/targets.ts). The competitors are invented,
 * with .example domains, so no real company is ever shown with made-up numbers. */

import type {
  AiAnswer, AiEngine, AuditIssue, AuditPage, CompetitorProfile, GridResult, GscMetrics, GscPageRow, GscQueryRow, KeywordMetric, LocalPackResult,
  RankObservation, SearchConsoleData, SeoBrand, SeoSnapshot, SeoSpend, SiteAudit
} from '../../domain/seo.ts';
import { rng } from '../../lib/rng.ts';
import { gridPoints, milesBetween } from '../../lib/seo/grid.ts';
import { BRAND, ENGINES, GRID, GSC_PROPERTY, GSC_WINDOW_DAYS, KEYWORDS, LOCAL_KEYWORDS, MARKETS, PROMPTS, RANK_DEPTH, SITE_DOMAIN } from '../seo/targets.ts';

const DAY = 86_400_000;
const WEEKS = 12;

const COMPETITORS: SeoBrand[] = [
  { domain: 'prairiestatecomfort.example', name: 'Prairie State Comfort', names: ['Prairie State Comfort'], own: false },
  { domain: 'swsheating.example', name: 'Southwest Suburban Heating', names: ['Southwest Suburban Heating'], own: false },
  { domain: 'lakeviewmech.example', name: 'Lakeview Mechanical', names: ['Lakeview Mechanical'], own: false },
  { domain: 'midwestclimatepros.example', name: 'Midwest Climate Pros', names: ['Midwest Climate Pros'], own: false },
  { domain: 'orlandairco.example', name: 'Orland Air Co.', names: ['Orland Air Co.', 'Orland Air'], own: false },
  { domain: 'willcountyhvac.example', name: 'Will County HVAC', names: ['Will County HVAC'], own: false }
];

/** How strong each market is for ARR (0 = home turf). Further out ranks worse. */
const MARKET_DISTANCE: Record<string, number> = { 'orland-park': 0, 'palos-heights': 1, 'tinley-park': 1, 'homer-glen': 2, 'oak-lawn': 2, mokena: 3, frankfort: 4 };

/** Monthly search seasonality, Jan..Dec, by service. Furnace work peaks in late fall, AC in midsummer. */
const SEASON: Record<string, number[]> = {
  heat: [1.5, 1.25, 0.9, 0.6, 0.45, 0.4, 0.4, 0.45, 0.7, 1.3, 1.7, 1.75],
  cool: [0.3, 0.3, 0.45, 0.75, 1.3, 1.9, 2.1, 1.7, 1.0, 0.5, 0.3, 0.3],
  flat: [1, 0.95, 1, 1, 1.05, 1.1, 1.15, 1.1, 1, 1, 1, 1]
};
const seasonOf = (service: string) => (['furnace', 'boiler', 'maintenance'].includes(service) ? 'heat' : ['ac'].includes(service) ? 'cool' : 'flat');

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export function buildMockSeoSnapshot(now: Date): SeoSnapshot {
  const r = rng(4242);
  // Weekly refreshes on Mondays, the newest one this week.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const lastMonday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
  const dates = Array.from({ length: WEEKS }, (_, i) => isoDay(lastMonday - (WEEKS - 1 - i) * 7 * DAY));
  const latest = dates[dates.length - 1]!;

  // ── Organic rankings: a random walk per keyword × market, drifting slightly better over the quarter. ──
  const rankings: RankObservation[] = [];
  for (const k of KEYWORDS) {
    for (const m of MARKETS) {
      const dist = MARKET_DISTANCE[m.id] ?? 3;
      let pos = Math.max(1, Math.round(r.normal(3 + dist * 5 + (k.service === 'boiler' ? 8 : 0), 3)));
      const absent = r.next() < 0.06 * dist;
      for (const date of dates) {
        pos = Math.min(60, Math.max(1, Math.round(pos + r.normal(-0.15, 1.4))));
        const position = absent || pos > RANK_DEPTH ? null : pos;
        const comp = r.pick(COMPETITORS);
        const features = ['local_pack', ...(r.next() < 0.55 ? ['people_also_ask'] : []), ...(r.next() < 0.35 ? ['ai_overview'] : [])];
        rankings.push({
          date, keyword: k.keyword, marketId: m.id, position,
          url: position == null ? null : `https://${SITE_DOMAIN}${k.service === 'general' ? '/' : `/${k.service}`}`,
          topCompetitor: position === 1 ? null : { domain: comp.domain, position: position == null ? r.int(1, 3) : Math.max(1, Math.min(position - 1, r.int(1, 3))) },
          features,
          inLocalPack: dist <= 1 ? r.next() < 0.7 : r.next() < 0.2
        });
      }
    }
  }

  // ── Map pack (last 6 weeks only: it was added to the refresh later). ──
  const local: LocalPackResult[] = [];
  for (const keyword of LOCAL_KEYWORDS) {
    for (const m of MARKETS) {
      const dist = MARKET_DISTANCE[m.id] ?? 3;
      let pos = Math.max(1, Math.round(r.normal(1.5 + dist * 2.2, 1.2)));
      for (const date of dates.slice(-6)) {
        pos = Math.min(20, Math.max(1, Math.round(pos + r.normal(0, 0.8))));
        const position = dist >= 4 && r.next() < 0.5 ? null : pos;
        const others = [...COMPETITORS].sort(() => r.next() - 0.5).slice(0, 3).map((c) => ({ title: c.name, domain: c.domain, rating: Math.round(r.normal(4.6, 0.2) * 10) / 10, reviews: r.int(40, 900) }));
        const arr = { title: BRAND.name, domain: SITE_DOMAIN, rating: 4.9, reviews: 612 };
        const topThree = [...others];
        if (position != null && position <= 3) topThree.splice(position - 1, 1, arr);
        local.push({ date, keyword, marketId: m.id, position, topThree });
      }
    }
  }

  // ── Map-pack grid (last 4 weeks: the newest step). Seeded on its own so the rest of the mock doesn't shift. ──
  const grid = buildMockGrid(dates.slice(-4));

  // ── AI answers: every prompt × engine every week. ARR shows up more often over time. ──
  const BASE: Record<AiEngine, number> = { perplexity: 0.42, chatgpt: 0.26, gemini: 0.2, claude: 0.2, google_ai_overview: 0.16 };
  const ai: AiAnswer[] = [];
  for (const p of PROMPTS) {
    for (const engine of ENGINES) {
      for (const [i, date] of dates.entries()) {
        const answered = engine === 'google_ai_overview' ? r.next() < 0.6 : r.next() < 0.97;
        const mentioned = answered && r.next() < BASE[engine] + i * 0.012;
        const cited = mentioned && r.next() < (engine === 'perplexity' ? 0.7 : 0.35);
        const competitorsMentioned = answered ? COMPETITORS.filter(() => r.next() < 0.33).map((c) => c.domain) : [];
        const mentionRank = mentioned ? r.int(1, competitorsMentioned.length + 1) : null;
        const citedDomains = answered ? [...(cited ? [SITE_DOMAIN] : []), ...competitorsMentioned.filter(() => r.next() < 0.4), ...(r.next() < 0.5 ? ['yelp.com'] : []), ...(r.next() < 0.3 ? ['angi.com'] : [])] : [];
        const names = [...(mentioned ? [BRAND.name] : []), ...competitorsMentioned.map((d) => COMPETITORS.find((c) => c.domain === d)!.name)];
        ai.push({
          date, promptId: p.id, engine, answered, mentioned, cited, mentionRank, competitorsMentioned, citedDomains,
          // ChatGPT shows as asked directly through OpenAI, the way a refresh with OPENAI_API_KEY records it.
          via: engine === 'chatgpt' ? 'openai' : 'dataforseo', model: engine === 'chatgpt' ? 'gpt-5.5' : null,
          excerpt: !answered ? '' : names.length
            ? `For this, homeowners in the area often look at ${names.join(', ')}. Compare upfront pricing, warranty terms and how quickly each can schedule a visit.`
            : 'Look for a licensed, insured contractor with recent reviews, clear pricing and a written estimate before any work starts.'
        });
      }
    }
  }

  // ── Keyword demand (Chicago market) with seasonality. ──
  const keywords: KeywordMetric[] = KEYWORDS.map((k) => {
    const base = r.int(90, 2400);
    const shape = SEASON[seasonOf(k.service)]!;
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12 + i, 1));
      return { month: d.toISOString().slice(0, 7), volume: Math.round(base * shape[d.getUTCMonth()]! * r.normal(1, 0.06)) };
    });
    return {
      keyword: k.keyword, service: k.service,
      searchVolume: Math.round(monthly.reduce((s, x) => s + x.volume, 0) / 12),
      cpc: Math.round(r.normal(18, 7) * 100) / 100,
      competition: r.pick(['MEDIUM', 'HIGH', 'HIGH'] as const),
      monthly
    };
  });

  // ── Competitor footprints. ──
  const appearances = new Map<string, number>();
  for (const row of rankings) if (row.date === latest && row.topCompetitor) appearances.set(row.topCompetitor.domain, (appearances.get(row.topCompetitor.domain) ?? 0) + 1);
  const competitors: CompetitorProfile[] = [BRAND, ...COMPETITORS].map((b) => ({
    domain: b.domain, name: b.name, own: b.own,
    organicKeywords: b.own ? 412 : r.int(150, 1900),
    estTraffic: b.own ? 1830 : r.int(600, 9000),
    top3Keywords: b.own ? 61 : r.int(20, 260),
    referringDomains: b.own ? 138 : r.int(60, 900),
    backlinks: b.own ? 2210 : r.int(800, 24000),
    trackedAppearances: b.own ? rankings.filter((x) => x.date === latest && x.position != null && x.position <= 10).length : (appearances.get(b.domain) ?? 0) + r.int(4, 30)
  }));

  // ── Site audit. ──
  const issue = (code: string, severity: AuditIssue['severity'], message: string, aeo = false): AuditIssue => ({ code, severity, message, aeo });
  const paths = ['/', '/furnace', '/ac', '/heat-pump', '/boiler', '/maintenance', '/about', '/about/transparent-pricing', '/reviews', '/contact', '/service-area/orland-park', '/service-area/tinley-park', '/blog/furnace-cost-2026', '/blog/heat-pump-vs-furnace', '/financing'];
  const pages: AuditPage[] = paths.map((path) => {
    const issues: AuditIssue[] = [];
    if (r.next() < 0.3) issues.push(issue('meta-description-missing', 'medium', 'No meta description. Google and AI engines write their own summary.'));
    if (r.next() < 0.15) issues.push(issue('title-too-long', 'low', 'Title is over 60 characters and will be cut off in results.'));
    if (r.next() < 0.12) issues.push(issue('h1-missing', 'medium', 'No H1 heading.'));
    if (path !== '/' && r.next() < 0.5) issues.push(issue('no-faq-schema', 'low', 'No FAQPage structured data. Question-and-answer content is what AI answers quote.', true));
    if (r.next() < 0.25) issues.push(issue('images-missing-alt', 'low', `${r.int(1, 6)} images have no alt text.`));
    if (path.startsWith('/blog') && r.next() < 0.5) issues.push(issue('thin-content', 'medium', 'Under 300 words of body text.', true));
    return {
      url: `https://${SITE_DOMAIN}${path}`, status: 200,
      title: `${path === '/' ? 'Heating & Cooling' : path.slice(1).replace(/[-/]/g, ' ')} | ARR Heating + Cooling`,
      metaDescription: issues.some((i) => i.code === 'meta-description-missing') ? null : 'Upfront HVAC pricing for the south suburbs.',
      h1Count: issues.some((i) => i.code === 'h1-missing') ? 0 : 1,
      wordCount: issues.some((i) => i.code === 'thin-content') ? r.int(120, 290) : r.int(450, 1600),
      canonical: `https://${SITE_DOMAIN}${path}`, noindex: false,
      schemaTypes: ['WebPage', ...(path === '/' ? ['HVACBusiness'] : []), ...(issues.some((i) => i.code === 'no-faq-schema') ? [] : path === '/' ? [] : ['FAQPage'])],
      issues
    };
  });
  const audit: SiteAudit = {
    crawledAt: new Date(lastMonday + 6 * 3_600_000).toISOString(),
    pagesCrawled: pages.length, pagesInSitemap: 41,
    robots: { present: true, blockedAiBots: [], sitemapListed: true },
    llmsTxt: false,
    siteIssues: [issue('llms-txt-missing', 'low', 'No /llms.txt. Optional, but it gives AI crawlers a plain summary of the business.', true)],
    pages
  };

  const spend: SeoSpend[] = dates.flatMap((date, i) => [
    { date, area: 'rankings' as const, calls: KEYWORDS.length * MARKETS.length, usd: Math.round(KEYWORDS.length * MARKETS.length * 0.002 * 100) / 100 },
    { date, area: 'ai' as const, calls: PROMPTS.length * ENGINES.length, usd: Math.round(PROMPTS.length * ENGINES.length * 0.012 * 100) / 100 },
    ...(i >= WEEKS - 4 ? [{ date, area: 'grid' as const, calls: GRID.keywords.length * 54, usd: Math.round(GRID.keywords.length * 54 * 0.004 * 100) / 100 }] : []),
    ...(i >= WEEKS - 6 ? [{ date, area: 'local' as const, calls: LOCAL_KEYWORDS.length * MARKETS.length, usd: Math.round(LOCAL_KEYWORDS.length * MARKETS.length * 0.002 * 100) / 100 }] : []),
    ...(i % 4 === 3 ? [{ date, area: 'keywords' as const, calls: 1, usd: 0.08 }, { date, area: 'competitors' as const, calls: 14, usd: 0.42 }] : [])
  ]);

  return {
    version: 1,
    takenAt: new Date(lastMonday + 7 * 3_600_000).toISOString(),
    targets: { domain: SITE_DOMAIN, brand: BRAND, markets: MARKETS, keywords: KEYWORDS, prompts: PROMPTS, engines: ENGINES, competitors: COMPETITORS, rankDepth: RANK_DEPTH },
    rankings, local, grid, ai, keywords, competitors, audit, spend,
    searchConsole: buildMockSearchConsole(now, new Date(lastMonday + 7 * 3_600_000).toISOString())
  };
}

// ── Search Console ──

/** Share of searchers who click a result at each organic position, 1–10; beyond that, a trickle. Typical published
 *  curves for local service searches, close enough for synthetic data. */
const CTR_AT = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.032, 0.026, 0.021, 0.018];
const ctrAt = (pos: number) => CTR_AT[Math.round(pos) - 1] ?? Math.max(0.002, 0.012 - (pos - 10) * 0.001);
/** Whole-site demand by month, Jan..Dec: both heating and cooling seasons show. */
const SITE_SEASON = [1.3, 1.1, 0.8, 0.7, 0.9, 1.3, 1.5, 1.25, 0.8, 1.0, 1.4, 1.5];
const round2 = (n: number) => Math.round(n * 100) / 100;

function metricsFrom(clicks: number, impressions: number, position: number): GscMetrics {
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: round2(position) };
}

/** 16 months of daily site numbers, plus search terms and pages for the last 28 days and the 28 before. Seeded on
 *  its own so it doesn't shift the rest of the mock data. */
export function buildMockSearchConsole(now: Date, fetchedAt: string): SearchConsoleData {
  const r = rng(9090);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = today - 3 * DAY; // Google's reporting lag
  const HISTORY = 486;

  const daily = Array.from({ length: HISTORY }, (_, i) => {
    const t = end - (HISTORY - 1 - i) * DAY;
    const d = new Date(t);
    const growth = 0.75 + 0.35 * (i / HISTORY);
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 0.68 : 1;
    const impressions = Math.max(0, Math.round(1000 * SITE_SEASON[d.getUTCMonth()]! * growth * weekend * r.normal(1, 0.08)));
    const position = Math.max(1, r.normal(15.5 - 4 * (i / HISTORY), 0.6));
    const clicks = Math.round(impressions * Math.min(0.08, 0.034 + (15.5 - position) * 0.002) * r.normal(1, 0.07));
    return { date: isoDay(t), ...metricsFrom(clicks, impressions, position) };
  });

  const days = GSC_WINDOW_DAYS;
  const period = { start: isoDay(end - (days - 1) * DAY), end: isoDay(end), days };
  const previous = { start: isoDay(end - (2 * days - 1) * DAY), end: isoDay(end - days * DAY) };
  const total = (from: string, to: string) => {
    const rows = daily.filter((d) => d.date >= from && d.date <= to);
    const imp = rows.reduce((s, d) => s + d.impressions, 0);
    return metricsFrom(rows.reduce((s, d) => s + d.clicks, 0), imp, imp ? rows.reduce((s, d) => s + d.position * d.impressions, 0) / imp : 0);
  };
  const totals = { current: total(period.start, period.end), previous: total(previous.start, previous.end) };

  // Search terms: brand, each tracked keyword alone / "near me" / with a city, and a few questions.
  const site = `https://www.${SITE_DOMAIN}`;
  const terms: { query: string; page: string; demand: number; pos: number }[] = [
    { query: 'arr heating and cooling', page: '/', demand: 900, pos: 1.1 },
    { query: 'always ready repair', page: '/', demand: 420, pos: 1.2 },
    { query: 'arr hvac', page: '/', demand: 260, pos: 1.6 },
    { query: 'arr heating and cooling reviews', page: '/reviews', demand: 120, pos: 1.4 },
    { query: 'always ready repair orland park', page: '/', demand: 90, pos: 1.1 }
  ];
  const pageFor = (service: string) => (service === 'general' || service === 'emergency' ? '/' : `/${service}`);
  for (const k of KEYWORDS) {
    const base = k.service === 'general' ? 9 : k.service === 'boiler' ? 22 : 12;
    terms.push({ query: k.keyword, page: pageFor(k.service), demand: r.int(900, 4000), pos: r.normal(base + 10, 4) });
    terms.push({ query: `${k.keyword} near me`, page: pageFor(k.service), demand: r.int(500, 2600), pos: r.normal(base + 4, 3) });
    for (const m of MARKETS) {
      if (r.next() < 0.35) continue;
      const dist = MARKET_DISTANCE[m.id] ?? 3;
      const city = m.city.toLowerCase();
      const page = dist <= 1 && r.next() < 0.5 ? `/service-area/${m.id}` : pageFor(k.service);
      terms.push({ query: r.next() < 0.5 ? `${k.keyword} ${city}` : `${city} ${k.keyword}`, page, demand: r.int(40, 520), pos: r.normal(base - 6 + dist * 3, 2.5) });
    }
  }
  for (const [query, page, demand, pos] of [
    ['how much does a new furnace cost', '/blog/furnace-cost-2026', 3200, 9.5],
    ['new furnace cost chicago suburbs', '/blog/furnace-cost-2026', 380, 5.2],
    ['heat pump vs furnace illinois', '/blog/heat-pump-vs-furnace', 1400, 7.8],
    ['furnace blowing cold air', '/furnace', 2100, 16],
    ['ac not cooling house', '/ac', 1800, 18.5],
    ['hvac financing', '/financing', 600, 12],
    ['hvac maintenance plan cost', '/maintenance', 450, 8.4]
  ] as const) terms.push({ query, page, demand, pos });

  const queries: GscQueryRow[] = [];
  const pageTotals = new Map<string, { now: GscMetrics[]; prev: GscMetrics[] }>();
  for (const t of terms) {
    const pos = Math.max(1, t.pos);
    const impressions = Math.max(1, Math.round(t.demand * Math.max(0.08, 1 - pos * 0.035) * r.normal(1, 0.1)));
    const clicks = Math.round(impressions * ctrAt(pos) * r.normal(1, 0.15));
    const prevPos = Math.max(1, pos + r.normal(0.6, 1.4));
    const prevImp = Math.round(impressions * r.normal(0.92, 0.12));
    // A few non-brand terms are new this window; brand searches are always there.
    const prev = r.next() < 0.08 && t.pos > 2 ? null : metricsFrom(Math.round(prevImp * ctrAt(prevPos)), prevImp, prevPos);
    const now = metricsFrom(clicks, impressions, pos);
    queries.push({ query: t.query, ...now, prev });
    const pt = pageTotals.get(t.page) ?? { now: [], prev: [] };
    pt.now.push(now);
    if (prev) pt.prev.push(prev);
    pageTotals.set(t.page, pt);
  }
  queries.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  const sum = (rows: GscMetrics[]) => {
    const imp = rows.reduce((s, x) => s + x.impressions, 0);
    return metricsFrom(rows.reduce((s, x) => s + x.clicks, 0), imp, imp ? rows.reduce((s, x) => s + x.position * x.impressions, 0) / imp : 0);
  };
  const pages: GscPageRow[] = [...pageTotals]
    .map(([path, t]) => ({ page: `${site}${path}`, ...sum(t.now), prev: t.prev.length ? sum(t.prev) : null }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  return { property: GSC_PROPERTY, fetchedAt, period, previous, totals, daily, queries, pages };
}

// ── Map-pack grid ──

/** Grid results around a shop in Orland Park: strong nearby, fading with distance, weakest to the south-east, where
 *  an invented competitor is based. "furnace repair" fades faster than "hvac company". A little better each week. */
function buildMockGrid(dates: string[]): GridResult[] {
  const r = rng(5151);
  const shop = MARKETS.find((m) => m.id === 'orland-park') ?? MARKETS[0]!;
  const points = gridPoints(MARKETS, GRID.spacingMiles, GRID.marginMiles);
  const byName = (name: string) => COMPETITORS.find((c) => c.name === name)!;
  // Who leads where ARR doesn't: by compass direction from the shop.
  const rival = (lat: number, lon: number) =>
    lat < shop.lat - 0.06 ? byName(lon > shop.lon ? 'Will County HVAC' : 'Midwest Climate Pros')
      : lon > shop.lon + 0.04 ? byName(lat > shop.lat ? 'Lakeview Mechanical' : 'Southwest Suburban Heating')
        : byName(r.next() < 0.5 ? 'Orland Air Co.' : 'Prairie State Comfort');
  const out: GridResult[] = [];
  for (const keyword of GRID.keywords) {
    const falloff = keyword === 'furnace repair' ? 0.42 : 0.17;
    const noise = new Map(points.map((p) => [`${p.row},${p.col}`, r.normal(0, 1.1)]));
    for (const [i, date] of dates.entries()) {
      for (const p of points) {
        const dist = milesBetween(p, shop);
        const southEast = p.lat < shop.lat - 0.05 && p.lon > shop.lon ? 3 : 0;
        const raw = 1 + falloff * dist ** 1.6 + southEast + noise.get(`${p.row},${p.col}`)! + r.normal(0, 0.5) - i * 0.25;
        const pos = Math.max(1, Math.round(raw));
        const position = pos > 20 ? null : pos;
        const lead = position === 1 ? { name: BRAND.name, domain: SITE_DOMAIN } : rival(p.lat, p.lon);
        out.push({ ...p, date, keyword, position, leader: { title: lead.name, domain: lead.domain } });
      }
    }
  }
  return out;
}
