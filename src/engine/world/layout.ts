/** Typed access to src/world/layout.json, plus 2D geometry helpers. */
import raw from '../../world/layout.json';
import type { Security, Vec2, Vec3, ZoneId } from '../types';
import { areaAtX, AREAS } from './areas';

export interface Wall {
  a: Vec2; b: Vec2; h: number; material: string; zone: string;
  door?: boolean; note?: string; addedAfterSurvey?: boolean; rfIgnore?: boolean;
}
export interface Sector { azDeg: number; downtiltDeg: number }
export interface GridSpec { bounds: [Vec2, Vec2]; res: number }
export interface Transmitter {
  id: string; kind: 'wifi' | 'cell'; net: string; pos: Vec3; grid: GridSpec;
  ssid?: string; bssid?: string; security?: Security; pmf?: 'none' | 'optional' | 'required';
  band?: '2.4' | '5'; channel?: number; eirpDbm?: number; surveyPos?: Vec3;
  captivePortal?: boolean; airtimeLoad?: boolean; attacker?: boolean; startsOff?: boolean;
  uplinks?: Array<{ type: 'LEO' | 'GEO'; primary?: boolean }>;
  operator?: string; fcGHz?: number; model?: 'UMa' | 'UMi' | 'RMa'; sectors?: Sector[];
  /** mobile technology as measured (default NR, i.e. 5G): only changes what the screen calls it */
  rat?: 'LTE' | 'NR';
  /** which scene draws it (default: x > 5000 → desert, else the city) */
  zone?: string;
  /** path-loss exponent fitted for this transmitter's surroundings (default: params wifiPathLossExp) */
  plExp?: number;
  /** more networks on the same radio (a venue AP broadcasts several): heard at the same strength, names not kept */
  alias?: Array<{ bssid: string; security: Security }>;
  /** cell: calibration added to the 3GPP model so a fitted site matches measured RSRP (venue survey) */
  rsrpOffsetDb?: number;
  /** the venue's own survey said where this was fitted from (notes for the network tag) */
  fit?: { points: number; rmseDb: number };
  /** Wi-Fi generation as the survey phone reported it (Android: 4 = 802.11n … 6 = 802.11ax, 8 = 802.11be) */
  std?: number;
  /** the hops behind this access point, between the radio and the Internet (a mesh hop, a shop's DSL …); the
   *  office, café and site networks keep their own in index.ts */
  backhaul?: Array<{ name: string; owdMs: number; jitterMs?: number; loss?: number }>;
  /** today's phone has joined this name before, so it joins it again by itself (the baselines' saved list) */
  saved?: boolean;
  /** Passpoint / an organisation profile: the phone holds this network's certificate profile (Trusted once checked) */
  enrolled?: boolean;
  /** with `attacker`: a fake that is simply there (on the air while Lab's attacker is enabled), not a timed attack */
  rogue?: boolean;
  /** cell: an indoor antenna (DAS). No wall loss to a phone in the same building; the building's wall to one outside */
  indoor?: boolean;
  /** cell: no sector pattern (a ceiling antenna) */
  omni?: boolean;
  /** what the Vision tag calls it instead of the operator's name ("5G small cell", "Wi-Fi palm") */
  title?: string;
}
export interface Building { id: string; poly: Vec2[]; o2i: 'high' | 'low'; kind: string; height?: number; floor?: string }
export interface Region { id: string; poly: Vec2[] }
export interface Zone { id: ZoneId; label: string; bounds: [Vec2, Vec2]; spawn: { pos: Vec2; headingDeg: number } }

export interface Layout {
  site: { latDeg: number; lonDeg: number };
  zones: Zone[];
  regions: Region[];
  buildings: Building[];
  walls: Wall[];
  transmitters: Transmitter[];
  props: Record<string, any>;
  street: { road: [Vec2, Vec2]; sidewalks: Array<[Vec2, Vec2]> };
  routes: Record<string, Vec2[]>;
  visual: Record<string, { pos: Vec3; label?: string }>;
}

export const LAYOUT = raw as unknown as Layout;
// the four places added on 11 Nov (park, downtown, metro, souk) join the same layout: one geometry for every reader
LAYOUT.zones.push(...AREAS.zones);
LAYOUT.regions.push(...AREAS.regions);
LAYOUT.buildings.push(...AREAS.buildings);
LAYOUT.walls.push(...AREAS.walls);
LAYOUT.transmitters.push(...AREAS.transmitters);
Object.assign(LAYOUT.routes, AREAS.routes);
Object.assign(LAYOUT.visual, AREAS.visual);

export function txById(id: string): Transmitter {
  const t = LAYOUT.transmitters.find((x) => x.id === id);
  if (!t) throw new Error(`unknown transmitter ${id}`);
  return t;
}

// ───────────── geometry ─────────────

/** Proper segment intersection (excluding touching at endpoints of the query only by epsilon). */
export function segmentsCross(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const d1x = q[0] - p[0], d1y = q[1] - p[1];
  const d2x = b[0] - a[0], d2y = b[1] - a[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const ex = a[0] - p[0], ey = a[1] - p[1];
  const t = (ex * d2y - ey * d2x) / den;
  const u = (ex * d1y - ey * d1x) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1;
}

export function pointInPoly(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}

export function distToPolyEdge(p: Vec2, poly: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

export function buildingAt(p: Vec2): Building | null {
  for (const b of LAYOUT.buildings) if (pointInPoly(p, b.poly)) return b;
  return null;
}

export function regionAt(p: Vec2): string | null {
  // most specific (last listed) wins; lobby is inside office
  let r: string | null = null;
  for (const reg of LAYOUT.regions) if (pointInPoly(p, reg.poly)) r = reg.id;
  return r;
}

export function zoneAt(p: Vec2): ZoneId {
  for (const z of LAYOUT.zones) {
    const [[x0, y0], [x1, y1]] = z.bounds;
    if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) return z.id;
  }
  return p[0] > 30000 ? 'hall' : p[0] > 5000 ? 'desert' : p[0] < -5000 ? areaAtX(p[0]) : 'street';
}

/** the scene a transmitter belongs to: what the renderer draws and labels in each zone */
export function txScene(t: Transmitter): string { return t.zone ?? (t.pos[0] > 5000 ? 'desert' : 'city'); }
export function sceneOf(zone: ZoneId): string { return zone === 'office' || zone === 'street' ? 'city' : zone; }

export function inRegion(p: Vec2, id: string): boolean {
  const reg = LAYOUT.regions.find((r) => r.id === id);
  return !!reg && pointInPoly(p, reg.poly);
}
