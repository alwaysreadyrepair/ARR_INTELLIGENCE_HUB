/* SEO and AEO domain models: the fourth data family, next to property facts, weather and demand.
 *
 * It comes from search engines and AI answer engines (through DataForSEO) and from a crawl of ARR's own site, and
 * refreshes weekly. It is never written onto property, weather or demand records. A `SeoMarket` names a city for
 * search purposes only; it is not a coverage area or a weather area.
 *
 * Much of the shape follows OpenSEO (github.com/every-app/open-seo, MIT), trimmed to one site and one company. */

import type { ISODate, ISODateTime } from './types.ts';

/** A service line, used to group keywords and prompts. */
export type SeoService = 'furnace' | 'ac' | 'heat-pump' | 'boiler' | 'maintenance' | 'emergency' | 'general';

/** A city we track search results in. `locationName` is DataForSEO's spelling; `lat`/`lon` place the map-pack
 *  search at the city centre. */
export interface SeoMarket {
  id: string;
  city: string;
  locationName: string;
  lat: number;
  lon: number;
}

export interface TrackedKeyword {
  keyword: string;
  service: SeoService;
}

/** An AI answer engine. `google_ai_overview` comes from the same Google SERP as the rank check. */
export type AiEngine = 'chatgpt' | 'perplexity' | 'gemini' | 'claude' | 'google_ai_overview';

/** A question a homeowner might ask an AI assistant. Unbranded on purpose: a prompt that names ARR proves nothing. */
export interface AiPrompt {
  id: string;
  text: string;
  service: SeoService;
}

/** A company we compare against. `own` marks ARR. `names` are the spellings an AI answer might use. */
export interface SeoBrand {
  domain: string;
  name: string;
  names: string[];
  own: boolean;
}

/** Everything the refresh tracks. Live mode reads it from src/data/seo/targets.ts; competitors are discovered
 *  from the search results, not typed in. */
export interface SeoTargets {
  domain: string;
  brand: SeoBrand;
  markets: SeoMarket[];
  keywords: TrackedKeyword[];
  prompts: AiPrompt[];
  engines: AiEngine[];
  competitors: SeoBrand[];
  /** How deep the organic check looks. A position past this is reported as not ranked. */
  rankDepth: number;
}

/** One organic Google result for a keyword in a city on one date. `position` counts organic results only (what a
 *  person counts down the page); null means ARR wasn't within `SeoTargets.rankDepth` results. */
export interface RankObservation {
  date: ISODate;
  keyword: string;
  marketId: string;
  position: number | null;
  url: string | null;
  /** The best-placed competitor above ARR, if any. */
  topCompetitor: { domain: string; position: number } | null;
  /** SERP features shown for the query, e.g. local_pack, ai_overview, people_also_ask. */
  features: string[];
  /** ARR is one of the three businesses in the local pack on the results page. */
  inLocalPack: boolean;
}

/** Google Maps result for a keyword searched from a city centre. */
export interface LocalPackResult {
  date: ISODate;
  keyword: string;
  marketId: string;
  /** ARR's position in the Maps list; null when it isn't in the first 20. */
  position: number | null;
  topThree: { title: string; domain: string | null; rating: number | null; reviews: number | null }[];
}

/** One AI engine's answer to one prompt on one date, already matched against ARR and the competitors. */
export interface AiAnswer {
  date: ISODate;
  promptId: string;
  engine: AiEngine;
  /** False when the engine gave no answer (or Google showed no AI Overview). */
  answered: boolean;
  /** ARR named in the answer text. */
  mentioned: boolean;
  /** The answer cites a page on alwaysreadyrepair.com. */
  cited: boolean;
  /** 1-based order of ARR among the brands the answer names; null if not named. */
  mentionRank: number | null;
  /** Domains of the competitors named in the answer. */
  competitorsMentioned: string[];
  citedDomains: string[];
  /** Up to ~400 characters around ARR's first mention, or the start of the answer. */
  excerpt: string;
}

export interface KeywordMetric {
  keyword: string;
  service: SeoService;
  /** Average monthly Google searches in the Chicago market. */
  searchVolume: number | null;
  cpc: number | null;
  /** Google Ads competition: LOW / MEDIUM / HIGH. */
  competition: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  /** The last 12 months, oldest first. */
  monthly: { month: string; volume: number }[];
}

