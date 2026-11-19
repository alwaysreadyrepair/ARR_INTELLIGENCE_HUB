/* The mock dataset. Deterministic (seeded) apart from being anchored to "today", so freshness reads the same way
 * whenever the app runs. ONLY src/repositories/mock/* may import this file. Components and pages go through
 * the repository interfaces.
 *
 * Everything here is synthetic. The shapes match the domain models exactly. The numbers are not ARR's. */

import type {
  AuditEvent, Basement, CentralAir, CoverageArea, DataQualityIssue, DemandMetric, HeatingType, IngestionJob,
  ManualOverride, Permit, Project, PropertyDetail, PropertyFacts, PropertyVersion, Sale, SourceRef, Stories,
  WeatherAlert, WeatherArea, WeatherForecast, WeatherNormal, WeatherObservation
} from '../../domain/types.ts';
import { rng } from '../../lib/rng.ts';
import { cdd, hdd } from '../../lib/stats.ts';
import { EXPECTED_WHEN_MISSING, STREETS, ZIPS, townshipId } from './areas.ts';

export interface MockDataset {
  now: Date;
  properties: PropertyDetail[];
  coverage: CoverageArea[];
  weatherAreas: WeatherArea[];
  observations: WeatherObservation[];
  normals: WeatherNormal[];
  forecasts: WeatherForecast[];
  alerts: WeatherAlert[];
  demand: DemandMetric[];
  jobs: IngestionJob[];
  issues: DataQualityIssue[];
  projects: Project[];
  audit: AuditEvent[];
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

const assessorLabel = (source: string, year: number | null) =>
  ({ 'cook-assessor': 'Cook County Assessor', 'dupage-assessor': 'DuPage County Assessor' } as Record<string, string>)[source] +
  (year ? ` (${year} release)` : '');

export function buildMockDataset(now: Date): MockDataset {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const r = rng(1935); // ARR's founding year, seeding the whole dataset

  /* ── Ingestion jobs first (versions reference them) ──────────────────────────────────────────────────────── */
  const job = (j: Partial<IngestionJob> & Pick<IngestionJob, 'id' | 'status' | 'county' | 'source' | 'areaIds'>, daysAgo: number, mins: number): IngestionJob => {
    const created = today - daysAgo * DAY + 9 * 3600_000;
    const running = j.status === 'running' || j.status === 'queued';
    return {
      dryRun: false, requestedBy: 'jason@arrhvac.com', createdAt: iso(created),
      startedAt: j.status === 'queued' ? null : iso(created + 60_000),
      finishedAt: running ? null : iso(created + mins * 60_000),
      recordsExpected: null, recordsProcessed: 0, recordsAccepted: 0, recordsRejected: 0, rejectedSample: [], error: null,
      ...j
    };
  };
  const twp = (name: string) => townshipId(name);
  const jobs: IngestionJob[] = [
    job({ id: 'job-2419', status: 'running', county: 'cook', source: 'cook-assessor', areaIds: [twp('Bremen')], recordsExpected: 27_400, recordsProcessed: 17_012, recordsAccepted: 16_940, recordsRejected: 72,
      rejectedSample: [{ ref: '28-18-104-033-0000', reason: 'No situs address on parcel' }, { ref: '28-19-311-002-0000', reason: 'Class 2-99 condo common area, not a home' }] }, 0, 0),
    job({ id: 'job-2418', status: 'queued', dryRun: true, county: 'dupage', source: 'dupage-assessor', areaIds: [twp('Downers Grove')], recordsExpected: 18_900 }, 0, 0),
    job({ id: 'job-2412', status: 'succeeded', county: 'cook', source: 'cook-assessor', areaIds: [twp('Orland')], recordsExpected: 31_200, recordsProcessed: 31_200, recordsAccepted: 31_054, recordsRejected: 146,
      rejectedSample: [{ ref: '27-10-205-019-0000', reason: 'Duplicate PIN in source extract' }, { ref: '27-15-400-001-0000', reason: 'Vacant land class 1-00' }] }, 5, 38),
    job({ id: 'job-2409', status: 'succeeded', county: 'cook', source: 'cook-assessor', areaIds: [twp('Palos')], recordsExpected: 22_800, recordsProcessed: 22_800, recordsAccepted: 22_610, recordsRejected: 190 }, 9, 29),
    job({ id: 'job-2404', status: 'succeeded', county: 'cook', source: 'cook-assessor', areaIds: [twp('Lemont')], recordsExpected: 7_900, recordsProcessed: 7_900, recordsAccepted: 7_842, recordsRejected: 58 }, 12, 11),
    job({ id: 'job-2398', status: 'failed', county: 'will', source: 'will-assessor', areaIds: [twp('Homer'), twp('Frankfort'), twp('New Lenox')], recordsProcessed: 0,
      error: 'No Will County bulk source is configured. The Will lookup in the pricing app is still a stub (see docs/DATA-SOURCES.md).' }, 16, 1),
    job({ id: 'job-2391', status: 'partial', county: 'cook', source: 'cook-assessor', areaIds: [twp('Bremen')], recordsExpected: 27_400, recordsProcessed: 27_400, recordsAccepted: 25_870, recordsRejected: 1_530,
      rejectedSample: [{ ref: '28-07-122-040-0000', reason: 'Address did not match Cook Assessor spelling' }, { ref: '28-08-315-011-0000', reason: 'Year built 1780 is implausible for class 2-03' }, { ref: '28-17-201-006-0000', reason: 'Square footage 0' }] }, 33, 44),
    job({ id: 'job-2380', status: 'cancelled', county: 'cook', source: 'cook-permits', areaIds: [twp('Orland'), twp('Palos')], recordsProcessed: 4_100, recordsAccepted: 4_100 }, 40, 7),
    job({ id: 'job-2311', status: 'succeeded', county: 'cook', source: 'cook-assessor', areaIds: [twp('Worth'), twp('Lyons')], recordsExpected: 51_300, recordsProcessed: 51_300, recordsAccepted: 50_870, recordsRejected: 430 }, 188, 71)
  ];
  const jobFor = (township: string, county: string) =>
    jobs.find((j) => j.areaIds.includes(twp(township)) && j.county === county && (j.status === 'succeeded' || j.status === 'partial'))?.id ?? null;

  /* ── Properties ─────────────────────────────────────────────────────────────────────────────────────────── */
  const properties: PropertyDetail[] = [];
  const usedPins = new Set<string>();
  let seq = 1000;
  for (const z of ZIPS) {
    const refreshed = z.refreshedDaysAgo == null ? null : today - z.refreshedDaysAgo * DAY + 10 * 3600_000;
    for (let i = 0; i < z.homes; i++) {
      const id = `p-${++seq}`;
      const year = Math.min(2024, Math.max(1895, Math.round(r.normal(z.era, 14))));
      const sqftBase = 900 + (year - 1900) * 14 + r.normal(0, 420);
      const sqft = Math.max(640, Math.round(sqftBase / 10) * 10);
      const stories: Stories = r.weighted<Stories>([['1', year < 1970 ? 5 : 3], ['1.5', year < 1960 ? 3 : 0.5], ['2', year < 1970 ? 2 : 5], ['split', year >= 1955 && year < 1985 ? 2 : 0.3], ['3+', 0.2]]);
      const heatingType: HeatingType = r.weighted<HeatingType>([['forced-air-gas', 80], ['boiler', year < 1950 ? 22 : 3], ['heat-pump', year > 2000 ? 6 : 1.5], ['electric', 2], ['other', 1], ['unknown', 3]]);
      const centralAir: CentralAir = r.weighted<CentralAir>([['yes', year < 1960 ? 55 : 88], ['no', year < 1960 ? 38 : 8], ['unknown', 5]]);
      const basement: Basement = r.weighted<Basement>([['full', 55], ['partial', 15], ['crawl', 12], ['slab', year > 1955 && year < 1980 ? 14 : 6], ['unknown', 4]]);
      const facts: PropertyFacts = {
        yearBuilt: r.next() < 0.02 ? null : year,
        sqft: r.next() < 0.04 ? null : sqft,
        stories: r.next() < 0.03 ? null : stories,
        heatingType, centralAir, basement
      };
      const source = z.source ?? 'cook-assessor';
      const primarySource: SourceRef = { source, label: assessorLabel(source, z.sourceYear), retrievedAt: iso(refreshed ?? today), sourceYear: z.sourceYear ?? undefined };

      // Permits: newer homes are less likely to have had equipment replaced.
      const permits: Permit[] = [];
      const permitOdds = Math.min(0.8, Math.max(0.1, (2024 - year) / 45));
      if (source === 'cook-assessor' && r.next() < permitOdds) {
        const n = r.int(1, 2);
        for (let k = 0; k < n; k++) {
          const daysAgo = r.int(90, 25 * 365);
          permits.push({
            id: `${id}-pm${k}`, issuedOn: isoDay(today - daysAgo * DAY),
            description: r.pick(['Furnace replacement', 'A/C condenser replacement', 'Furnace + A/C replacement', 'Boiler replacement', 'Ductwork alteration']),
            kind: 'hvac', source: { source: 'cook-permits', label: 'Cook County building permits', retrievedAt: iso(refreshed ?? today) }
          });
        }
        if (r.next() < 0.3) permits.push({ id: `${id}-pmx`, issuedOn: isoDay(today - r.int(200, 4000) * DAY), description: r.pick(['Roof replacement', 'Deck', 'Kitchen remodel']), kind: 'other', source: { source: 'cook-permits', label: 'Cook County building permits', retrievedAt: iso(refreshed ?? today) } });
        permits.sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
      }
      const sales: Sale[] = [];
      for (let k = 0, n = r.int(0, 2); k < n; k++) {
        const yearsAgo = r.int(1, 24);
        sales.push({ saleDate: isoDay(today - yearsAgo * 365 * DAY - r.int(0, 300) * DAY), price: Math.round((sqft * r.int(150, 260) * (1 - yearsAgo * 0.025)) / 1000) * 1000, source: primarySource });
      }
      sales.sort((a, b) => b.saleDate.localeCompare(a.saleDate));

      const overrides: ManualOverride[] = [];
      if (r.next() < 0.03) overrides.push({ field: 'heatingType', value: 'heat-pump', reason: 'Verified on site by technician. Assessor record says forced-air gas.', by: 'dispatch@arrhvac.com', at: iso(today - r.int(5, 200) * DAY) });

      // Two source releases for areas refreshed from the 2025 release, one for the rest.
      const versions: PropertyVersion[] = [];
      const jobId = jobFor(z.township, z.county);
      if (z.sourceYear === 2025) {
        const prior: PropertyFacts = { ...facts, sqft: facts.sqft && r.next() < 0.05 ? Math.round(facts.sqft * 0.72) : facts.sqft };
        versions.push({ propertyId: id, version: 1, capturedAt: iso(today - 380 * DAY), source: { ...primarySource, label: assessorLabel(source, 2024), sourceYear: 2024, retrievedAt: iso(today - 380 * DAY) }, ingestionJobId: 'job-2107', facts: prior, changedFields: [] });
        versions.push({ propertyId: id, version: 2, capturedAt: primarySource.retrievedAt, source: primarySource, ingestionJobId: jobId, facts, changedFields: prior.sqft !== facts.sqft ? ['sqft'] : [] });
      } else if (z.source) {
        versions.push({ propertyId: id, version: 1, capturedAt: primarySource.retrievedAt, source: primarySource, ingestionJobId: jobId, facts, changedFields: [] });
      }

      // Cook PINs are 12-34-567-890-0000; DuPage's are 09-12-345-678. Redraw on the rare collision so PINs stay unique.
      let pin: string;
      do {
        const body = `${String(r.int(1, 36)).padStart(2, '0')}-${String(r.int(100, 420))}-${String(r.int(1, 60)).padStart(3, '0')}`;
        pin = z.county === 'dupage' ? `09-${body}` : `${r.int(22, 28)}-${body}-0000`;
      } while (usedPins.has(pin));
      usedPins.add(pin);
      properties.push({
        id, pin,
        address: `${r.int(2, 180) * 100 + r.int(0, 99)} ${r.pick(STREETS)}`,
        city: z.city, zip: z.zip, township: z.township, county: z.county,
        ...facts,
        lastHvacPermitOn: permits.find((p) => p.kind === 'hvac')?.issuedOn ?? null,
        weatherAreaId: z.weatherAreaId, primarySource, lastRefreshedAt: primarySource.retrievedAt,
        permits, sales, overrides, versions
      });
    }
  }
  // Two deliberate duplicates (same address, different PIN), which the quality queue should catch.
  for (const idx of [7, 311]) {
    const src = properties[idx]!;
    properties.push({ ...src, id: `p-${++seq}`, pin: src.pin.replace(/\d+$/, (m) => String(Number(m) + 1001).padStart(m.length, '0')), versions: [], overrides: [] });
  }

  /* ── Coverage (ZIPs + townships), computed from the properties so the numbers agree ──────────────────────── */
  const areaFromZip = (z: (typeof ZIPS)[number]): CoverageArea => {
    const homes = properties.filter((p) => p.zip === z.zip && p.city === z.city);
    const miss = (f: (p: PropertyDetail) => boolean) => (homes.length ? homes.filter(f).length / homes.length : 0);
    return {
      id: `zip-${z.zip}`, kind: 'zip', name: `${z.zip} · ${z.city}`, county: z.county, townshipId: townshipId(z.township),
      homesIndexed: homes.length,
      parcelsExpected: z.completeness > 0 ? Math.round(homes.length / z.completeness) : EXPECTED_WHEN_MISSING[z.zip] ? Math.round(EXPECTED_WHEN_MISSING[z.zip]! / 100) : null,
      lastRefreshedAt: z.refreshedDaysAgo == null ? null : iso(today - z.refreshedDaysAgo * DAY + 10 * 3600_000),
      sourceYear: z.sourceYear, source: z.source,
      missing: { sqft: miss((p) => p.sqft == null), yearBuilt: miss((p) => p.yearBuilt == null), stories: miss((p) => p.stories == null), heatingType: miss((p) => p.heatingType === 'unknown') },
      tile: z.tile
    };
  };
  const zipAreas = ZIPS.map(areaFromZip);
  const townships = [...new Set(ZIPS.map((z) => z.township))];
  const townshipAreas: CoverageArea[] = townships.map((t, i) => {
    const zs = ZIPS.filter((z) => z.township === t);
    const parts = zs.map((z) => zipAreas.find((a) => a.id === `zip-${z.zip}`)!);
    const homes = parts.reduce((s, a) => s + a.homesIndexed, 0);
    const expected = parts.reduce((s, a) => s + (a.parcelsExpected ?? 0), 0);
    const wavg = (k: keyof CoverageArea['missing']) => (homes ? parts.reduce((s, a) => s + a.missing[k] * a.homesIndexed, 0) / homes : 0);
    const refreshed = parts.map((a) => a.lastRefreshedAt).filter(Boolean).sort()[0] ?? null; // oldest part governs
    return {
      id: townshipId(t), kind: 'township', name: `${t} Township`, county: zs[0]!.county, townshipId: null,
      homesIndexed: homes, parcelsExpected: expected || null, lastRefreshedAt: refreshed,
      sourceYear: zs[0]!.sourceYear, source: zs[0]!.source,
      missing: { sqft: wavg('sqft'), yearBuilt: wavg('yearBuilt'), stories: wavg('stories'), heatingType: wavg('heatingType') },
      tile: { col: i, row: 0 }
    };
  });

  /* ── Weather: stored once per area ───────────────────────────────────────────────────────────────────────── */
  const weatherAreas: WeatherArea[] = [
    // Station and grid ids are placeholders to confirm against api.weather.gov/points before the NOAA/NWS repos go live.
    { id: 'mdw-north', name: 'North / Midway', stationId: 'USW00014819', nwsGrid: 'LOT/70,66', zips: ZIPS.filter((z) => z.weatherAreaId === 'mdw-north').map((z) => z.zip) },
    { id: 'orland', name: 'Orland / Tinley', stationId: 'USW00014819', nwsGrid: 'LOT/66,60', zips: ZIPS.filter((z) => z.weatherAreaId === 'orland').map((z) => z.zip) }
  ];
  const seasonal = (t: number) => {
    const doy = (t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / DAY;
    return 49.5 - 25.5 * Math.cos((2 * Math.PI * (doy - 15)) / 365);
  };
  const obsSource: SourceRef = { source: 'noaa-ncei', label: 'NOAA NCEI GHCN-Daily (mock)', retrievedAt: iso(today + 6 * 3600_000) };
  const observations: WeatherObservation[] = [];
  for (const area of weatherAreas) {
    const wr = rng(area.id === 'orland' ? 60462 : 60453);
    let anomaly = 0;
    for (let d = 400; d >= 1; d--) {
      const t = today - d * DAY;
      anomaly = anomaly * 0.65 + wr.normal(0, 3.8); // weather persists for a few days (stationary sd ≈ 5°F)
      const avg = seasonal(t) + anomaly;
      const spread = 8 + wr.next() * 5;
      const tMaxF = Math.round(avg + spread), tMinF = Math.round(avg - spread);
      const tAvgF = (tMaxF + tMinF) / 2;
      const wet = wr.next() < 0.3;
      const precipIn = wet ? Math.round(-Math.log(1 - wr.next()) * 30) / 100 : 0;
      observations.push({ areaId: area.id, date: isoDay(t), tMaxF, tMinF, tAvgF, hdd: hdd(tAvgF), cdd: cdd(tAvgF), precipIn, snowIn: wet && tAvgF < 32 ? Math.round(precipIn * 10 * 10) / 10 : 0, source: obsSource });
    }
  }
  const normals: WeatherNormal[] = [];
  for (const area of weatherAreas) {
    for (let m = 1; m <= 12; m++) {
      let h = 0, c = 0, days = 0;
      for (let d = 1; d <= 31; d++) {
        const t = Date.UTC(2021, m - 1, d);
        if (new Date(t).getUTCMonth() !== m - 1) break;
        const avg = seasonal(t);
        // Normals are climatology, not a clean sine: spread the mean so shoulder months still collect both kinds.
        h += (hdd(avg - 6) + hdd(avg + 6)) / 2;
        c += (cdd(avg - 6) + cdd(avg + 6)) / 2;
        days++;
      }
      normals.push({ areaId: area.id, month: m, hdd: Math.round(h), cdd: Math.round(c), precipIn: Math.round((2 + Math.sin((m - 3) / 2) * 1.5) * 100) / 100 + 1 });
    }
  }
  const forecasts: WeatherForecast[] = weatherAreas.map((area) => {
    const fr = rng(area.id.length * 97);
    return {
      areaId: area.id, issuedAt: iso(now.getTime() - 2 * 3600_000),
      source: { source: 'nws', label: `NWS ${area.nwsGrid} (mock)`, retrievedAt: iso(now.getTime() - 2 * 3600_000) },
      periods: Array.from({ length: 7 }, (_, i) => {
        const t = today + i * DAY;
        const avg = seasonal(t) + fr.normal(3, 4);
        const precipChance = Math.round(fr.next() * 7) * 10;
        return { date: isoDay(t), highF: Math.round(avg + 10), lowF: Math.round(avg - 9), precipChance, summary: precipChance >= 50 ? 'Showers likely' : precipChance >= 30 ? 'Chance of showers' : fr.next() < 0.5 ? 'Mostly sunny' : 'Partly cloudy' };
      })
    };
  });
  // Alerts follow the forecast: only raised when a mock period crosses NWS-style thresholds, so an empty list is the honest normal state.
  const alerts: WeatherAlert[] = [];
  for (const f of forecasts) {
    const hot = f.periods.find((p) => p.highF >= 92);
    const cold = f.periods.find((p) => p.lowF <= 0);
    const frost = f.periods.find((p) => p.lowF <= 33 && p.lowF > 0);
    const hit = hot ? ['Heat Advisory', `Heat index near ${hot.highF + 8}°F`, hot] as const : cold ? ['Cold Weather Advisory', `Wind chills to ${cold.lowF - 15}°F`, cold] as const : frost ? ['Frost Advisory', `Lows near ${frost.lowF}°F`, frost] as const : null;
    if (hit) alerts.push({ id: `al-${f.areaId}`, areaId: f.areaId, event: hit[0], severity: 'moderate', headline: `${hit[0]}: ${hit[1]} (mock)`, onset: `${hit[2].date}T12:00:00Z`, ends: `${hit[2].date}T23:00:00Z`, source: f.source });
  }

  /* ── Demand (Sera, mocked): driven by degree days with a 1–3 day lag, plus noise ────────────────────────── */
  const demand: DemandMetric[] = [];
  const demandSource: SourceRef = { source: 'sera', label: 'Sera AppointmentsReport (mock)', retrievedAt: iso(today + 7 * 3600_000) };
  const dr = rng(708);
  for (const t of townshipAreas) {
    if (!t.homesIndexed) continue;
    const areaId = ZIPS.find((z) => townshipId(z.township) === t.id)!.weatherAreaId;
    const obs = observations.filter((o) => o.areaId === areaId);
    const scale = t.homesIndexed / 150;
    for (let i = 3; i < obs.length; i++) {
      const lagH = (obs[i]!.hdd + obs[i - 1]!.hdd * 0.8 + obs[i - 2]!.hdd * 0.5) / 2.3;
      const lagC = (obs[i]!.cdd + obs[i - 1]!.cdd * 0.8 + obs[i - 2]!.cdd * 0.5) / 2.3;
      const heatingCalls = Math.max(0, Math.round(scale * (0.4 + lagH * 0.09) + dr.normal(0, 0.7)));
      const coolingCalls = Math.max(0, Math.round(scale * (0.3 + lagC * 0.22) + dr.normal(0, 0.7)));
      demand.push({ date: obs[i]!.date, areaId: t.id, heatingCalls, coolingCalls, leads: Math.max(0, Math.round((heatingCalls + coolingCalls) * 0.45 + dr.normal(0.5, 0.8))), source: demandSource });
    }
  }

  /* ── Data-quality issues, detected from the data above ───────────────────────────────────────────────────── */
  const issues: DataQualityIssue[] = [];
  let iq = 500;
  const issue = (i: Omit<DataQualityIssue, 'id' | 'detectedAt' | 'status'> & { status?: DataQualityIssue['status']; daysAgo?: number }) =>
    issues.push({ id: `dq-${++iq}`, status: i.status ?? 'open', detectedAt: iso(today - (i.daysAgo ?? 1) * DAY + 11 * 3600_000), ...i });
  const byAddr = new Map<string, PropertyDetail>();
  for (const p of properties) {
    const k = `${p.address}|${p.zip}`;
    const prev = byAddr.get(k);
    if (prev) issue({ kind: 'duplicate-parcel', severity: 'high', propertyId: p.id, areaId: `zip-${p.zip}`, summary: `${p.address}, ${p.city} appears under two PINs (${prev.pin}, ${p.pin}).`, detectedBy: 'rule:unique-address' });
    else byAddr.set(k, p);
  }
  for (const p of properties) {
    if (p.sqft == null) issue({ kind: 'missing-sqft', severity: 'medium', propertyId: p.id, areaId: `zip-${p.zip}`, summary: `No square footage for ${p.address}, ${p.city}. Sizing falls back to a manual entry.`, detectedBy: 'rule:required-sqft', daysAgo: 3 });
    if (p.yearBuilt == null) issue({ kind: 'missing-year-built', severity: 'low', propertyId: p.id, areaId: `zip-${p.zip}`, summary: `No year built for ${p.address}, ${p.city}.`, detectedBy: 'rule:required-year', daysAgo: 3 });
    const v2 = p.versions.find((v) => v.changedFields.includes('sqft'));
    if (v2) {
      const v1 = p.versions[0]!;
      issue({ kind: 'large-change', severity: 'medium', status: 'in-review', propertyId: p.id, areaId: `zip-${p.zip}`, summary: `Square footage changed ${v1.facts.sqft} → ${v2.facts.sqft} between the 2024 and 2025 releases.`, detectedBy: 'rule:release-diff', daysAgo: 5 });
    }
  }
  issue({ kind: 'implausible-value', severity: 'high', propertyId: null, areaId: twp('Bremen'), summary: 'PIN 28-08-315-011-0000: year built 1780 for a class 2-03 home. Rejected at import.', detectedBy: 'job-2391', daysAgo: 33 });
  issue({ kind: 'address-match-failure', severity: 'medium', propertyId: null, areaId: twp('Bremen'), summary: '212 parcels in the Bremen import did not match the Cook Assessor address spelling (e.g. "W 159TH ST" vs "159th St").', detectedBy: 'job-2391', daysAgo: 33 });
  issue({ kind: 'address-match-failure', severity: 'low', status: 'resolved', propertyId: null, areaId: twp('Orland'), summary: '14 Orland parcels had unit numbers in the street field. Fixed in normalize.ts.', detectedBy: 'job-2412', daysAgo: 5 });
  issues.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));

