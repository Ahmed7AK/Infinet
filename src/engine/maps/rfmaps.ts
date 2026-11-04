/**
 * Truth map and belief map (plan P6: belief is not truth).
 *
 * truthMap  = deterministic propagation (current layout) + correlated shadowing.
 * beliefMap = propagation as surveyed (old layout / old AP positions when the map is stale)
 *             + the same shadowing (the survey measured it) + a smooth map-error field.
 * Infinet's prediction reads ONLY the belief map plus its own measurements.
 */
import { v } from '../params';
import type { Vec2 } from '../types';
import { LAYOUT, type Transmitter } from '../world/layout';
import { correlatedField } from '../fields/shadow';
import { cellRsrpDet, shadowSigmaCell, wallSet, wifiPathGainDb, type WallSet } from '../radio/propagation';
import { buildingAt } from '../world/layout';

export class RfGrid {
  constructor(
    public x0: number, public y0: number, public res: number,
    public nx: number, public ny: number, public data: Float32Array,
  ) {}
  static empty(tx: Transmitter): RfGrid {
    const [[x0, y0], [x1, y1]] = tx.grid.bounds;
    const res = tx.grid.res;
    const nx = Math.round((x1 - x0) / res) + 1;
    const ny = Math.round((y1 - y0) / res) + 1;
    return new RfGrid(x0, y0, res, nx, ny, new Float32Array(nx * ny));
  }
  contains(p: Vec2): boolean {
    return p[0] >= this.x0 && p[1] >= this.y0 && p[0] <= this.x0 + (this.nx - 1) * this.res && p[1] <= this.y0 + (this.ny - 1) * this.res;
  }
  /** Bilinear sample; `outside` when out of bounds. */
  sample(p: Vec2, outside = -200): number {
    const fx = (p[0] - this.x0) / this.res, fy = (p[1] - this.y0) / this.res;
    if (fx < 0 || fy < 0 || fx > this.nx - 1 || fy > this.ny - 1) return outside;
    const i = Math.min(this.nx - 2, Math.floor(fx)), j = Math.min(this.ny - 2, Math.floor(fy));
    const tx = fx - i, ty = fy - j;
    const d = this.data, n = this.nx;
    const a = d[j * n + i], b = d[j * n + i + 1], c = d[(j + 1) * n + i], e = d[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
  }
  add(other: Float32Array, k: number): RfGrid {
    const out = new Float32Array(this.data.length);
    for (let i = 0; i < out.length; i++) out[i] = this.data[i] + k * other[i];
    return new RfGrid(this.x0, this.y0, this.res, this.nx, this.ny, out);
  }
  map(fn: (val: number, idx: number) => number): RfGrid {
    const out = new Float32Array(this.data.length);
    for (let i = 0; i < out.length; i++) out[i] = fn(this.data[i], i);
    return new RfGrid(this.x0, this.y0, this.res, this.nx, this.ny, out);
  }
}

// ───────────── deterministic caches (shared across runs) ─────────────
const detCache = new Map<string, RfGrid>();
const o2iCache = new Map<string, Float32Array>();
const indoorCache = new Map<string, Uint8Array>();
let truthWalls: WallSet | null = null;
let surveyWalls: WallSet | null = null;

function walls(survey: boolean): WallSet {
  if (survey) return (surveyWalls ??= wallSet({ survey: true }));
  return (truthWalls ??= wallSet({ survey: false }));
}

/** Wi-Fi path gain grid (no EIRP, no shadowing). variant: 'truth' | 'survey' | 'survey-moved'. */
export function detWifi(tx: Transmitter, variant: 'truth' | 'survey' | 'survey-moved'): RfGrid {
  const key = `${tx.id}:${variant}`;
  const hit = detCache.get(key);
  if (hit) return hit;
  const g = RfGrid.empty(tx);
  const ws = walls(variant !== 'truth');
  const pos = variant === 'survey-moved' && tx.surveyPos ? tx.surveyPos : tx.pos;
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++)
      g.data[j * g.nx + i] = wifiPathGainDb(tx, [g.x0 + i * g.res, g.y0 + j * g.res], ws, pos);
  diffractionBlur(g, 0.5, ws);
  detCache.set(key, g);
  return g;
}

/**
 * The straight-ray multi-wall model gives razor-sharp shadow edges at door frames and wall ends.
 * Real edges are softened by diffraction over roughly the first Fresnel zone (≈0.4 m at 5 GHz, 10 m).
 * ASSUMPTION: wall-aware Gaussian blur in the linear power domain, σ = 0.5 m. A neighbour only
 * contributes if no wall lies between the two cells, so façades stay sharp and only free-space
 * beam edges (e.g. the beam leaking out of a doorway) are softened.
 */
function touches(px: number, py: number, qx: number, qy: number, ax: number, ay: number, bx: number, by: number): boolean {
  const d1x = qx - px, d1y = qy - py, d2x = bx - ax, d2y = by - ay;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const ex = ax - px, ey = ay - py;
  const t = (ex * d2y - ey * d2x) / den;
  const u = (ex * d1y - ey * d1x) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9;
}

