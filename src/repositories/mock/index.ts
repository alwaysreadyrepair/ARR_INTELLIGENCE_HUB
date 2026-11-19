/* In-memory repositories over the mock dataset. This is the ONLY place mock data is imported.
 * Aggregations here are simple reduces. The Supabase versions push the same work into SQL views/RPCs. */

import type { HeatingType, Property, PropertyDetail } from '../../domain/types.ts';
import { buildMockDataset, type MockDataset } from '../../data/mock/dataset.ts';
import { newest } from '../../lib/freshness.ts';
import { decadeOf, median, SQFT_BANDS, sqftBand } from '../../lib/stats.ts';
import type { HousingProfile, Page, PropertyQuery, Repositories, TerritoryFilter } from '../types.ts';
import { mockSeoRepository } from './seo.ts';

const HEATING_ORDER: HeatingType[] = ['forced-air-gas', 'boiler', 'heat-pump', 'electric', 'other', 'unknown'];

/** Strip the detail-only arrays so list results match the `Property` shape a real list query returns. */
const summary = ({ permits: _p, sales: _s, overrides: _o, versions: _v, ...p }: PropertyDetail): Property => p;

export function matches(p: Property, q: PropertyQuery): boolean {
  if (q.q) {
    const needle = q.q.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hay = `${p.address}${p.city}${p.zip}${p.pin}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!hay.includes(needle)) return false;
  }
  if (q.zip && p.zip !== q.zip) return false;
  if (q.city && p.city !== q.city) return false;
  if (q.township && p.township !== q.township) return false;
  if (q.county && p.county !== q.county) return false;
  if (q.yearBuiltMin != null && (p.yearBuilt == null || p.yearBuilt < q.yearBuiltMin)) return false;
  if (q.yearBuiltMax != null && (p.yearBuilt == null || p.yearBuilt > q.yearBuiltMax)) return false;
  if (q.sqftMin != null && (p.sqft == null || p.sqft < q.sqftMin)) return false;
  if (q.sqftMax != null && (p.sqft == null || p.sqft > q.sqftMax)) return false;
  if (q.stories && p.stories !== q.stories) return false;
  if (q.heatingType && p.heatingType !== q.heatingType) return false;
  if (q.centralAir && p.centralAir !== q.centralAir) return false;
  if (q.basement && p.basement !== q.basement) return false;
  if (q.noHvacPermitSince && p.lastHvacPermitOn && p.lastHvacPermitOn >= q.noHvacPermitSince) return false;
  if (q.source && p.primarySource.source !== q.source) return false;
  return true;
}

function profileOf(homes: Property[], territory: string, label: string): HousingProfile {
  const years = homes.map((h) => h.yearBuilt).filter((y): y is number => y != null);
  const decades = new Map<number, number>();
  for (const y of years) decades.set(decadeOf(y), (decades.get(decadeOf(y)) ?? 0) + 1);
  const bands = new Map<string, number>();
  for (const h of homes) if (h.sqft != null) bands.set(sqftBand(h.sqft), (bands.get(sqftBand(h.sqft)) ?? 0) + 1);
  const heat = new Map<HeatingType, number>();
  for (const h of homes) heat.set(h.heatingType, (heat.get(h.heatingType) ?? 0) + 1);
  return {
    territory, label, homes: homes.length,
    medianYearBuilt: median(years),
    medianSqft: median(homes.map((h) => h.sqft).filter((s): s is number => s != null)),
    byDecade: [...decades].sort(([a], [b]) => a - b).map(([decade, n]) => ({ decade, homes: n })),
    yearBuiltUnknown: homes.length - years.length,
    bySqftBand: SQFT_BANDS.map((b) => ({ band: b.band, homes: bands.get(b.band) ?? 0 })),
    byHeatingType: HEATING_ORDER.map((type) => ({ type, homes: heat.get(type) ?? 0 })).filter((x) => x.homes > 0),
    centralAir: {
      yes: homes.filter((h) => h.centralAir === 'yes').length,
      no: homes.filter((h) => h.centralAir === 'no').length,
      unknown: homes.filter((h) => h.centralAir === 'unknown').length
    },
    withHvacPermit: homes.filter((h) => h.lastHvacPermitOn).length,
    asOf: newest(homes.map((h) => h.lastRefreshedAt)) ?? ''
  };
}

export function createMockRepositories(data: MockDataset): Repositories {
  const all = data.properties;
  const townshipName = (id: string) => data.coverage.find((a) => a.id === id)?.name.replace(/ Township$/, '');
  const inTerritory = (f: TerritoryFilter) => (p: Property) =>
    (!f.territory || p.township === townshipName(f.territory)) && (!f.source || p.primarySource.source === f.source);

  return {
    kind: 'mock',
    seo: mockSeoRepository(data.now),
    properties: {
      async search(q) {
        const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));
        const page = Math.max(1, q.page ?? 1);
        const hits = all.filter((p) => matches(p, q)).map(summary);
        const dir = q.dir === 'desc' ? -1 : 1;
        const key = q.sort ?? 'address';
        hits.sort((a, b) => {
          const av = a[key], bv = b[key];
          if (av == null) return 1;
          if (bv == null) return -1;
          const c = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv, 'en', { numeric: true }) : av < bv ? -1 : av > bv ? 1 : 0;
          return c * dir;
        });
        return { items: hits.slice((page - 1) * pageSize, page * pageSize), total: hits.length, page, pageSize } satisfies Page<Property>;
      },
      async get(id) {
        return all.find((p) => p.id === id) ?? null;
      },
      async facets() {
        const uniq = (xs: string[]) => [...new Set(xs)].sort();
        return { zips: uniq(all.map((p) => p.zip)), cities: uniq(all.map((p) => p.city)), townships: uniq(all.map((p) => p.township)) };
      }
    },
    markets: {
      async profile(f) {
        const label = f.territory ? (data.coverage.find((a) => a.id === f.territory)?.name ?? f.territory) : 'All territories';
        return profileOf(all.filter(inTerritory(f)), f.territory ?? 'all', label);
      },
      async compareTerritories(f) {
        return data.coverage
          .filter((a) => a.kind === 'township' && a.homesIndexed > 0)
          .map((a) => profileOf(all.filter(inTerritory({ territory: a.id, source: f.source })), a.id, a.name))
          .filter((p) => p.homes > 0)
          .sort((a, b) => b.homes - a.homes);
      },
      async countByAgeAndPermit(f) {
        const pool = all.filter(inTerritory(f));
        const matching = pool.filter((p) => p.yearBuilt != null && p.yearBuilt < f.builtBefore && (!p.lastHvacPermitOn || p.lastHvacPermitOn < f.noPermitSince)).length;
        return { matching, of: pool.length };
      },
      async snapshotCount() {
        return 1;
      }
    },
    coverage: {
      async list(f = {}) {
        return data.coverage.filter((a) => (!f.kind || a.kind === f.kind) && (!f.county || a.county === f.county));
      },
      async get(id) {
        return data.coverage.find((a) => a.id === id) ?? null;
      }
    },
    weather: {
      async areas() {
        return data.weatherAreas;
      },
      async observations(areaId, from, to) {
        return data.observations.filter((o) => o.areaId === areaId && o.date >= from && o.date <= to);
      },
      async normals(areaId) {
        return data.normals.filter((n) => n.areaId === areaId);
      },
      async forecast(areaId) {
        return data.forecasts.find((f) => f.areaId === areaId) ?? null;
      },
      async alerts(areaId) {
        return data.alerts.filter((a) => !areaId || a.areaId === areaId);
      }
    },
    demand: {
      async daily(from, to, areaId) {
        return data.demand.filter((d) => d.date >= from && d.date <= to && (!areaId || d.areaId === areaId));
      }
    },
    ingestion: {
      async list(f = {}) {
        return data.jobs.filter((j) => !f.status || j.status === f.status);
      },
      async get(id) {
        return data.jobs.find((j) => j.id === id) ?? null;
      }
    },
    quality: {
      async list(f = {}) {
        return data.issues.filter((i) => (!f.kind || i.kind === f.kind) && (!f.severity || i.severity === f.severity) && (!f.status || i.status === f.status));
      }
    },
    projects: {
      async list() {
        return data.projects;
      }
    },
    audit: {
      async recent(limit) {
        return [...data.audit].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
      }
    }
  };
}

/* Build the dataset once per calendar day, not per request. */
let cached: { day: string; repos: Repositories } | null = null;
export function mockRepositories(now = new Date()): Repositories {
  const day = now.toISOString().slice(0, 10);
  if (!cached || cached.day !== day) cached = { day, repos: createMockRepositories(buildMockDataset(now)) };
  return cached.repos;
}
