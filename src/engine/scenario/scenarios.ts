import buildingExit from '../../scenarios/building-exit.json';
import cafeTwin from '../../scenarios/cafe-twin.json';
import desertSat from '../../scenarios/desert-sat.json';
import type { ScenarioId, Vec2, ZoneId } from '../types';
import { AREA_SCENARIOS } from '../world/areas';
import { LAYOUT } from '../world/layout';

export interface ScenarioEvent { when: { enterRegion?: string; at?: number }; delayS?: number; do: 'attacker.start' | 'leo.outage' }
export interface Caption { at?: number; on?: string; /** only when the event's destination path starts with this */ to?: string; text: string }
export interface Scenario {
  id: ScenarioId;
  label: string;
  proves: string;
  zone: ZoneId;
  route: string;
  durationS: number;
  prewarmS: number;
  startDelayS: number;
  defaultBaseline: 'b1' | 'b2' | 'b3';
  init: { route: string; wifi: string | null; infinetTrusted: string[] };
  events: ScenarioEvent[];
  captions: Caption[];
}

/** the venue scene ('venue-hall') is added by registerVenue (world/venue.ts) when the private venue file exists */
export const SCENARIOS = {
  'building-exit': buildingExit as Scenario,
  'cafe-twin': cafeTwin as Scenario,
  'desert-sat': desertSat as Scenario,
} as Record<Exclude<ScenarioId, 'free'>, Scenario>;

// the walks through the four places added on 11 Nov (world/areas.ts); the batch still runs the three scenes below
for (const s of AREA_SCENARIOS) (SCENARIOS as Record<string, Scenario>)[s.id] = s;

export const MUST_SCENARIOS: Array<Exclude<ScenarioId, 'free'>> = ['building-exit', 'cafe-twin', 'desert-sat'];

/** A walking route along the layout polyline at a given speed (deterministic). */
export class RouteFollower {
  readonly pts: Vec2[];
  private cum: number[] = [0];
  constructor(pts: Vec2[], public speed: number, public startT = 0) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  get length() { return this.cum[this.cum.length - 1]; }
  at(t: number): { pos: Vec2; vel: Vec2; headingDeg: number; done: boolean } {
    const s = Math.max(0, (t - this.startT) * this.speed);
    const L = this.length;
    const done = s >= L;
    const ss = Math.min(s, L);
    let i = 1;
    while (i < this.pts.length - 1 && this.cum[i] < ss) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const f = (ss - this.cum[i - 1]) / seg;
    const dx = (b[0] - a[0]) / seg, dy = (b[1] - a[1]) / seg;
    const moving = t >= this.startT && !done;
    return {
      pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
      vel: moving ? [dx * this.speed, dy * this.speed] : [0, 0],
      headingDeg: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360,
      done,
    };
  }
}

export function routeFor(s: Scenario, speed: number): RouteFollower {
  return new RouteFollower(LAYOUT.routes[s.route], speed, s.prewarmS + s.startDelayS);
}
