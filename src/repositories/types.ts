/* Repository interfaces — the only way pages and components reach data.
 *
 * Components never import mock data or a database client. Pages call `Astro.locals.repos.<repo>.<method>()`,
 * wrapped in `load()` (src/lib/load.ts) so every panel gets an ok / empty / error / stale result it can render.
 * The mock implementations live in ./mock; Supabase implementations will satisfy the same interfaces (see README).
 *
 * All methods are read-only. Mutations (starting imports, resolving issues, rotating keys) are intentionally absent
 * from v1 — they arrive with real auth and an audit trail. */

import type {
  AuditEvent, CoverageArea, County, DataQualityIssue, DemandMetric, HeatingType, CentralAir, Basement, Stories,
  IngestionJob, ISODate, IssueKind, Project, Property, PropertyDetail, SourceId, WeatherAlert, WeatherArea,
  WeatherForecast, WeatherNormal, WeatherObservation
} from '../domain/types.ts';
import type {
  AiAnswer, AiEngine, CompetitorProfile, KeywordMetric, LocalPackResult, RankObservation, SeoService, SeoSpend, SeoTargets, SiteAudit
} from '../domain/seo.ts';
import type { CrawledPath, CrawlerDay, EdgeCoverage, NotFoundPath, PageCount, ReferrerCount, VisitDay, Window, ZoneDay } from '../domain/traffic.ts';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PropertyQuery {
  q?: string;                 // address or PIN substring
  zip?: string;
  city?: string;
  township?: string;
  county?: County;
  yearBuiltMin?: number;
  yearBuiltMax?: number;
  sqftMin?: number;
  sqftMax?: number;
  stories?: Stories;
  heatingType?: HeatingType;
  centralAir?: CentralAir;
  basement?: Basement;
  /** Only homes whose last HVAC permit is older than this date, or that have none. */
  noHvacPermitSince?: ISODate;
  source?: SourceId;
  sort?: 'address' | 'yearBuilt' | 'sqft' | 'lastRefreshedAt';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface PropertyRepository {
  search(query: PropertyQuery): Promise<Page<Property>>;
  get(id: string): Promise<PropertyDetail | null>;
  /** Distinct filter values present in the data (for dropdowns). */
  facets(): Promise<{ zips: string[]; cities: string[]; townships: string[] }>;
}

/** Aggregates are a repository concern, not a component one: in Supabase these are SQL views / RPCs over the
 *  full table, never a client-side reduce over 250k rows. */
export interface TerritoryFilter {
  /** Coverage-area id of a township, or undefined for everything. */
  territory?: string;
  source?: SourceId;
}

export interface HousingProfile {
  territory: string; // area id or 'all'
  label: string;
  homes: number;
  medianYearBuilt: number | null;
  medianSqft: number | null;
  /** Homes grouped by decade built, e.g. { 1950: 812 }. Unknown year excluded and counted separately. */
  byDecade: { decade: number; homes: number }[];
  yearBuiltUnknown: number;
  bySqftBand: { band: string; homes: number }[];
  byHeatingType: { type: HeatingType; homes: number }[];
  centralAir: { yes: number; no: number; unknown: number };
  withHvacPermit: number;
  asOf: string; // ISO timestamp of the newest record included
}

export interface MarketRepository {
  profile(filter: TerritoryFilter): Promise<HousingProfile>;
  /** One profile per township, for side-by-side comparison. */
  compareTerritories(filter: Pick<TerritoryFilter, 'source'>): Promise<HousingProfile[]>;
  /** Count of homes built before `builtBefore` with no HVAC permit since `noPermitSince`. Transparent inputs,
   *  not a score — see the Markets page copy. */
  countByAgeAndPermit(filter: TerritoryFilter & { builtBefore: number; noPermitSince: ISODate }): Promise<{ matching: number; of: number }>;
  /** Number of property snapshots collected; trends need at least two. */
  snapshotCount(): Promise<number>;
}

export interface CoverageRepository {
  list(filter?: { kind?: CoverageArea['kind']; county?: County }): Promise<CoverageArea[]>;
  get(id: string): Promise<CoverageArea | null>;
}

export interface WeatherRepository {
  areas(): Promise<WeatherArea[]>;
  observations(areaId: string, from: ISODate, to: ISODate): Promise<WeatherObservation[]>;
  normals(areaId: string): Promise<WeatherNormal[]>;
  forecast(areaId: string): Promise<WeatherForecast | null>;
  alerts(areaId?: string): Promise<WeatherAlert[]>;
}

export interface DemandRepository {
  /** Daily demand, optionally for one township. Source: Sera (mocked in v1). */
  daily(from: ISODate, to: ISODate, areaId?: string): Promise<DemandMetric[]>;
}

export interface IngestionRepository {
  list(filter?: { status?: IngestionJob['status'] }): Promise<IngestionJob[]>;
  get(id: string): Promise<IngestionJob | null>;
}

export interface QualityRepository {
  list(filter?: { kind?: IssueKind; severity?: DataQualityIssue['severity']; status?: DataQualityIssue['status'] }): Promise<DataQualityIssue[]>;
}

export interface ProjectRepository {
  list(): Promise<Project[]>;
}

export interface AuditRepository {
  recent(limit: number): Promise<AuditEvent[]>;
}

/** SEO and AEO data. A separate source from the rest of the Hub (SEO_DATA_SOURCE), because it comes from DataForSEO
 *  and a crawl, not from county records. The dataset is small (hundreds of rows per weekly refresh), so the
 *  roll-ups are pure functions in src/lib/seo/stats.ts rather than SQL. Rows come back sorted by date. */
export interface SeoRepository {
  /** 'mock' (synthetic) or 'snapshot' (the last `seo:refresh` run). Shown on every SEO page. */
  kind: 'mock' | 'snapshot';
  /** When the data was collected; null when there is none. */
  takenAt(): Promise<string | null>;
  targets(): Promise<SeoTargets>;
  rankings(filter?: { marketId?: string; service?: SeoService }): Promise<RankObservation[]>;
  local(filter?: { marketId?: string }): Promise<LocalPackResult[]>;
  aiAnswers(filter?: { engine?: AiEngine; promptId?: string }): Promise<AiAnswer[]>;
  keywords(): Promise<KeywordMetric[]>;
  competitors(): Promise<CompetitorProfile[]>;
  audit(): Promise<SiteAudit | null>;
  spend(): Promise<SeoSpend[]>;
}

/** Website traffic as Cloudflare sees it. Its own source switch (TRAFFIC_DATA_SOURCE), like SEO: the data comes from
 *  Cloudflare's analytics API via `npm run traffic:refresh`, never from the request path. Daily series come back
 *  sorted by date and limited to the window asked for; the top-N lists are whatever window the last refresh covered. */
export interface TrafficRepository {
  /** 'mock' (synthetic) or 'snapshot' (the last `traffic:refresh` run). */
  kind: 'mock' | 'snapshot';
  takenAt(): Promise<string | null>;
  zone(): Promise<string>;
  /** Whether the site's hostnames are proxied by the zone; null when unknown. */
  edge(): Promise<EdgeCoverage | null>;
  days(from: ISODate, to: ISODate): Promise<ZoneDay[]>;
  /** Null when Web Analytics isn't set up for the site. */
  visits(from: ISODate, to: ISODate): Promise<VisitDay[] | null>;
  crawlers(from: ISODate, to: ISODate): Promise<CrawlerDay[]>;
  pages(): Promise<{ window: Window; rows: PageCount[] } | null>;
  referrers(): Promise<{ window: Window; rows: ReferrerCount[] } | null>;
  crawledPaths(): Promise<{ window: Window; rows: CrawledPath[] } | null>;
  notFound(): Promise<{ window: Window; rows: NotFoundPath[] } | null>;
}

export interface Repositories {
  /** 'mock' or 'supabase' — shown in the UI so nobody mistakes demo numbers for real ones. */
  kind: 'mock' | 'supabase';
  seo: SeoRepository;
  traffic: TrafficRepository;
  properties: PropertyRepository;
  markets: MarketRepository;
  coverage: CoverageRepository;
  weather: WeatherRepository;
  demand: DemandRepository;
  ingestion: IngestionRepository;
  quality: QualityRepository;
  projects: ProjectRepository;
  audit: AuditRepository;
}