function diffractionBlur(g: RfGrid, sigmaM: number, ws: WallSet) {
  const r = Math.max(1, Math.round((2 * sigmaM) / g.res));
  const w: number[] = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-0.5 * ((k * g.res) / sigmaM) ** 2));
  const n = g.nx, m = g.ny;
  const lin = new Float64Array(n * m);
  for (let i = 0; i < lin.length; i++) lin[i] = 10 ** (g.data[i] / 10);
  // Inclusive test: a grid point lying exactly on a wall line counts as blocked from both sides.
  const blocked = (i0: number, j0: number, i1: number, j1: number) => {
    const ax = g.x0 + i0 * g.res, ay = g.y0 + j0 * g.res, bx = g.x0 + i1 * g.res, by = g.y0 + j1 * g.res;
    for (const wl of ws.walls) if (touches(ax, ay, bx, by, wl.a[0], wl.a[1], wl.b[0], wl.b[1])) return true;
    return false;
  };
  const pass = (src: Float64Array, horizontal: boolean) => {
    const out = new Float64Array(n * m);
    for (let j = 0; j < m; j++)
      for (let i = 0; i < n; i++) {
        let s = 0, wsum = 0;
        for (let k = -r; k <= r; k++) {
          const ii = horizontal ? i + k : i, jj = horizontal ? j : j + k;
          if (ii < 0 || jj < 0 || ii >= n || jj >= m) continue;
          if (k !== 0 && blocked(i, j, ii, jj)) continue;
          s += w[k + r] * src[jj * n + ii];
          wsum += w[k + r];
        }
        out[j * n + i] = s / wsum;
      }
    return out;
  };
  const res = pass(pass(lin, true), false);
  for (let i = 0; i < res.length; i++) g.data[i] = 10 * Math.log10(Math.max(res[i], 1e-30));
}

export function detCell(tx: Transmitter): { rsrp: RfGrid; o2i: Float32Array; indoor: Uint8Array } {
  const hit = detCache.get(`${tx.id}:cell`);
  if (hit) return { rsrp: hit, o2i: o2iCache.get(tx.id)!, indoor: indoorCache.get(tx.id)! };
  const g = RfGrid.empty(tx);
  const o2i = new Float32Array(g.data.length);
  const indoor = new Uint8Array(g.data.length);
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const s = cellRsrpDet(tx, [g.x0 + i * g.res, g.y0 + j * g.res]);
      g.data[j * g.nx + i] = s.rsrpDbm;
      o2i[j * g.nx + i] = s.o2iDb;
      indoor[j * g.nx + i] = s.indoor ? 1 : 0;
    }
  detCache.set(`${tx.id}:cell`, g);
  o2iCache.set(tx.id, o2i);
  indoorCache.set(tx.id, indoor);
  return { rsrp: g, o2i, indoor };
}

// ───────────── per-run maps ─────────────

export interface TxMaps {
  tx: Transmitter;
  /** truth: Wi-Fi path gain incl. shadowing (add EIRP) | cell RSRP incl. shadowing */
  truth: RfGrid;
  /** belief (Infinet's coverage map); null for networks not in the survey (e.g. the attacker) */
  belief: RfGrid | null;
  o2i?: RfGrid;
}

export interface MapSet {
  byTx: Map<string, TxMaps>;
  staleness: number;
  mapSigmaDb: number;
}

export function buildMaps(seed: number, staleness: number): MapSet {
  const byTx = new Map<string, TxMaps>();
  const mapSigma = 2 + 8 * staleness; // ASSUMPTION: σ_map 2 dB fresh → 10 dB fully stale (Lab slider)
  for (const tx of LAYOUT.transmitters) {
    const spec = { nx: 0, ny: 0, res: tx.grid.res, corrM: 0 };
    if (tx.kind === 'wifi') {
      const det = detWifi(tx, 'truth');
      spec.nx = det.nx; spec.ny = det.ny; spec.corrM = v('wifiShadowCorrM');
      const sh = correlatedField(seed, `shadow:${tx.id}`, spec);
      const truth = det.add(sh, v('wifiShadowSigmaDb'));
      let belief: RfGrid | null = null;
      if (!tx.attacker) {
        const variant = staleness >= 0.4 && tx.surveyPos ? 'survey-moved' : staleness >= 0.7 ? 'survey' : 'truth';
        const surveyDet = variant === 'truth' ? det : detWifi(tx, variant);
        const err = correlatedField(seed, `maperr:${tx.id}`, spec);
        const withShadow = surveyDet.add(sh, v('wifiShadowSigmaDb'));
        belief = withShadow.add(err, mapSigma);
      }
      byTx.set(tx.id, { tx, truth, belief });
    } else {
      const { rsrp, o2i, indoor } = detCell(tx);
      spec.nx = rsrp.nx; spec.ny = rsrp.ny; spec.corrM = v('outdoorShadowCorrM');
      const shOut = correlatedField(seed, `shadow:${tx.id}`, spec);
      const shIn = correlatedField(seed, `o2i:${tx.id}`, { ...spec, corrM: v('wifiShadowCorrM') });
      const sigma = shadowSigmaCell(tx);
      const sigIn = v('o2iHighLossSigmaDb');
      const truth = rsrp.map((val, i) => val + sigma * shOut[i] + (indoor[i] ? sigIn * shIn[i] : 0));
      const err = correlatedField(seed, `maperr:${tx.id}`, spec);
      const belief = truth.add(err, mapSigma);
      const o2iGrid = new RfGrid(rsrp.x0, rsrp.y0, rsrp.res, rsrp.nx, rsrp.ny, o2i);
      byTx.set(tx.id, { tx, truth, belief, o2i: o2iGrid });
    }
  }
  return { byTx, staleness, mapSigmaDb: mapSigma };
}

/** Fallback for points outside a cell grid (rare): direct deterministic computation. */
export function cellTruthAt(m: TxMaps, p: Vec2): { rsrp: number; o2i: number } {
  if (m.truth.contains(p)) return { rsrp: m.truth.sample(p), o2i: m.o2i ? m.o2i.sample(p, 0) : 0 };
  const s = cellRsrpDet(m.tx, p);
  return { rsrp: s.rsrpDbm, o2i: s.o2iDb };
}

export function isIndoor(p: Vec2): boolean {
  return !!buildingAt(p);
}
