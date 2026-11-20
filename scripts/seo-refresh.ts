/* Collects ARR's SEO & AEO data and writes the snapshot the Hub's SEO pages read.
 *
 *   npm run seo:refresh -- --dry-run            what would run, how many paid calls, rough cost
 *   npm run seo:refresh -- --only=audit         the free site crawl only (no DataForSEO key needed)
 *   npm run seo:refresh -- --only=search-console   Google Search Console only (free; needs GSC_SERVICE_ACCOUNT)
 *   npm run seo:refresh                          everything
 *   npm run seo:refresh -- --sandbox            DataForSEO's free sandbox: real request shapes, fake data
 *   npm run seo:load                             put the snapshot in the Hub's local SEO KV
 *
 * Steps: audit, search-console, rankings, local, grid, ai, keywords, competitors. Credentials: DATAFORSEO_LOGIN +
 * DATAFORSEO_PASSWORD (or DATAFORSEO_API_KEY = base64 "login:password") in the environment or .env.
 *
 * AI answers: OPENAI_API_KEY makes the ai step ask ChatGPT through OpenAI's own API, and ANTHROPIC_API_KEY (or
 * ANTHROPIC_AUTH_TOKEN, or ANTHROPIC_PROFILE naming an `ant auth login` profile) asks Claude through Anthropic's, both
 * with web search from AI_SEARCH_LOCATION, instead of DataForSEO. OPENAI_MODEL / ANTHROPIC_MODEL override the
 * models. Other engines, and these two without credentials, go through DataForSEO.
 *
 * Search Console: GSC_SERVICE_ACCOUNT is a service-account JSON key, or the path to the key file. Add the account's
 * client_email as a user on the property in Search Console first. GSC_PROPERTY overrides the property in
 * src/data/seo/targets.ts. Without GSC_SERVICE_ACCOUNT a full refresh skips the step and keeps the old data.
 *
 * Output: .seo/snapshot.json (history merged in, last 26 refreshes kept) and .seo/history/<date>.json. A step that
 * fails is reported and skipped; the previous snapshot's data for that step is kept. Run weekly. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiAnswer, AiEngine, AuditIssue, AuditPage, CompetitorProfile, GridResult, KeywordMetric, LocalPackResult, RankObservation, SearchConsoleData, SeoBrand, SeoSnapshot, SeoSpend, SiteAudit } from '../src/domain/seo.ts';
import { AI_DIRECT, AI_SEARCH_LOCATION, BRAND, COMPETITOR_LIMIT, ENGINES, GRID, GSC_PROPERTY, GSC_WINDOW_DAYS, KEYWORDS, LOCAL_KEYWORDS, MARKETS, NOT_COMPETITORS, PROMPTS, RANK_DEPTH, SITE_DOMAIN } from '../src/data/seo/targets.ts';
import {
  API_BASE, credentialsFromEnv, createClient, ESTIMATE, LLM_SLUG, llmTask, mapsTask, MODEL_FALLBACK, organicTask, parseBacklinks, parseDomainRank,
  parseLlm, parseMaps, parseModels, parseOrganic, parseSearchVolume, PATH, pickModel, SANDBOX_BASE, type Client
} from '../src/lib/seo/dataforseo.ts';
import { matchAnswer, ownedDomain } from '../src/lib/seo/match.ts';
import { auditPage, parseRobots, parseSitemap } from '../src/lib/seo/audit.ts';
import { gridPoints } from '../src/lib/seo/grid.ts';
import { askOpenAi, costOf } from '../src/lib/seo/openai.ts';
import { askClaude, claudeClient, hasAnthropicCredentials } from '../src/lib/seo/claude.ts';
import { accessToken, historyStart, parseServiceAccount, searchAnalytics, totalsOf, windows, withPrevious, type ServiceAccount } from '../src/lib/seo/gsc.ts';

const STEPS = ['audit', 'search-console', 'rankings', 'local', 'grid', 'ai', 'keywords', 'competitors'] as const;
type Step = (typeof STEPS)[number];
const KEEP_REFRESHES = 26;
const CRAWL_LIMIT = 300;
const KEYWORD_LOCATION = 'Chicago,Illinois,United States';
const UA = 'ARR-Intelligence-Hub-Audit/0.1 (+https://alwaysreadyrepair.com)';

const HUB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(HUB, '.seo');

// ── Arguments ──
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
if (flag('help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}
const only = value('only')?.split(',').map((s) => s.trim()) as Step[] | undefined;
const bad = only?.filter((s) => !STEPS.includes(s));
if (bad?.length) fail(`Unknown step(s): ${bad.join(', ')}. Steps: ${STEPS.join(', ')}.`);
const steps = new Set<Step>(only ?? STEPS);
const dryRun = flag('dry-run');
const sandbox = flag('sandbox');

// Search Console is free and needs its own credentials. A full refresh without them skips it; asking for it with
// --only makes a missing key an error.
const gscKey = process.env.GSC_SERVICE_ACCOUNT?.trim();
const gscProperty = process.env.GSC_PROPERTY?.trim() || GSC_PROPERTY;
const gscSkipped = !gscKey && steps.has('search-console');
if (gscSkipped) {
  if (only?.includes('search-console')) fail('No GSC_SERVICE_ACCOUNT. Set it to a service-account JSON key (or the path to one) in .env. See the header of this script.');
  steps.delete('search-console');
}

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
const log = (msg: string) => console.log(msg);

// ── Plan / dry run ──
// ChatGPT goes straight to OpenAI when there's a key; everything else (and ChatGPT without one) through DataForSEO.
// The DataForSEO sandbox is free; direct calls aren't, so a sandbox run skips them.
const openAiKey = sandbox ? undefined : process.env.OPENAI_API_KEY?.trim();
const openAiModel = process.env.OPENAI_MODEL?.trim() || AI_DIRECT.chatgpt.model;
const viaOpenAi = (e: AiEngine) => e === 'chatgpt' && !!openAiKey;
// Claude likewise straight to Anthropic when there are credentials.
const anthropicOn = !sandbox && hasAnthropicCredentials(process.env);
const anthropicModel = process.env.ANTHROPIC_MODEL?.trim() || AI_DIRECT.claude.model;
const viaAnthropic = (e: AiEngine) => e === 'claude' && anthropicOn;
const llmEngines = ENGINES.filter((e): e is keyof typeof LLM_SLUG => e !== 'google_ai_overview' && !viaOpenAi(e) && !viaAnthropic(e));
// A rough direct-answer size for the dry run: a short prompt, a few searches' worth of results read, a short answer.
const DIRECT_GUESS = { inputTokens: 12_000, outputTokens: 1_500, searches: 2 };
const points = gridPoints(MARKETS, GRID.spacingMiles, GRID.marginMiles);
const plan = {
  rankings: { calls: KEYWORDS.length * MARKETS.length, usd: KEYWORDS.length * MARKETS.length * ESTIMATE.organicPer10 * Math.ceil(RANK_DEPTH / 10) },
  local: { calls: LOCAL_KEYWORDS.length * MARKETS.length, usd: LOCAL_KEYWORDS.length * MARKETS.length * ESTIMATE.maps },
  grid: { calls: GRID.keywords.length * points.length, usd: GRID.keywords.length * points.length * ESTIMATE.maps },
  ai: {
    calls: PROMPTS.length * ENGINES.length,
    usd: PROMPTS.length * (llmEngines.length * ESTIMATE.llm + (ENGINES.includes('google_ai_overview') ? ESTIMATE.aiOverviewSerp : 0)
      + (openAiKey && ENGINES.includes('chatgpt') ? costOf(AI_DIRECT.chatgpt.price, DIRECT_GUESS.inputTokens, DIRECT_GUESS.outputTokens, DIRECT_GUESS.searches) : 0)
      + (anthropicOn && ENGINES.includes('claude') ? costOf(AI_DIRECT.claude.price, DIRECT_GUESS.inputTokens, DIRECT_GUESS.outputTokens, DIRECT_GUESS.searches) : 0))
  },
  keywords: { calls: 1, usd: ESTIMATE.searchVolume },
  competitors: { calls: (COMPETITOR_LIMIT + 1) * 2, usd: (COMPETITOR_LIMIT + 1) * (ESTIMATE.domainRank + ESTIMATE.backlinks) }
};
const FREE = new Set<Step>(['audit', 'search-console']);
const paidSteps = [...steps].filter((s) => !FREE.has(s)) as Exclude<Step, 'audit' | 'search-console'>[];
const estimate = paidSteps.reduce((s, k) => s + plan[k].usd, 0);

log(`ARR SEO refresh · ${[...steps].join(', ')}${sandbox ? ' · SANDBOX' : ''}${dryRun ? ' · dry run' : ''}`);
for (const s of steps) {
  if (s === 'audit') log(`  audit        free     crawl of ${SITE_DOMAIN} (up to ${CRAWL_LIMIT} pages)`);
  else if (s === 'search-console') log(`  search-console  free  ${gscProperty}: 16 months by day, top search terms and pages`);
  else log(`  ${s.padEnd(12)} ${String(plan[s].calls).padStart(4)} calls  ~$${plan[s].usd.toFixed(2)}`);
}
if (steps.has('ai')) {
  const how = (e: AiEngine) => (viaOpenAi(e) ? ` (OpenAI API, ${openAiModel})` : viaAnthropic(e) ? ` (Anthropic API, ${anthropicModel})` : '');
  const hint = sandbox ? '' : [!openAiKey && 'OPENAI_API_KEY for ChatGPT', !anthropicOn && 'ANTHROPIC_API_KEY for Claude'].filter(Boolean).join(', ');
  log(`  ai engines   ${ENGINES.map((e) => e + how(e)).join(', ')}${sandbox ? ' · sandbox: direct API calls are skipped' : hint ? ` · to ask directly, set ${hint}` : ''}`);
}
if (gscSkipped) log("  search-console  skipped (no GSC_SERVICE_ACCOUNT); the last snapshot's data is kept");
if (paidSteps.length) log(`  estimate     ~$${estimate.toFixed(2)} (list prices; the snapshot records DataForSEO's actual charge${sandbox ? '; the sandbox charges nothing' : ''})`);
if (dryRun) process.exit(0);

const creds = credentialsFromEnv(process.env);
if (paidSteps.length && !creds) fail('No DataForSEO credentials. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (API credentials from app.dataforseo.com → API Access) in .env, or run with --only=audit.');
const client: Client | null = creds ? createClient(creds, { base: sandbox ? SANDBOX_BASE : API_BASE }) : null;
const claude = anthropicOn && steps.has('ai') ? claudeClient() : null;

// ── State ──
const prev: SeoSnapshot | null = existsSync(join(OUT, 'snapshot.json')) ? (JSON.parse(readFileSync(join(OUT, 'snapshot.json'), 'utf8')) as SeoSnapshot) : null;
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const spend: SeoSpend[] = [];
const failures: string[] = [];
const cost = (area: SeoSpend['area'], usd: number) => {
  const row = spend.find((s) => s.area === area) ?? (spend.push({ date: today, area, calls: 0, usd: 0 }), spend.at(-1)!);
  row.calls++;
  row.usd = Math.round((row.usd + usd) * 10000) / 10000;
};

async function step<T>(name: Step, fn: () => Promise<T>): Promise<T | null> {
  if (!steps.has(name)) return null;
  const t0 = Date.now();
  log(`\n▶ ${name}`);
  try {
    const out = await fn();
    log(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    log(`✖ ${name} failed: ${msg}. Keeping the previous snapshot's ${name} data.`);
    return null;
  }
}

/** Runs `fn` over `xs` with a small concurrency limit, logging progress. */
async function pool<T, R>(xs: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i]!, i);
      if (++done % 10 === 0 || done === xs.length) process.stdout.write(`  ${done}/${xs.length}\r`);
    }
  }));
  process.stdout.write('\n');
  return out;
}

