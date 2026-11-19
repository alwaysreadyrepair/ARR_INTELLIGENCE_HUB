/* A lean DataForSEO client and the parsers that turn its results into Hub rows.
 *
 * Endpoints, request fields and the response envelope follow OpenSEO's client (github.com/every-app/open-seo, MIT,
 * server/lib/dataforseo/*, commit 672a66c), cut down to the calls the Hub's refresh makes. The parsers are pure and
 * unit-tested against response fixtures; the client is only used by scripts/seo-refresh.ts, never by a page, so
 * browsing the Hub can't spend money.
 *
 * Every live call is billed when DataForSEO accepts it, so billed calls are never retried: a 5xx doesn't prove the
 * charge was skipped. Only the free model-catalog GET retries. */

import type { CompetitorProfile, KeywordMetric, LocalPackResult, RankObservation } from '../../domain/seo.ts';
import { citationsFrom, markdownToText, ownedDomain, type ParsedAiAnswer } from './match.ts';

export const API_BASE = 'https://api.dataforseo.com';
/** Same requests, fake data, no charge. Good for checking credentials and request shapes. */
export const SANDBOX_BASE = 'https://sandbox.dataforseo.com';

export interface Credentials {
  login: string;
  password: string;
}

/** DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD, or OpenSEO's DATAFORSEO_API_KEY (base64 of "login:password"). */
export function credentialsFromEnv(env: Record<string, string | undefined>): Credentials | null {
  if (env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD) return { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD };
  if (env.DATAFORSEO_API_KEY) {
    const decoded = Buffer.from(env.DATAFORSEO_API_KEY, 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i > 0) return { login: decoded.slice(0, i), password: decoded.slice(i + 1) };
  }
  return null;
}

export interface TaskResult<T = Record<string, unknown>> {
  result: T[];
  cost: number;
}

interface Envelope {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: { status_code?: number; status_message?: string; cost?: number; result?: unknown[] | null }[];
}

export class DataForSeoError extends Error {
  // Plain fields, not parameter properties: Node's type stripping (the refresh script) can't run those.
  readonly path: string;
  readonly cost: number;
  constructor(message: string, path: string, cost = 0) {
    super(message);
    this.name = 'DataForSeoError';
    this.path = path;
    this.cost = cost;
  }
}

/** DataForSEO answers 20000 for a good envelope and task. 40102 is "no results", which isn't a failure. */
export function unwrap<T>(body: Envelope, path: string): TaskResult<T> {
  if (body.status_code !== 20000) throw new DataForSeoError(`DataForSEO ${body.status_code ?? '?'}: ${body.status_message ?? 'no message'} (${path})`, path, body.cost ?? 0);
  const task = body.tasks?.[0];
  if (!task) throw new DataForSeoError(`DataForSEO returned no task (${path})`, path, body.cost ?? 0);
  const cost = task.cost ?? body.cost ?? 0;
  if (task.status_code === 40102) return { result: [], cost };
  if (task.status_code !== 20000) throw new DataForSeoError(`DataForSEO task ${task.status_code ?? '?'}: ${task.status_message ?? 'no message'} (${path})`, path, cost);
  return { result: (task.result ?? []) as T[], cost };
}

export function createClient(creds: Credentials, opts: { base?: string; fetch?: typeof fetch; timeoutMs?: number } = {}) {
  const base = opts.base ?? API_BASE;
  const doFetch = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${creds.login}:${creds.password}`).toString('base64')}`;
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, retries = 0): Promise<TaskResult<T>> {
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 150_000)
      });
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const text = (await res.text()).slice(0, 400);
        const hint = res.status === 401 || res.status === 403 ? ' Check DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (API password, not the dashboard one).' : '';
        throw new DataForSeoError(`DataForSEO HTTP ${res.status} on ${path}.${hint} ${text}`, path);
      }
      return unwrap<T>((await res.json()) as Envelope, path);
    }
  }
  return {
    /** Billed. One task per call, never retried. */
    post: <T>(path: string, task: Record<string, unknown>) => call<T>('POST', path, [task]),
    /** Free reads (catalogs). Retried on 5xx. */
    get: <T>(path: string) => call<T>('GET', path, undefined, 2)
  };
}
export type Client = ReturnType<typeof createClient>;

// ─── Request builders (shapes per DataForSEO v3 docs, as OpenSEO sends them) ───

export const PATH = {
  organic: '/v3/serp/google/organic/live/advanced',
  maps: '/v3/serp/google/maps/live/advanced',
  searchVolume: '/v3/keywords_data/google_ads/search_volume/live',
  domainRank: '/v3/dataforseo_labs/google/domain_rank_overview/live',
  backlinks: '/v3/backlinks/summary/live',
  llmModels: (slug: string) => `/v3/ai_optimization/${slug}/llm_responses/models`,
  llm: (slug: string) => `/v3/ai_optimization/${slug}/llm_responses/live`
} as const;

