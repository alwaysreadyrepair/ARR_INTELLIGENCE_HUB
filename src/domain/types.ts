/* Domain models for the Intelligence Hub.
 *
 * Three families that are deliberately kept apart, because they come from different systems, refresh on
 * different clocks and answer different questions:
 *   1. Property facts   — what the county/permit records say about a home (Property, PropertyVersion, CoverageArea).
 *   2. Weather          — stored once per station or NWS grid cell, never copied onto properties
 *                         (WeatherObservation, WeatherForecast, WeatherAlert). A property or ZIP points at a
 *                         WeatherArea by id.
 *   3. Business demand  — ARR's own calls/leads/sales (DemandMetric). Comes from Sera, not from the property record.
 * Ingestion, quality and API-access models describe the platform itself.
 *
 * Dates are ISO-8601 strings (dates as YYYY-MM-DD, instants as full timestamps) so the same shapes come back from
 * Supabase/PostgREST without conversion. */

export type ISODate = string;
export type ISODateTime = string;

export type County = 'cook' | 'will' | 'dupage';

/** Where a fact came from. Every number on screen should be traceable to one of these. */
export type SourceId = 'cook-assessor' | 'cook-permits' | 'will-assessor' | 'dupage-assessor' | 'manual' | 'noaa-ncei' | 'nws' | 'sera';

export interface SourceRef {
  source: SourceId;
  /** Human label, e.g. "Cook County Assessor — 2025 release". */
  label: string;
  /** When ARR last pulled from this source. */
  retrievedAt: ISODateTime;
  /** The source's own vintage (assessment year, release date), if it has one. */
  sourceYear?: number;
}

export type Freshness = 'current' | 'stale' | 'missing';

/* ── 1. Property facts ─────────────────────────────────────────────────────────────────────────────────────── */

export type HeatingType = 'forced-air-gas' | 'boiler' | 'electric' | 'heat-pump' | 'other' | 'unknown';
export type CentralAir = 'yes' | 'no' | 'unknown';
export type Basement = 'full' | 'partial' | 'crawl' | 'slab' | 'unknown';
export type Stories = '1' | '1.5' | '2' | '3+' | 'split';

export interface Permit {
  id: string;
  issuedOn: ISODate;
  /** e.g. "Furnace replacement", "A/C install". */
  description: string;
  kind: 'hvac' | 'other';
  source: SourceRef;
}

export interface Sale {
  saleDate: ISODate;
  /** Internal only — never shown on a customer-facing surface. */
  price: number;
  source: SourceRef;
}

export interface ManualOverride {
  field: keyof PropertyFacts;
  value: string;
  reason: string;
  by: string;
  at: ISODateTime;
}

/** The characteristics a source can assert about a home. Null = the source didn't say. */
export interface PropertyFacts {
  yearBuilt: number | null;
  sqft: number | null;
  stories: Stories | null;
  heatingType: HeatingType;
  centralAir: CentralAir;
  basement: Basement;
}

export interface Property extends PropertyFacts {
  id: string;
  /** County parcel id. Cook format: 12-34-567-890-0000. */
  pin: string;
  address: string;
  city: string;
  zip: string;
  township: string;
  county: County;
  /** Most recent HVAC permit on record, if any — denormalised from `permits` for filtering. */
  lastHvacPermitOn: ISODate | null;
  /** WeatherArea this home rolls up to. Weather itself is never copied onto the property. */
  weatherAreaId: string;
  /** The source that supplied the current facts. */
  primarySource: SourceRef;
  lastRefreshedAt: ISODateTime;
}

export interface PropertyDetail extends Property {
  permits: Permit[];
  sales: Sale[];
  overrides: ManualOverride[];
  versions: PropertyVersion[];
}

/** One snapshot of a property's facts as a source release reported them. Diffing versions drives the
 *  "large changes between releases" quality check and the source-history timeline. */
export interface PropertyVersion {
  propertyId: string;
  version: number;
  capturedAt: ISODateTime;
  source: SourceRef;
  ingestionJobId: string | null;
  facts: PropertyFacts;
  /** Fields that differ from the previous version. Empty on the first version. */
  changedFields: (keyof PropertyFacts)[];
}

