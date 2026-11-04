/**
 * What the phone can observe (plan P5). Policies only ever see this, never the truth maps.
 *  - Wi-Fi scan list: SSID, BSSID, channel, security, PMF, measured RSSI (truth + fast fading)
 *  - Cellular measurements: RSRP / SINR (truth + fast fading)
 *  - Its own position estimate (truth + a slowly varying error; ASSUMPTION σ ≈ 1.5 m)
 */
import { v } from '../params';
import { Rng } from '../rng';
import type { ScanEntry, Vec2 } from '../types';

export interface CellMeas { net: string; rsrpDbm: number; sinrDb: number; attached: boolean }

export interface Observations {
  t: number;
  scan: ScanEntry[];
  byBssid: Map<string, ScanEntry>;
  cell: Map<string, CellMeas>;
  pos: Vec2;
  /** when each BSSID was first seen in this area (phone-side memory) */
  firstSeen: Map<string, number>;
}

export class FastFading {
  private state = new Map<string, number>();
  private rng: Rng;
  constructor(seed: number) { this.rng = Rng.named(seed, 'fastfade'); }
  /** AR(1) with ρ = 0.7 per 100 ms tick, σ from params. Deterministic given tick order. */
  next(key: string, sigma = v('wifiFastFadeSigmaDb')): number {
    const rho = 0.7;
    const prev = this.state.get(key) ?? 0;
    const x = rho * prev + Math.sqrt(1 - rho * rho) * this.rng.gauss();
    this.state.set(key, x);
    return sigma * x;
  }
}

/**
 * ASSUMPTION: the phone fuses Wi-Fi/GNSS positioning with step detection (pedestrian dead reckoning),
 * so its position error is ≈1.5 m but varies slowly (periods of 20–45 s): heading and speed stay usable.
 */
export class PositionEstimate {
  private comps: Array<{ ax: number; ay: number; w: number; px: number; py: number }> = [];
  private t = 0;
  constructor(seed: number) {
    const rng = Rng.named(seed, 'posest');
    for (let i = 0; i < 3; i++) {
      this.comps.push({ ax: rng.uniform(0.4, 1.0), ay: rng.uniform(0.4, 1.0), w: (2 * Math.PI) / rng.uniform(20, 45), px: rng.uniform(0, 6.283), py: rng.uniform(0, 6.283) });
    }
  }
  next(truth: Vec2): Vec2 {
    this.t += v('radioTickS');
    let ex = 0, ey = 0;
    for (const c of this.comps) { ex += c.ax * Math.sin(c.w * this.t + c.px); ey += c.ay * Math.sin(c.w * this.t + c.py); }
    return [truth[0] + ex, truth[1] + ey];
  }
}