// ── Audit (free) ──
async function fetchText(url: string, redirect: RequestRedirect = 'follow') {
  const res = await fetch(url, { redirect, headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,text/plain;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: res.status < 300 ? await res.text() : '' };
}

async function runAudit(): Promise<SiteAudit> {
  const origin = `https://${SITE_DOMAIN}`;
  const issue = (code: string, severity: AuditIssue['severity'], message: string, aeo = false): AuditIssue => ({ code, severity, message, aeo });
  const siteIssues: AuditIssue[] = [];

  const robotsRes = await fetchText(`${origin}/robots.txt`).catch(() => ({ status: 0, type: '', text: '' }));
  const robotsPresent = robotsRes.status === 200 && !/html/i.test(robotsRes.type);
  const robots = robotsPresent ? parseRobots(robotsRes.text) : { blockedAiBots: [], sitemaps: [] };
  if (!robotsPresent) siteIssues.push(issue('robots-missing', 'low', 'No robots.txt.'));
  if (robots.blockedAiBots.length) siteIssues.push(issue('ai-bots-blocked', 'high', `robots.txt blocks ${robots.blockedAiBots.join(', ')}. Those engines can't read the site, so they can't quote or cite it.`, true));

  // Sitemaps: from robots.txt, else /sitemap.xml. Follow one level of sitemap index.
  const sitemapUrls = robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`];
  const pageUrls = new Set<string>();
  let sitemapFound = false;
  for (const sm of sitemapUrls.slice(0, 3)) {
    const r = await fetchText(sm).catch(() => null);
    if (!r || r.status !== 200) continue;
    sitemapFound = true;
    const parsed = parseSitemap(r.text);
    if (parsed.isIndex) {
      for (const child of parsed.urls.slice(0, 10)) {
        const c = await fetchText(child).catch(() => null);
        if (c?.status === 200) for (const u of parseSitemap(c.text).urls) pageUrls.add(u);
      }
    } else for (const u of parsed.urls) pageUrls.add(u);
  }
  if (!sitemapFound) siteIssues.push(issue('sitemap-missing', 'medium', 'No sitemap found. Google finds new pages more slowly without one.'));
  else if (!robots.sitemaps.length) siteIssues.push(issue('sitemap-not-in-robots', 'low', 'robots.txt doesn\'t list the sitemap.'));

  const llms = await fetchText(`${origin}/llms.txt`).catch(() => null);
  const llmsTxt = !!llms && llms.status === 200 && !/html/i.test(llms.type) && llms.text.trim().length > 0;
  if (!llmsTxt) siteIssues.push(issue('llms-txt-missing', 'low', 'No /llms.txt. Optional, but it hands AI crawlers a plain summary of the business, services and area.', true));

  const sameSite = [...pageUrls].filter((u) => {
    try {
      return ownedDomain(new URL(u).hostname, SITE_DOMAIN);
    } catch {
      return false;
    }
  });
  // One URL per page: the sitemap may use www while we start from the bare domain.
  const key = (u: string) => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const seen = new Set([key(origin)]);
  const toCrawl = [`${origin}/`, ...sameSite.filter((u) => !seen.has(key(u)) && (seen.add(key(u)), true))].slice(0, CRAWL_LIMIT);
  log(`  ${pageUrls.size} sitemap URLs · crawling ${toCrawl.length}`);
  const pages: AuditPage[] = await pool(toCrawl, 4, async (url, i) => {
    try {
      const r = await fetchText(url, i === 0 ? 'follow' : 'manual');
      return auditPage(url, r.status, /html/i.test(r.type) || !r.type ? r.text : '', { home: i === 0 });
    } catch (err) {
      return { url, status: 0, title: null, metaDescription: null, h1Count: 0, wordCount: 0, canonical: null, noindex: false, schemaTypes: [], issues: [issue('fetch-failed', 'high', `Couldn't fetch: ${err instanceof Error ? err.message : String(err)}`)] };
    }
  });
  // Duplicate titles across pages compete with each other.
  const byTitle = new Map<string, AuditPage[]>();
  for (const p of pages) if (p.title) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p]);
  for (const group of byTitle.values()) if (group.length > 1) for (const p of group) p.issues.push(issue('title-duplicate', 'medium', 'Same title as another page; Google may pick the wrong one to rank.'));

  return {
    crawledAt: new Date().toISOString(), pagesCrawled: pages.length, pagesInSitemap: sitemapFound ? pageUrls.size : null,
    robots: { present: robotsPresent, blockedAiBots: robots.blockedAiBots, sitemapListed: robots.sitemaps.length > 0 },
    llmsTxt, siteIssues, pages
  };
}