/** DataForSEO decodes %-escapes in keywords, so a literal % or + has to be escaped. */
const keywordField = (k: string) => k.replace(/%/g, '%25').replace(/\+/g, '%2B');

export const organicTask = (keyword: string, locationName: string, depth: number, aiOverview = false) => ({
  keyword: keywordField(keyword), location_name: locationName, language_code: 'en', device: 'desktop', depth,
  // Loads the AI Overview Google renders after the page. DataForSEO refunds the extra when none loads.
  ...(aiOverview ? { load_async_ai_overview: true } : {})
});

export const mapsTask = (keyword: string, lat: number, lon: number) => ({
  keyword: keywordField(keyword), location_coordinate: `${lat},${lon},13z`, language_code: 'en', depth: 20
});

/** DataForSEO's engine slugs for the LLM Responses API. */
export const LLM_SLUG = { chatgpt: 'chat_gpt', perplexity: 'perplexity', gemini: 'gemini', claude: 'claude' } as const;

/** OpenSEO's model picks (llm-models.ts): newest plain alias wins; an unknown model name fails as a BILLED task, so
 *  the refresh reads the free catalog first and falls back to these only if the catalog is unreachable. */
const MODEL_PATTERN: Record<keyof typeof LLM_SLUG, RegExp> = {
  chatgpt: /^gpt-(\d+(?:\.\d+)*)$/,
  claude: /^claude-sonnet-(\d+(?:-\d+)*)$/,
  gemini: /^gemini-(\d+(?:\.\d+)*)-flash$/,
  perplexity: /^sonar-pro$/
};
export const MODEL_FALLBACK: Record<keyof typeof LLM_SLUG, string> = { chatgpt: 'gpt-5.5', claude: 'claude-sonnet-5', gemini: 'gemini-3.5-flash', perplexity: 'sonar-pro' };

/** Newest model in the catalog that matches the engine's pattern, e.g. gpt-5.5 over gpt-5.2. */
export function pickModel(engine: keyof typeof LLM_SLUG, catalog: string[]): string | null {
  const re = MODEL_PATTERN[engine];
  const version = (m: string) => (m.match(re)?.[1] ?? '').split(/[.-]/).map(Number);
  const hits = catalog.filter((m) => re.test(m));
  hits.sort((a, b) => {
    const va = version(a), vb = version(b);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
    return 0;
  });
  return hits[0] ?? null;
}

export function llmTask(engine: keyof typeof LLM_SLUG, model: string, prompt: string) {
  // `web_search` lets the model look things up (local answers need it). Only Claude accepts force_web_search, and
  // Gemini rejects a search country (both verified by OpenSEO), so those fields are per engine.
  return {
    user_prompt: prompt, model_name: model, web_search: true, max_output_tokens: 1024,
    ...(engine === 'claude' ? { force_web_search: true } : {}),
    ...(engine === 'chatgpt' || engine === 'claude' ? { web_search_country_iso_code: 'US' } : {})
  };
}

// ─── Parsers ───

type Item = Record<string, unknown>;
const items = (result: unknown[]): Item[] => ((result[0] as { items?: Item[] | null } | undefined)?.items ?? []).filter((x): x is Item => !!x && typeof x === 'object');
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bareDomain = (d: string | null) => (d ? d.toLowerCase().replace(/^www\./, '') : null);

export interface OrganicParse {
  row: Omit<RankObservation, 'date' | 'keyword' | 'marketId'>;
  /** Domains in the organic top 10, best first (for competitor discovery). */
  top10: string[];
  /** Local-pack businesses on the page: title by domain (for naming competitors). */
  packNames: { title: string; domain: string | null }[];
  /** The AI Overview, when the request asked for it and Google showed one. */
  aiOverview: ParsedAiAnswer | null;
}

