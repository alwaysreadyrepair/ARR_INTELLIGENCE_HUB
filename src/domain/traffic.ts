/* Web traffic models: what Cloudflare sees in front of ARR's website. A separate data family from properties,
 * weather and SEO. It comes from Cloudflare's GraphQL Analytics API (zone traffic, Web Analytics, AI crawler hits),
 * collected by `npm run traffic:refresh` into one `TrafficSnapshot`. All dates are UTC calendar days, because that's
 * how Cloudflare buckets them. */

import type { ISODate, ISODateTime } from './types.ts';

/** Who an AI crawler works for and why it fetches pages. */
export type BotPurpose =
  /** Collects pages to train models (GPTBot, ClaudeBot, …). */
  | 'training'
  /** Builds an AI search index that answers cite (OAI-SearchBot, PerplexityBot, …). */
  | 'ai-search'
  /** Fetches a page because a person asked the assistant about it right now (ChatGPT-User, …). */
  | 'user'
  /** Classic search engines, for comparison (Googlebot, Bingbot). */
  | 'search-engine';

export interface BotDef {
  id: string;
  label: string;
  operator: string;
  purpose: BotPurpose;
  /** Case-sensitive substring of the User-Agent header that identifies it. */
  match: string;
}

export interface AiAssistantDef {
  id: string;
  label: string;
  /** Referrer hosts that mean "came from this assistant". */
  hosts: string[];
}

/** One UTC day of all traffic through the Cloudflare zone (httpRequests1dGroups). Includes bots. */
export interface ZoneDay {
  date: ISODate;
  requests: number;
  cachedRequests: number;
  bytes: number;
  cachedBytes: number;
  /** Cloudflare's own count of HTML page requests. Includes crawlers. */
  pageViews: number;
  /** Distinct client IPs. */
  uniques: number;
  threats: number;
  status4xx: number;
  status5xx: number;
}

/** One UTC day of Web Analytics (browser beacon, so real visitors only). */
export interface VisitDay {
  date: ISODate;
  /** Page views that started from another site or a typed URL. Cloudflare's definition of a visit. */
  visits: number;
  pageViews: number;
}

/** A window the top-N lists were collected over. Lists are a snapshot of that window, not the whole history. */
export interface Window {
  from: ISODate;
  to: ISODate;
}

export interface PageCount {
  path: string;
  pageViews: number;
  visits: number;
}

export interface ReferrerCount {
  host: string;
  visits: number;
}

export interface CrawlerDay {
  date: ISODate;
  /** BotDef id. */
  bot: string;
  requests: number;
}

export interface CrawledPath {
  bot: string;
  path: string;
  requests: number;
}

export interface NotFoundPath {
  path: string;
  requests: number;
}

/** Whether the website's own hostnames run through this Cloudflare zone (orange cloud). When they're DNS-only,
 *  requests go straight to the host (e.g. Webflow), so zone analytics, crawler and 404 counts only cover the few
 *  proxied subdomains. Web Analytics still works, because it runs from a script in the page. */
export interface EdgeCoverage {
  /** true: every site hostname is proxied. false: at least one is DNS-only, so its traffic bypasses the zone.
   *  null: couldn't tell (no records found, or the token lacks DNS read). */
  proxied: boolean | null;
  hosts: { name: string; proxied: boolean; target: string }[];
}

export interface TrafficSnapshot {
  version: 1;
  takenAt: ISODateTime;
  /** Zone name, e.g. alwaysreadyrepair.com. */
  zone: string;
  /** Missing in snapshots written before this field existed: treat as unknown. */
  edge?: EdgeCoverage;
  /** History, merged across refreshes. */
  days: ZoneDay[];
  /** Null when Web Analytics isn't set up for the site (or the token can't read it). */
  visits: VisitDay[] | null;
  /** History, merged across refreshes: lets crawler counts outlive Cloudflare's short retention on free plans. */
  crawlers: CrawlerDay[];
  /** Latest refresh only. */
  pages: { window: Window; rows: PageCount[] } | null;
  referrers: { window: Window; rows: ReferrerCount[] } | null;
  crawledPaths: { window: Window; rows: CrawledPath[] } | null;
  notFound: { window: Window; rows: NotFoundPath[] } | null;
}