/** A domain's search footprint, from DataForSEO Labs and the backlinks index. */
export interface CompetitorProfile {
  domain: string;
  name: string;
  own: boolean;
  /** Keywords the domain ranks for in the US top 100. */
  organicKeywords: number | null;
  /** Estimated monthly organic visits (DataForSEO's "etv"). An estimate, not analytics. */
  estTraffic: number | null;
  top3Keywords: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  /** How many tracked keyword × city searches the domain shows up in (top 10), from our own rank checks. */
  trackedAppearances: number;
}

export type AuditSeverity = 'high' | 'medium' | 'low';

export interface AuditIssue {
  code: string;
  severity: AuditSeverity;
  message: string;
  /** Matters mainly for AI answer engines (structured data, crawler access, answerable content). */
  aeo: boolean;
}

export interface AuditPage {
  url: string;
  status: number;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  wordCount: number;
  canonical: string | null;
  noindex: boolean;
  schemaTypes: string[];
  issues: AuditIssue[];
}

export interface SiteAudit {
  crawledAt: ISODateTime;
  /** Pages fetched / pages listed in the sitemap. */
  pagesCrawled: number;
  pagesInSitemap: number | null;
  robots: { present: boolean; blockedAiBots: string[]; sitemapListed: boolean };
  llmsTxt: boolean;
  /** Site-wide findings (robots, llms.txt, sitemap). Page findings live on each page. */
  siteIssues: AuditIssue[];
  pages: AuditPage[];
}

/** What a refresh cost, by area. Recorded from DataForSEO's own per-task cost field. */
export interface SeoSpend {
  date: ISODate;
  area: 'rankings' | 'local' | 'ai' | 'keywords' | 'competitors';
  calls: number;
  usd: number;
}

/** Clicks, impressions, click-through rate and average position, as Google Search Console reports them. `ctr` is a
 *  0–1 ratio; `position` is the impression-weighted average (1 = top). */
export interface GscMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** One search term (or one page) over the current period, with the same numbers for the period before. `prev` is
 *  null when it had no impressions then. */
export interface GscQueryRow extends GscMetrics {
  query: string;
  prev: GscMetrics | null;
}
export interface GscPageRow extends GscMetrics {
  page: string;
  prev: GscMetrics | null;
}

/** What Google measured for ARR's own site, from the Search Console API: real clicks and impressions, not
 *  estimates. Google reports with a 2–3 day lag and keeps 16 months. Rare search terms are hidden for privacy, so the
 *  query rows add up to less than `totals`. Replaced (not merged) on each refresh, since Google keeps the history. */
export interface SearchConsoleData {
  /** The Search Console property, e.g. `sc-domain:alwaysreadyrepair.com`. */
  property: string;
  fetchedAt: ISODateTime;
  /** The comparison windows: the last `days` days with data, and the same number of days before. */
  period: { start: ISODate; end: ISODate; days: number };
  previous: { start: ISODate; end: ISODate };
  /** Whole-site totals for each window, hidden search terms included. */
  totals: { current: GscMetrics; previous: GscMetrics };
  /** Whole-site numbers per day, up to 16 months, oldest first. */
  daily: (GscMetrics & { date: ISODate })[];
  /** Top search terms and pages in the current window, by clicks then impressions. */
  queries: GscQueryRow[];
  pages: GscPageRow[];
}

/** The whole SEO dataset, as the refresh script writes it and the snapshot repository reads it. History is kept
 *  inside: rankings, local and AI rows carry their own date. */
export interface SeoSnapshot {
  version: 1;
  takenAt: ISODateTime;
  targets: SeoTargets;
  rankings: RankObservation[];
  local: LocalPackResult[];
  ai: AiAnswer[];
  keywords: KeywordMetric[];
  competitors: CompetitorProfile[];
  audit: SiteAudit | null;
  /** Missing in snapshots written before the Search Console step existed. */
  searchConsole?: SearchConsoleData | null;
  spend: SeoSpend[];
}