export function parseOrganic(result: unknown[], ownDomain: string): OrganicParse {
  const all = items(result);
  const organic = all.filter((i) => i.type === 'organic' && typeof i.domain === 'string');
  const pos = (i: Item) => numOrNull(i.rank_group) ?? numOrNull(i.rank_absolute);
  const ours = organic.find((i) => ownedDomain(String(i.domain), ownDomain));
  const position = ours ? pos(ours) : null;
  const above = organic.filter((i) => !ownedDomain(String(i.domain), ownDomain) && (position == null || (pos(i) ?? 999) < position));
  const best = above[0];
  const pack = all.filter((i) => i.type === 'local_pack');
  const types = ((result[0] as { item_types?: unknown[] } | undefined)?.item_types ?? []).filter((t): t is string => typeof t === 'string');
  const overview = all.find((i) => i.type === 'ai_overview');
  let aiOverview: ParsedAiAnswer | null = null;
  if (overview) {
    const md = str(overview.markdown) ?? '';
    const nested = Array.isArray(overview.items) ? (overview.items as Item[]) : [];
    const refs = [...(Array.isArray(overview.references) ? overview.references : []), ...nested.flatMap((n) => (Array.isArray(n.references) ? n.references : []))];
    aiOverview = { text: markdownToText(md), citations: citationsFrom(refs) };
  }
  return {
    row: {
      position,
      url: ours ? str(ours.url) : null,
      topCompetitor: best ? { domain: bareDomain(str(best.domain))!, position: pos(best) ?? 0 } : null,
      features: [...new Set(types.filter((t) => t !== 'organic' && t !== 'paid'))],
      inLocalPack: pack.some((i) => typeof i.domain === 'string' && ownedDomain(i.domain, ownDomain))
    },
    top10: organic.filter((i) => (pos(i) ?? 99) <= 10).map((i) => bareDomain(str(i.domain))!),
    packNames: pack.map((i) => ({ title: str(i.title) ?? '', domain: bareDomain(str(i.domain)) })).filter((p) => p.title),
    aiOverview
  };
}

export function parseMaps(result: unknown[], ownDomain: string): Omit<LocalPackResult, 'date' | 'keyword' | 'marketId'> & { names: { title: string; domain: string | null }[] } {
  const list = items(result).filter((i) => i.type === 'maps_search');
  const ours = list.find((i) => typeof i.domain === 'string' && ownedDomain(i.domain, ownDomain));
  const biz = (i: Item) => {
    const rating = (i.rating ?? {}) as { value?: unknown; votes_count?: unknown };
    return { title: str(i.title) ?? '', domain: bareDomain(str(i.domain)), rating: numOrNull(rating.value), reviews: numOrNull(rating.votes_count) };
  };
  return {
    position: ours ? (numOrNull(ours.rank_group) ?? numOrNull(ours.rank_absolute)) : null,
    topThree: list.slice(0, 3).map(biz),
    names: list.map(biz).map(({ title, domain }) => ({ title, domain })).filter((n) => n.title)
  };
}

/** One LLM Responses answer: message sections hold the text, their annotations the cited pages. */
export function parseLlm(result: unknown[]): ParsedAiAnswer {
  const sections = items(result)
    .filter((i) => i.type === 'message')
    .flatMap((i) => (Array.isArray(i.sections) ? (i.sections as Item[]) : []));
  const md = sections.map((s) => str(s.text) ?? '').filter(Boolean).join('\n\n');
  return { text: markdownToText(md), citations: citationsFrom(sections.flatMap((s) => (Array.isArray(s.annotations) ? s.annotations : []))) };
}

export function parseModels(result: unknown[]): string[] {
  return result.map((r) => str((r as Item | null)?.model_name)).filter((m): m is string => !!m);
}

/** Google Ads search volume rows → metrics (without `service`, which the caller knows). */
export function parseSearchVolume(result: unknown[]): Omit<KeywordMetric, 'service'>[] {
  return (result as Item[]).filter((r) => r && typeof r.keyword === 'string').map((r) => {
    const monthly = (Array.isArray(r.monthly_searches) ? (r.monthly_searches as Item[]) : [])
      .map((m) => ({ month: `${String(m.year)}-${String(m.month).padStart(2, '0')}`, volume: numOrNull(m.search_volume) ?? 0 }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12);
    const comp = str(r.competition);
    return {
      keyword: String(r.keyword),
      searchVolume: numOrNull(r.search_volume),
      cpc: numOrNull(r.cpc),
      competition: comp === 'LOW' || comp === 'MEDIUM' || comp === 'HIGH' ? comp : null,
      monthly
    };
  });
}

export function parseDomainRank(result: unknown[]): Pick<CompetitorProfile, 'organicKeywords' | 'estTraffic' | 'top3Keywords'> {
  const organic = ((items(result)[0]?.metrics as Item | undefined)?.organic ?? {}) as Item;
  const top3 = (numOrNull(organic.pos_1) ?? 0) + (numOrNull(organic.pos_2_3) ?? 0);
  return { organicKeywords: numOrNull(organic.count), estTraffic: numOrNull(organic.etv) == null ? null : Math.round(organic.etv as number), top3Keywords: organic.count == null ? null : top3 };
}

export function parseBacklinks(result: unknown[]): Pick<CompetitorProfile, 'referringDomains' | 'backlinks'> {
  const r = (result[0] ?? {}) as Item;
  return { referringDomains: numOrNull(r.referring_domains), backlinks: numOrNull(r.backlinks) };
}

/** Rough list prices per call (USD), for --dry-run only. The snapshot records DataForSEO's actual charge. */
export const ESTIMATE = {
  organicPer10: 0.002,
  maps: 0.004,
  aiOverviewSerp: 0.004,
  llm: 0.02,
  searchVolume: 0.075,
  domainRank: 0.0101,
  backlinks: 0.02
};
