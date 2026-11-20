/* The map-pack grid: evenly spaced Google Maps search points laid over the whole service area.
 *
 * Map-pack results depend on where the searcher stands, so one search from each city centre says little about the
 * rest of town. The grid covers the bounding box of the tracked cities plus a margin, so neighbouring cities share
 * points instead of paying for overlapping grids. Pure geometry; the refresh script and the mock both use it. */

import type { GridPoint, SeoMarket } from '../../domain/seo.ts';

const MILES_PER_DEG_LAT = 69.0;
const milesPerDegLon = (lat: number) => 69.17 * Math.cos((lat * Math.PI) / 180);

/** Straight-line miles between two points (equirectangular; plenty for a few miles). */
export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dy = (a.lat - b.lat) * MILES_PER_DEG_LAT;
  const dx = (a.lon - b.lon) * milesPerDegLon((a.lat + b.lat) / 2);
  return Math.hypot(dx, dy);
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Grid points `spacingMiles` apart covering every market plus `marginMiles` on each side, centred on the area.
 *  Row 0 is the north edge, column 0 the west edge. Each point names its nearest tracked city. */
export function gridPoints(markets: SeoMarket[], spacingMiles: number, marginMiles: number): GridPoint[] {
  if (!markets.length || spacingMiles <= 0) return [];
  const lats = markets.map((m) => m.lat), lons = markets.map((m) => m.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const heightMi = (Math.max(...lats) - Math.min(...lats)) * MILES_PER_DEG_LAT + 2 * marginMiles;
  const widthMi = (Math.max(...lons) - Math.min(...lons)) * milesPerDegLon(midLat) + 2 * marginMiles;
  const rows = Math.floor(heightMi / spacingMiles) + 1;
  const cols = Math.floor(widthMi / spacingMiles) + 1;
  const dLat = spacingMiles / MILES_PER_DEG_LAT, dLon = spacingMiles / milesPerDegLon(midLat);
  const points: GridPoint[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lat = round5(midLat + ((rows - 1) / 2 - row) * dLat);
      const lon = round5(midLon + (col - (cols - 1) / 2) * dLon);
      const nearest = markets.reduce((best, m) => (milesBetween({ lat, lon }, m) < milesBetween({ lat, lon }, best) ? m : best));
      points.push({ row, col, lat, lon, marketId: nearest.id });
    }
  }
  return points;
}
