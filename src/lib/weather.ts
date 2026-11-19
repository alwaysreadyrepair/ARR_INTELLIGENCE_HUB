import type { WeatherNormal, WeatherObservation } from '../domain/types.ts';

/* "Weather stress" is degree-day load over the last N days compared with the climate normal for those same days.
 * The inputs are returned with the label so the UI can show exactly how it was reached. It is a description of the
 * weather, not a demand forecast. */

export interface Stress {
  level: 'low' | 'normal' | 'high';
  mode: 'heating' | 'cooling';
  label: string;
  hdd: number;
  cdd: number;
  hddNormal: number;
  cddNormal: number;
  days: number;
  /** Actual load / normal load, where load = HDD + CDD. */
  ratio: number | null;
}

/** The weather area a territory rolls up to: the area covering the township's first ZIP. Falls back to the first
 *  area when there's no territory filter or no match. */
export function weatherAreaFor<A extends { id: string; zips: string[] }>(
  territory: string | undefined,
  zipAreas: { id: string; townshipId: string | null }[],
  areas: A[]
): A | undefined {
  const zip = territory ? zipAreas.find((z) => z.townshipId === territory)?.id.replace(/^zip-/, '') : undefined;
  return (zip && areas.find((a) => a.zips.includes(zip))) || areas[0];
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Normal HDD/CDD for one calendar day: the monthly normal spread evenly across the month. */
export function dailyNormal(dateIso: string, normals: WeatherNormal[]): { hdd: number; cdd: number } {
  const y = Number(dateIso.slice(0, 4)), m = Number(dateIso.slice(5, 7));
  const n = normals.find((x) => x.month === m);
  if (!n) return { hdd: 0, cdd: 0 };
  const d = daysInMonth(y, m);
  return { hdd: n.hdd / d, cdd: n.cdd / d };
}

export function weatherStress(obs: WeatherObservation[], normals: WeatherNormal[]): Stress | null {
  if (obs.length === 0) return null;
  let hdd = 0, cdd = 0, hddNormal = 0, cddNormal = 0;
  for (const o of obs) {
    hdd += o.hdd;
    cdd += o.cdd;
    const n = dailyNormal(o.date, normals);
    hddNormal += n.hdd;
    cddNormal += n.cdd;
  }
  const load = hdd + cdd, normal = hddNormal + cddNormal;
  const ratio = normal > 0 ? load / normal : null;
  const mode = hdd >= cdd ? 'heating' : 'cooling';
  // Under ~3 degree days a day there is little load either way, whatever the ratio says.
  const level: Stress['level'] = load < obs.length * 3 ? 'low' : ratio != null && ratio >= 1.25 ? 'high' : 'normal';
  const label = level === 'low' ? 'Mild, low load' : level === 'high' ? `High ${mode} load` : `Normal ${mode} load`;
  return { level, mode, label, hdd: Math.round(hdd), cdd: Math.round(cdd), hddNormal: Math.round(hddNormal), cddNormal: Math.round(cddNormal), days: obs.length, ratio };
}
