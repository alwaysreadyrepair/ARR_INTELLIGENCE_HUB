import type { County, SourceId } from '../../domain/types.ts';

/* ARR's service area as ZIP → township → county. The geography is real. Every count, date and completeness figure
 * generated from it is MOCK. `era` shapes the synthetic housing stock (median year built); `tile` places the ZIP on
 * the schematic territory map (col 0 = west, row 0 = north). It is a layout grid, not a projection. */

export interface ZipSeed {
  zip: string;
  city: string;
  township: string;
  county: County;
  era: number;
  homes: number;           // mock homes to generate
  completeness: number;    // mock homesIndexed / parcelsExpected
  refreshedDaysAgo: number | null; // null = never ingested
  source: SourceId | null;
  sourceYear: number | null;
  weatherAreaId: string;
  tile: { col: number; row: number };
}

export const ZIPS: ZipSeed[] = [
  { zip: '60527', city: 'Burr Ridge',          township: 'Downers Grove', county: 'dupage', era: 1982, homes: 26,  completeness: 0.31, refreshedDaysAgo: 41,   source: 'dupage-assessor', sourceYear: 2025, weatherAreaId: 'mdw-north', tile: { col: 1, row: 0 } },
  { zip: '60521', city: 'Hinsdale',            township: 'Downers Grove', county: 'dupage', era: 1952, homes: 22,  completeness: 0.24, refreshedDaysAgo: 41,   source: 'dupage-assessor', sourceYear: 2025, weatherAreaId: 'mdw-north', tile: { col: 2, row: 0 } },
  { zip: '60525', city: 'La Grange',           township: 'Lyons',         county: 'cook',   era: 1948, homes: 88,  completeness: 0.93, refreshedDaysAgo: 214,  source: 'cook-assessor',   sourceYear: 2024, weatherAreaId: 'mdw-north', tile: { col: 3, row: 0 } },
  { zip: '60439', city: 'Lemont',              township: 'Lemont',        county: 'cook',   era: 1990, homes: 74,  completeness: 0.95, refreshedDaysAgo: 12,   source: 'cook-assessor',   sourceYear: 2025, weatherAreaId: 'mdw-north', tile: { col: 0, row: 1 } },
  { zip: '60480', city: 'Willow Springs',      township: 'Lyons',         county: 'cook',   era: 1968, homes: 38,  completeness: 0.9,  refreshedDaysAgo: 214,  source: 'cook-assessor',   sourceYear: 2024, weatherAreaId: 'mdw-north', tile: { col: 2, row: 1 } },
  { zip: '60453', city: 'Oak Lawn',            township: 'Worth',         county: 'cook',   era: 1956, homes: 120, completeness: 0.97, refreshedDaysAgo: 188,  source: 'cook-assessor',   sourceYear: 2024, weatherAreaId: 'mdw-north', tile: { col: 4, row: 1 } },
  { zip: '60464', city: 'Palos Park',          township: 'Palos',         county: 'cook',   era: 1978, homes: 52,  completeness: 0.96, refreshedDaysAgo: 9,    source: 'cook-assessor',   sourceYear: 2025, weatherAreaId: 'orland',    tile: { col: 1, row: 2 } },
  { zip: '60465', city: 'Palos Hills',         township: 'Palos',         county: 'cook',   era: 1972, homes: 70,  completeness: 0.96, refreshedDaysAgo: 9,    source: 'cook-assessor',   sourceYear: 2025, weatherAreaId: 'orland',    tile: { col: 2, row: 2 } },
  { zip: '60463', city: 'Palos Heights',       township: 'Palos',         county: 'cook',   era: 1966, homes: 64,  completeness: 0.97, refreshedDaysAgo: 9,    source: 'cook-assessor',   sourceYear: 2025, weatherAreaId: 'orland',    tile: { col: 3, row: 2 } },
  { zip: '60482', city: 'Worth',               township: 'Worth',         county: 'cook',   era: 1958, homes: 46,  completeness: 0.94, refreshedDaysAgo: 188,  source: 'cook-assessor',   sourceYear: 2024, weatherAreaId: 'mdw-north', tile: { col: 4, row: 2 } },
  { zip: '60491', city: 'Homer Glen',          township: 'Homer',         county: 'will',   era: 1996, homes: 0,   completeness: 0,    refreshedDaysAgo: null, source: null,              sourceYear: null, weatherAreaId: 'orland',    tile: { col: 0, row: 3 } },
  { zip: '60467', city: 'Orland Park',         township: 'Orland',        county: 'cook',   era: 1994, homes: 132, completeness: 0.98, refreshedDaysAgo: 5,    source: 'cook-assessor',   sourceYear: 2025, weatherAreaId: 'orland',    tile: { col: 1, row: 3 } },
  { zip: '60462', city: 'Orland Park',         township: 'Orland',        county: 'cook',   era: 1979, homes: 146, completeness: 0.98, refreshedDaysAgo: 5,    source: 'cook-assessor',   sourceYear: 2025, weatherAreaId: 'orland',    tile: { col: 2, row: 3 } },
  { zip: '60477', city: 'Tinley Park',         township: 'Bremen',        county: 'cook',   era: 1976, homes: 128, completeness: 0.95, refreshedDaysAgo: 33,   source: 'cook-assessor',   sourceYear: 2025, weatherAreaId: 'orland',    tile: { col: 3, row: 3 } },
  { zip: '60452', city: 'Oak Forest',          township: 'Bremen',        county: 'cook',   era: 1964, homes: 84,  completeness: 0.94, refreshedDaysAgo: 33,   source: 'cook-assessor',   sourceYear: 2025, weatherAreaId: 'orland',    tile: { col: 4, row: 3 } },
  { zip: '60451', city: 'New Lenox',           township: 'New Lenox',     county: 'will',   era: 1998, homes: 0,   completeness: 0,    refreshedDaysAgo: null, source: null,              sourceYear: null, weatherAreaId: 'orland',    tile: { col: 1, row: 4 } },
  { zip: '60448', city: 'Mokena',              township: 'Frankfort',     county: 'will',   era: 1995, homes: 0,   completeness: 0,    refreshedDaysAgo: null, source: null,              sourceYear: null, weatherAreaId: 'orland',    tile: { col: 2, row: 4 } },
  { zip: '60487', city: 'Tinley Park',         township: 'Orland',        county: 'cook',   era: 1993, homes: 96,  completeness: 0.97, refreshedDaysAgo: 5,    source: 'cook-assessor',   sourceYear: 2025, weatherAreaId: 'orland',    tile: { col: 3, row: 4 } },
  { zip: '60478', city: 'Country Club Hills',  township: 'Bremen',        county: 'cook',   era: 1974, homes: 58,  completeness: 0.92, refreshedDaysAgo: 33,   source: 'cook-assessor',   sourceYear: 2025, weatherAreaId: 'orland',    tile: { col: 4, row: 4 } },
  { zip: '60423', city: 'Frankfort',           township: 'Frankfort',     county: 'will',   era: 2001, homes: 0,   completeness: 0,    refreshedDaysAgo: null, source: null,              sourceYear: null, weatherAreaId: 'orland',    tile: { col: 2, row: 5 } }
];

/** Mock parcel counts for ZIPs never ingested, so they still show a denominator on the coverage page. */
export const EXPECTED_WHEN_MISSING: Record<string, number> = { '60491': 8600, '60451': 9800, '60448': 7100, '60423': 7400 };

export const townshipId = (name: string) => `twp-${name.toLowerCase().replace(/\s+/g, '-')}`;

export const STREETS = [
  'Ravinia Ave', 'Wheeler Dr', 'Sayre Ave', 'Hollow Tree Rd', 'Meadowview Dr', 'Stonebridge Ln', 'Oak Park Ave',
  'Harlem Ave', 'Laurel Ln', 'Crystal Tree Dr', 'Brookhill Ct', 'Southwick Dr', 'Chestnut Ln', 'Highland Ave',
  'Kean Ave', 'Ridgeland Ave', 'Pinewood Dr', 'Timber Ridge Ln', 'Cambridge Ct', 'Maple Ave', 'Sycamore Dr',
  'Evergreen Ln', 'Parkside Dr', 'Windsor Ct', 'Golfview Dr', 'Lakeview Ter', 'Birchwood Ct', 'Hickory Hills Dr'
];