export interface CoverageArea {
  id: string;
  kind: 'zip' | 'township';
  name: string;
  county: County;
  /** For a ZIP, the township it rolls up to (id). Null for townships. */
  townshipId: string | null;
  /** Homes ARR has a record for. */
  homesIndexed: number;
  /** Residential parcels the source says exist — the denominator for completeness. Null when unknown. */
  parcelsExpected: number | null;
  lastRefreshedAt: ISODateTime | null;
  sourceYear: number | null;
  source: SourceId | null;
  /** Share of indexed homes missing each field, 0–1. */
  missing: { sqft: number; yearBuilt: number; stories: number; heatingType: number };
  /** Grid position for the schematic territory map (col, row). Not geographic coordinates. */
  tile: { col: number; row: number };
}

/* ── 2. Weather (stored once per area) ─────────────────────────────────────────────────────────────────────── */

export interface WeatherArea {
  id: string;
  name: string;
  /** NOAA GHCN-Daily station used for history, e.g. USW00014819 (Chicago Midway). */
  stationId: string;
  /** NWS forecast office + grid cell used for forecasts and alerts, e.g. LOT/70,62. */
  nwsGrid: string;
  zips: string[];
}

export interface WeatherObservation {
  areaId: string;
  date: ISODate;
  tMaxF: number;
  tMinF: number;
  /** Daily mean, (max + min) / 2 — the NOAA convention degree days are computed from. */
  tAvgF: number;
  /** Heating degree days, base 65°F. */
  hdd: number;
  /** Cooling degree days, base 65°F. */
  cdd: number;
  precipIn: number;
  snowIn: number;
  source: SourceRef;
}

/** 1991–2020 climate normal for a calendar month, used for the "vs normal" comparison. */
export interface WeatherNormal {
  areaId: string;
  month: number; // 1–12
  hdd: number;
  cdd: number;
  precipIn: number;
}

export interface WeatherForecastPeriod {
  date: ISODate;
  highF: number;
  lowF: number;
  summary: string;
  precipChance: number; // 0–100
}

export interface WeatherForecast {
  areaId: string;
  issuedAt: ISODateTime;
  periods: WeatherForecastPeriod[];
  source: SourceRef;
}

export interface WeatherAlert {
  id: string;
  areaId: string;
  event: string; // e.g. "Heat Advisory"
  severity: 'minor' | 'moderate' | 'severe' | 'extreme';
  headline: string;
  onset: ISODateTime;
  ends: ISODateTime;
  source: SourceRef;
}

/* ── 3. Business demand (from Sera — never stored on property or weather records) ───────────────────────────── */

export interface DemandMetric {
  date: ISODate;
  /** Coverage-area id (township) the calls rolled up to. */
  areaId: string;
  heatingCalls: number;
  coolingCalls: number;
  leads: number;
  source: SourceRef;
}

/* ── Platform: ingestion, quality, access ──────────────────────────────────────────────────────────────────── */

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';

export interface RejectedRecord {
  ref: string; // PIN or source row id
  reason: string;
}

export interface IngestionJob {
  id: string;
  source: SourceId;
  county: County;
  /** Coverage-area ids in scope. */
  areaIds: string[];
  status: JobStatus;
  dryRun: boolean;
  requestedBy: string;
  createdAt: ISODateTime;
  startedAt: ISODateTime | null;
  finishedAt: ISODateTime | null;
  recordsExpected: number | null;
  recordsProcessed: number;
  recordsAccepted: number;
  recordsRejected: number;
  rejectedSample: RejectedRecord[];
  error: string | null;
}

export type IssueKind =
  | 'duplicate-parcel'
  | 'address-match-failure'
  | 'missing-sqft'
  | 'missing-year-built'
  | 'implausible-value'
  | 'large-change';

export interface DataQualityIssue {
  id: string;
  kind: IssueKind;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'in-review' | 'resolved' | 'ignored';
  propertyId: string | null;
  areaId: string | null;
  summary: string;
  detectedAt: ISODateTime;
  detectedBy: string; // rule or job id
}

export type Dataset = 'properties' | 'permits' | 'sales' | 'coverage' | 'weather' | 'demand';

export interface Project {
  id: string;
  name: string;
  description: string;
  owner: string;
  datasets: Dataset[];
  /** Coverage-area ids or counties this project may read. */
  territories: string[];
  /** Only a prefix is ever held client-side — the secret is shown once at creation. */
  keyPrefix: string;
  keyCreatedAt: ISODateTime;
  keyLastUsedAt: ISODateTime | null;
  rateLimitPerMin: number;
  /** Requests per day, oldest first, last 14 days. */
  usage: { date: ISODate; requests: number }[];
  status: 'active' | 'paused' | 'revoked';
}

export interface AuditEvent {
  id: string;
  at: ISODateTime;
  actor: string;
  action: string; // e.g. "project.key.rotate", "import.start"
  target: string;
  detail: string;
}