  /* ── Projects & audit ────────────────────────────────────────────────────────────────────────────────────── */
  const usage = (base: number, seed: number) => {
    const u = rng(seed);
    return Array.from({ length: 14 }, (_, i) => ({ date: isoDay(today - (13 - i) * DAY), requests: Math.max(0, Math.round(base * (1 + u.normal(0, 0.25)))) }));
  };
  const projects: Project[] = [
    { id: 'prj-pricing', name: 'ARR Instant Price', description: 'Transparent-pricing wizard (apps/pricing). Reads the parcel record for sizing.', owner: 'jason@arrhvac.com', datasets: ['properties', 'coverage'], territories: ['cook'], keyPrefix: 'hub_pk_3f9a', keyCreatedAt: iso(today - 60 * DAY), keyLastUsedAt: iso(now.getTime() - 14 * 60_000), rateLimitPerMin: 120, usage: usage(410, 1), status: 'active' },
    { id: 'prj-territory', name: 'Territory analysis', description: 'Revenue per call by ZIP. Joins housing stock to Sera appointments.', owner: 'jason@arrhvac.com', datasets: ['properties', 'demand', 'coverage'], territories: ['cook', 'dupage'], keyPrefix: 'hub_pk_81c2', keyCreatedAt: iso(today - 21 * DAY), keyLastUsedAt: iso(today - 2 * DAY), rateLimitPerMin: 30, usage: usage(24, 2), status: 'active' },
    { id: 'prj-membership', name: 'Membership ops', description: 'Renewal waves. Planned: weather-triggered tune-up reminders.', owner: 'office@arrhvac.com', datasets: ['weather'], territories: ['cook', 'will'], keyPrefix: 'hub_pk_c07e', keyCreatedAt: iso(today - 9 * DAY), keyLastUsedAt: null, rateLimitPerMin: 30, usage: usage(0, 3), status: 'paused' }
  ];
  const audit: AuditEvent[] = [
    { id: 'au-1', at: iso(now.getTime() - 40 * 60_000), actor: 'system', action: 'import.progress', target: 'job-2419', detail: 'Bremen refresh passed 60% (17,012 of 27,400).' },
    { id: 'au-2', at: iso(now.getTime() - 3 * 3600_000), actor: 'jason@arrhvac.com', action: 'import.dry-run.request', target: 'job-2418', detail: 'Dry run queued for Downers Grove Township (DuPage).' },
    { id: 'au-3', at: iso(today - 2 * DAY + 15 * 3600_000), actor: 'system', action: 'quality.detect', target: 'rule:release-diff', detail: 'Large-change rule flagged square-footage jumps from the 2025 Cook release.' },
    { id: 'au-4', at: iso(today - 5 * DAY + 10 * 3600_000), actor: 'system', action: 'import.succeeded', target: 'job-2412', detail: 'Orland Township: 31,054 accepted, 146 rejected.' },
    { id: 'au-5', at: iso(today - 9 * DAY + 11 * 3600_000), actor: 'jason@arrhvac.com', action: 'project.key.create', target: 'prj-membership', detail: 'Key hub_pk_c07e… issued. Project left paused.' },
    { id: 'au-6', at: iso(today - 16 * DAY + 9 * 3600_000), actor: 'system', action: 'import.failed', target: 'job-2398', detail: 'Will County: no bulk source configured.' },
    { id: 'au-7', at: iso(today - 21 * DAY + 13 * 3600_000), actor: 'jason@arrhvac.com', action: 'project.create', target: 'prj-territory', detail: 'Datasets: properties, demand, coverage.' }
  ];

  return { now, properties, coverage: [...zipAreas, ...townshipAreas], weatherAreas, observations, normals, forecasts, alerts, demand, jobs, issues, projects, audit };
}