async function runGrid(): Promise<GridResult[]> {
  const jobs = GRID.keywords.flatMap((keyword) => points.map((p) => ({ keyword, p })));
  log(`  ${points.length} points, ${GRID.spacingMiles} mi apart · ${GRID.keywords.join(', ')}`);
  return pool(jobs, 5, async ({ keyword, p }) => {
    const r = await client!.post(PATH.maps, mapsTask(keyword, p.lat, p.lon, GRID.zoom));
    cost('grid', r.cost);
    const { names, position, topThree } = parseMaps(r.result, SITE_DOMAIN);
    noteNames(names);
    const first = topThree[0];
    return { ...p, date: today, keyword, position, leader: first ? { title: first.title, domain: first.domain } : null } satisfies GridResult;
  });
}

// ── Search Console (free) ──
function serviceAccount(): ServiceAccount {
  const key = gscKey!;
  if (key.startsWith('{')) return parseServiceAccount(key);
  const path = resolve(HUB, key);
  if (!existsSync(path)) throw new Error(`GSC_SERVICE_ACCOUNT points at ${path}, which doesn't exist.`);
  return parseServiceAccount(readFileSync(path, 'utf8'));
}

async function runSearchConsole(): Promise<SearchConsoleData> {
  const sa = serviceAccount();
  const token = await accessToken(sa);
  const q = (body: Parameters<typeof searchAnalytics>[2]) => searchAnalytics(token, gscProperty, body, fetch, sa.client_email);

  // Google lags 2–3 days; the last day it returns is the end of the window.
  const daily = (await q({ startDate: historyStart(today), endDate: today, dimensions: ['date'], rowLimit: 1000 }))
    .map((r) => ({ date: r.keys[0]!, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const end = daily.at(-1)?.date;
  if (!end) throw new Error(`Search Console returned no data for ${gscProperty} in the last 16 months.`);
  const { period, previous } = windows(end, GSC_WINDOW_DAYS);
  log(`  ${daily.length} days of history · window ${period.start} – ${period.end}`);

  const cur = { startDate: period.start, endDate: period.end };
  const before = { startDate: previous.start, endDate: previous.end };
  const [totalNow, totalBefore, queriesNow, queriesBefore, pagesNow, pagesBefore] = await Promise.all([
    q(cur), q(before),
    q({ ...cur, dimensions: ['query'], rowLimit: 1000 }), q({ ...before, dimensions: ['query'], rowLimit: 5000 }),
    q({ ...cur, dimensions: ['page'], rowLimit: 250 }), q({ ...before, dimensions: ['page'], rowLimit: 1000 })
  ]);
  return {
    property: gscProperty, fetchedAt: new Date().toISOString(), period, previous,
    totals: { current: totalsOf(totalNow), previous: totalsOf(totalBefore) },
    daily,
    queries: withPrevious('query', queriesNow, queriesBefore),
    pages: withPrevious('page', pagesNow, pagesBefore)
  };
}

// ── Rankings ──
const top10Counts = new Map<string, number>();
const businessNames = new Map<string, string>();
const noteNames = (names: { title: string; domain: string | null }[]) => {
  for (const n of names) if (n.domain && !businessNames.has(n.domain)) businessNames.set(n.domain, n.title);
};

async function runRankings(): Promise<RankObservation[]> {
  const jobs = KEYWORDS.flatMap((k) => MARKETS.map((m) => ({ k, m })));
  const rows = await pool(jobs, 5, async ({ k, m }) => {
    const r = await client!.post(PATH.organic, organicTask(k.keyword, m.locationName, RANK_DEPTH));
    cost('rankings', r.cost);
    const parsed = parseOrganic(r.result, SITE_DOMAIN);
    for (const d of new Set(parsed.top10)) top10Counts.set(d, (top10Counts.get(d) ?? 0) + 1);
    noteNames(parsed.packNames);
    return { date: today, keyword: k.keyword, marketId: m.id, ...parsed.row } satisfies RankObservation;
  });
  return rows;
}

async function runLocal(): Promise<LocalPackResult[]> {
  const jobs = LOCAL_KEYWORDS.flatMap((keyword) => MARKETS.map((m) => ({ keyword, m })));
  return pool(jobs, 5, async ({ keyword, m }) => {
    const r = await client!.post(PATH.maps, mapsTask(keyword, m.lat, m.lon));
    cost('local', r.cost);
    const { names, ...row } = parseMaps(r.result, SITE_DOMAIN);
    noteNames(names);
    return { date: today, keyword, marketId: m.id, ...row };
  });
}

/** The domains that show up most in our tracked searches, minus ARR and directories. */
function discoverCompetitors(): SeoBrand[] {
  const excluded = (d: string) => ownedDomain(d, SITE_DOMAIN) || NOT_COMPETITORS.some((x) => ownedDomain(d, x)) || /\.(gov|edu)$/.test(d);
  const pretty = (d: string) => d.split('.')[0]!.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return [...top10Counts]
    .filter(([d]) => !excluded(d))
    .sort((a, b) => b[1] - a[1])
    .slice(0, COMPETITOR_LIMIT)
    .map(([domain]) => {
      const name = businessNames.get(domain) ?? [...businessNames].find(([d]) => ownedDomain(d, domain))?.[1] ?? pretty(domain);
      return { domain, name, names: [name], own: false };
    });
}

// ── AI answers ──
async function runAi(competitors: SeoBrand[]): Promise<AiAnswer[]> {
  const models: Partial<Record<keyof typeof LLM_SLUG, string>> = {};
  for (const e of llmEngines) {
    try {
      const catalog = parseModels((await client!.get(PATH.llmModels(LLM_SLUG[e]))).result);
      models[e] = pickModel(e, catalog) ?? MODEL_FALLBACK[e];
    } catch {
      models[e] = MODEL_FALLBACK[e];
    }
    log(`  ${e}: ${models[e]}`);
  }
  const home = MARKETS[0]!;
  const jobs = PROMPTS.flatMap((p) => ENGINES.map((engine) => ({ p, engine })));
  const rows = await pool(jobs, 3, async ({ p, engine }) => {
    const direct = viaOpenAi(engine) ? 'openai' as const : viaAnthropic(engine) ? 'anthropic' as const : null;
    const base = {
      date: today, promptId: p.id, engine: engine as AiEngine, via: direct ?? 'dataforseo' as const,
      model: direct === 'openai' ? openAiModel : direct === 'anthropic' ? anthropicModel : engine === 'google_ai_overview' ? null : (models[engine as keyof typeof LLM_SLUG] ?? null)
    };
    try {
      let answer;
      if (direct) {
        const a = direct === 'openai'
          ? await askOpenAi(openAiKey!, openAiModel, p.text, AI_SEARCH_LOCATION, AI_DIRECT.chatgpt.effort, AI_DIRECT.chatgpt.price)
          : await askClaude(claude!, anthropicModel, p.text, AI_SEARCH_LOCATION, AI_DIRECT.claude.effort, AI_DIRECT.claude.price);
        cost(direct, a.usd);
        if (!a.complete) log(`  ${engine} · ${p.id}: answer cut short or declined`);
        answer = a;
        base.model = a.model;
      } else if (engine === 'google_ai_overview') {
        const r = await client!.post(PATH.organic, organicTask(p.text, home.locationName, 10, true));
        cost('ai', r.cost);
        answer = parseOrganic(r.result, SITE_DOMAIN).aiOverview ?? { text: '', citations: [] };
      } else {
        const r = await client!.post(PATH.llm(LLM_SLUG[engine]), llmTask(engine, models[engine]!, p.text));
        cost('ai', r.cost);
        answer = parseLlm(r.result);
      }
      return { ...base, ...matchAnswer(answer, BRAND, competitors) } satisfies AiAnswer;
    } catch (err) {
      // One engine failing one prompt shouldn't sink the step. It's recorded as unanswered and logged.
      log(`  ${engine} · ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      return { ...base, answered: false, mentioned: false, cited: false, mentionRank: null, competitorsMentioned: [], citedDomains: [], excerpt: '' } satisfies AiAnswer;
    }
  });
  if (rows.every((r) => !r.answered)) throw new Error('No engine returned an answer.');
  return rows;
}

// ── Keywords & competitor profiles ──
async function runKeywords(): Promise<KeywordMetric[]> {
  const r = await client!.post(PATH.searchVolume, { keywords: KEYWORDS.map((k) => k.keyword), location_name: KEYWORD_LOCATION, language_code: 'en' });
  cost('keywords', r.cost);
  const got = new Map(parseSearchVolume(r.result).map((m) => [m.keyword.toLowerCase(), m]));
  return KEYWORDS.map((k) => ({ ...(got.get(k.keyword.toLowerCase()) ?? { keyword: k.keyword, searchVolume: null, cpc: null, competition: null, monthly: [] }), keyword: k.keyword, service: k.service }));
}

async function runCompetitors(competitors: SeoBrand[], ranks: RankObservation[] | null): Promise<CompetitorProfile[]> {
  const brands = [BRAND, ...competitors];
  return pool(brands, 3, async (b) => {
    const [rank, links] = await Promise.all([
      client!.post(PATH.domainRank, { target: b.domain, location_code: 2840, language_code: 'en' }).then((r) => (cost('competitors', r.cost), parseDomainRank(r.result))),
      client!.post(PATH.backlinks, { target: b.domain, include_subdomains: true }).then((r) => (cost('competitors', r.cost), parseBacklinks(r.result)))
    ]);
    const appearances = b.own ? (ranks ?? []).filter((r) => r.position != null && r.position <= 10).length : (top10Counts.get(b.domain) ?? 0);
    return { domain: b.domain, name: b.name, own: b.own, ...rank, ...links, trackedAppearances: appearances };
  });
}

// ── Run ──
const audit = await step('audit', runAudit);
const searchConsole = await step('search-console', runSearchConsole);
const rankings = await step('rankings', runRankings);
const local = await step('local', runLocal);
const grid = await step('grid', runGrid);
// Fresh discovery needs this run's rankings; otherwise keep the last known list.
const competitors = rankings ? discoverCompetitors() : (prev?.targets.competitors ?? []);
if (rankings) log(`\n  competitors: ${competitors.map((c) => `${c.name} (${c.domain})`).join(', ') || 'none found'}`);
const ai = await step('ai', () => runAi(competitors));
const keywords = await step('keywords', runKeywords);
const profiles = await step('competitors', () => runCompetitors(competitors, rankings));

// ── Merge with history and write ──
function merge<T extends { date: string }>(old: T[] | undefined, fresh: T[] | null): T[] {
  const kept = (old ?? []).filter((r) => !fresh || r.date !== today);
  const all = [...kept, ...(fresh ?? [])];
  const dates = [...new Set(all.map((r) => r.date))].sort().slice(-KEEP_REFRESHES);
  return all.filter((r) => dates.includes(r.date));
}
const ranAreas = new Set(spend.map((s) => s.area));
const snapshot: SeoSnapshot = {
  version: 1,
  takenAt: new Date().toISOString(),
  targets: { domain: SITE_DOMAIN, brand: BRAND, markets: MARKETS, keywords: KEYWORDS, prompts: PROMPTS, engines: ENGINES, competitors, rankDepth: RANK_DEPTH },
  rankings: merge(prev?.rankings, rankings),
  local: merge(prev?.local, local),
  grid: merge(prev?.grid, grid),
  ai: merge(prev?.ai, ai),
  keywords: keywords ?? prev?.keywords ?? [],
  competitors: profiles ?? prev?.competitors ?? [],
  audit: audit ?? prev?.audit ?? null,
  searchConsole: searchConsole ?? prev?.searchConsole ?? null,
  spend: [...(prev?.spend ?? []).filter((s) => !(s.date === today && ranAreas.has(s.area))), ...spend].slice(-KEEP_REFRESHES * 6)
};
if (sandbox) {
  log('\nSandbox run: data is fake, so nothing is written. Credentials and request shapes are good.');
} else {
  mkdirSync(join(OUT, 'history'), { recursive: true });
  writeFileSync(join(OUT, 'snapshot.json'), JSON.stringify(snapshot));
  writeFileSync(join(OUT, 'history', `${today}.json`), JSON.stringify(snapshot));
  log(`\nWrote .seo/snapshot.json (${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB). Spent $${spend.reduce((s, x) => s + x.usd, 0).toFixed(2)}.`);
  log('Next: npm run seo:load, then run the Hub with SEO_DATA_SOURCE=snapshot.');
}
if (failures.length) {
  log(`\n${failures.length} step(s) failed:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
}
