/**
 * The venue replica: an optional, separate environment built from a private venue file (plans, photos and our
 * own Wi-Fi survey). The organisers' plans are confidential, so the file never ships with the public repo or
 * site: the app registers it only when `venue-private/hall/venue.json` exists locally (src/app/venueLoad.ts),
 * and tools/venue/build.ts makes it from the plan and the survey files.
 *
 * Registration appends the venue's zone, walls, transmitters, route and scenario to the shared layout, so the
 * engine treats the hall like any other scene. It must run before the first Sim is created.
 */
import type { Scenario } from '../scenario/scenarios';
import { SCENARIOS } from '../scenario/scenarios';
import type { Security, Vec2, Vec3 } from '../types';
import { LAYOUT, type Building, type Region, type Transmitter, type Wall, type Zone } from './layout';

/**
 * someone else's network in the hall, placed from where our survey heard it: a phone hotspot (randomised address)
 * or a fixed device (an exhibitor's router, a printer …). Drawn as an anonymous dot, never named, never joined.
 */
export interface VenueHotspot {
  id: string; pos: Vec2; eirpDbm: number; band: '2.4' | '5'; channel: number;
  kind?: 'hotspot' | 'device';
  /** opaque name id: access points that share a network name share it (the name itself is never kept) */
  name?: string;
  /** antenna height (m) */
  h?: number;
  security?: Security; pmf?: 'none' | 'optional' | 'required';
  /** Wi-Fi generation as reported (Android: 4 = 802.11n, 5 = ac, 6 = ax, 8 = be) and channel width (MHz) */
  std?: number; bwMHz?: number;
  /** share of the time it is on air (phones come and go): heard at that share of the survey points where it would
   *  have been audible. A run draws once per network from its seed whether it is on air (tools/venue/build.ts) */
  onAir?: number;
  /** survey points it was heard at, and the fit's RMS error there (dB) */
  fit?: { points: number; rmseDb: number };
}

/**
 * printed artwork on a hoarding or a totem (generic, drawn by the renderer; no text or logos): 'pixel' purple with
 * stepped lilac squares, 'loading' magenta with a pixel progress bar, 'fascia' magenta header with white sign discs
 */
export type HallArt = 'pixel' | 'loading' | 'fascia';

/** what the renderer draws (engine frame, metres; colours as CSS hex) */
export interface VenuePlan {
  label: string;
  /** engine position of the plan's top-left corner; the plan's x runs east, its y south */
  origin: Vec2;
  size: [number, number];
  wallH: number;
  ceilingH: number;
  /** the hall's outline (engine frame) */
  outline: Vec2[];
  /** black pleated drapes down the hall's walls to this height (m), if any */
  drapeH?: number;
  floors: Array<{ poly: Vec2[]; color: string; y?: number; waves?: boolean }>;
  walls: Array<{ a: Vec2; b: Vec2; h: number; color: string; thick?: number; y?: number; emissive?: number; art?: HallArt; icon?: 'leaf' | 'bulb' }>;
  /** back-to-back stand panels: one panel each side, numbers in the circles */
  stands: Array<{ at: Vec2; rotDeg: number; nums: [string, string] }>;
  boxes: Array<{ at: Vec2; size: Vec3; rotDeg?: number; color: string; y?: number; emissive?: number; art?: HallArt }>;
  cylinders: Array<{ at: Vec2; r: number; h: number; color: string; y?: number; emissive?: number }>;
  domes: Array<{ at: Vec2; r: number; color: string }>;
  chairs: Array<{ at: Vec2; faceDeg: number; color?: string }>;
  stools: Vec2[];
  poufs: Array<{ at: Vec2; r: number; color: string }>;
  /** truss chords (engine frame, h = height) */
  trusses: Array<{ a: Vec3; b: Vec3 }>;
  /** LED screens; `round` ones are discs (w = diameter), `frame` ones carry a silver angular border */
  screens: Array<{ at: Vec2; y: number; w: number; h: number; faceDeg: number; color: string; round?: boolean; frame?: boolean }>;
  lights: Vec2[];
  labels: Array<{ at: Vec2; text: string; h?: number; ours?: boolean }>;
  people: Array<{ at: Vec2; face: number; act: string; walk?: { path: Vec2[]; speed: number; pause?: number } }>;
}

export interface VenueFile {
  kind: 'infinet-venue';
  v: 1;
  id: string;
  layout: {
    zones: Zone[]; regions: Region[]; buildings: Building[]; walls: Wall[]; transmitters: Transmitter[];
    routes: Record<string, Vec2[]>; visual: Record<string, { pos: Vec3; label?: string }>;
  };
  /** everyone else's networks, fitted to the survey: loss exponent, the survey phone's scan floor, the list */
  hotspots: { plExp: number; floorDbm: number; list: VenueHotspot[] };
  scenario: Scenario;
  plan: VenuePlan;
  /** where we measured, and what (engine frame): drawn as markers in Network Vision */
  survey: { date: string; points: Array<{ pos: Vec2; bestDbm: number; venueRadios: number; hotspots: number; devices?: number }> };
  /** every fitted number and where it came from */
  notes: string[];
}

export let VENUE: VenueFile | null = null;

export function hasVenue(): boolean { return VENUE !== null; }

export function registerVenue(f: VenueFile): void {
  if (VENUE || f?.kind !== 'infinet-venue' || f.v !== 1) return;
  VENUE = f;
  const L = f.layout;
  LAYOUT.zones.push(...L.zones);
  LAYOUT.regions.push(...L.regions);
  LAYOUT.buildings.push(...L.buildings);
  LAYOUT.walls.push(...L.walls);
  LAYOUT.transmitters.push(...L.transmitters);
  Object.assign(LAYOUT.routes, L.routes);
  Object.assign(LAYOUT.visual, L.visual);
  (SCENARIOS as Record<string, Scenario>)[f.scenario.id] = f.scenario;
}
