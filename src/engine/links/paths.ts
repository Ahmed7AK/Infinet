/**
 * Paths = the whole route a voice packet takes, not just the radio hop (plan P3).
 *   wifi:<net>  radio → backhaul (fibre / café DSL / satellite uplink) → internet [→ anchor detour]
 *   cell:<net>  radio → operator core → internet [→ anchor detour]
 *
 * Truth characteristics are recomputed every radio tick from the truth maps. Packet outcomes use
 * common random numbers keyed by (seed, path, frame seq) so every policy faces identical luck.
 */
import { v } from '../params';
import { crn, expFromUniform, hashString, Rng } from '../rng';
import type { Hop, LabState } from '../types';

export interface PathTruth {
  id: string;
  kind: 'wifi' | 'cell';
  label: string;
  up: boolean;           // radio reachable at all
  owdMs: number;         // one-way, excluding anchor detour
  jitterMs: number;      // mean of exponential jitter
  loss: number;          // probability
  hops: Hop[];
  rssiDbm?: number;
  snrDb?: number;
  rsrpDbm?: number;
  sinrDb?: number;
  ipEpoch: number;       // public IP identity; changes break non-tunnel sessions
  uplink?: 'LEO' | 'GEO' | 'none';
  attacker?: boolean;
  captivePortal?: boolean;
  /** the network drops UDP (common in hotels and offices): a WireGuard-style probe gets no answer */
  udpBlocked?: boolean;
  security?: string;
}

export const logistic = (x: number) => 1 / (1 + Math.exp(-x));

export function wifiLossFromSnr(snr: number): number {
  return Math.min(1, v('wifiBaseLoss') + logistic((v('wifiPer50SnrDb') - snr) / v('wifiPerSlopeDb')));
}
export function wifiRetryDelayMs(snr: number): number {
  return v('wifiRetryOwdMs') * logistic((v('wifiPer50SnrDb') + 6 - snr) / 2);
}
export function nrLossFromSinr(sinr: number): number {
  return Math.min(1, v('nrBaseLoss') + logistic((v('nrLoss50SinrDb') - sinr) / v('nrLossSlopeDb')));
}

// ───────────────────────────── Satellite uplinks ─────────────────────────────

export interface LeoWindow { k: number; t0: number; t1: number; extraMs: number; loss: number; sameSat: boolean }

export class SatelliteState {
  readonly leoRttMs: number;
  readonly geoRttMs: number;
  readonly phaseS: number;
  readonly failoverS: number;
  uplink: 'LEO' | 'GEO' | 'none' = 'LEO';
  ipEpoch = 0;
  outageAt: number | null = null;
  failoverAt: number | null = null;
  private seed: number;
  satIndex = 0;
  private lastK = -1;

  constructor(seed: number) {
    this.seed = seed;
    const r = Rng.named(seed, 'sat');
    this.leoRttMs = r.uniform(v('leoRttMinMs'), v('leoRttMaxMs'));
    this.geoRttMs = r.uniform(v('geoRttMinMs'), v('geoRttMaxMs'));
    this.phaseS = r.uniform(0, v('leoPeriodS'));
    this.failoverS = r.uniform(v('routerFailoverMinS'), v('routerFailoverMaxS'));
  }

  /** The reconfiguration window k (globally scheduled, random phase per run). */
  window(k: number): LeoWindow {
    const P = v('leoPeriodS');
    const h = hashString('leo');
    const t0 = this.phaseS + k * P;
    const w = v('leoSpikeWinMinMs') + crn(this.seed, h, k, 1) * (v('leoSpikeWinMaxMs') - v('leoSpikeWinMinMs'));
    return {
      k, t0, t1: t0 + w / 1000,
      extraMs: v('leoSpikeExtraMinMs') + crn(this.seed, h, k, 2) * (v('leoSpikeExtraMaxMs') - v('leoSpikeExtraMinMs')),
      loss: v('leoSpikeLossMin') + crn(this.seed, h, k, 3) * (v('leoSpikeLossMax') - v('leoSpikeLossMin')),
      sameSat: crn(this.seed, h, k, 4) < 0.35, // trap #10: spikes also occur on the same satellite
    };
  }
  windowAt(t: number): LeoWindow | null {
    const P = v('leoPeriodS');
    const k = Math.floor((t - this.phaseS) / P);
    if (k < 0) return null;
    const w = this.window(k);
    return t >= w.t0 && t < w.t1 ? w : null;
  }
  boundaryPhase(t: number): number {
    const P = v('leoPeriodS');
    return (((t - this.phaseS) % P) + P) % P / P;
  }

  update(t: number, lab: LabState, emit: (e: any) => void) {
    // LEO satellite index for the visual beam (re-points at each boundary, sometimes to the same satellite)
    const k = Math.floor((t - this.phaseS) / v('leoPeriodS'));
    if (k !== this.lastK && k >= 0) {
      if (this.lastK >= 0 && !this.window(k).sameSat) this.satIndex++;
      this.lastK = k;
    }
    const wantLeo = lab.satPrimary === 'LEO' && !lab.leoOutage;
    if (lab.satPrimary === 'GEO' && this.uplink !== 'GEO' && this.outageAt === null) {
      this.uplink = 'GEO'; this.ipEpoch++;
    }
    if (lab.satPrimary === 'LEO' && lab.leoOutage && this.outageAt === null) {
      this.outageAt = t;
      this.uplink = 'none';
      emit({ t, type: 'sat.outage' });
    }
    if (this.outageAt !== null && this.uplink === 'none' && t >= this.outageAt + this.failoverS) {
      this.uplink = 'GEO';
      this.ipEpoch++;
      this.failoverAt = t;
      emit({ t, type: 'sat.failover', to: 'GEO', rttMs: Math.round(this.geoRttMs) });
    }
    if (wantLeo && this.uplink !== 'LEO') {
      // restore: router fails back to the primary
      this.uplink = 'LEO';
      this.ipEpoch++;
      this.outageAt = null;
      this.failoverAt = null;
      emit({ t, type: 'sat.failover', to: 'LEO', rttMs: Math.round(this.leoRttMs) });
    }
  }

  /** One-way uplink characteristics now. */
  uplinkNow(t: number): { owdMs: number; jitterMs: number; loss: number; spike: boolean } {
    if (this.uplink === 'none') return { owdMs: 0, jitterMs: 0, loss: 1, spike: false };
    if (this.uplink === 'GEO') return { owdMs: this.geoRttMs / 2, jitterMs: v('geoJitterMs'), loss: v('geoBaseLoss'), spike: false };
    const w = this.windowAt(t);
    const base = this.leoRttMs / 2;
    if (w) return { owdMs: base + w.extraMs, jitterMs: v('leoJitterMs'), loss: v('leoBaseLoss') + w.loss, spike: true };
    return { owdMs: base, jitterMs: v('leoJitterMs'), loss: v('leoBaseLoss'), spike: false };
  }
}

// ───────────────────────────── Packet sampling ─────────────────────────────

export interface PacketOutcome { lost: boolean; delayMs: number }

const pathHashCache = new Map<string, number>();
export function pathHash(id: string): number {
  let h = pathHashCache.get(id);
  if (h === undefined) { h = hashString(id); pathHashCache.set(id, h); }
  return h;
}

/** Common-random-number packet outcome on a path for frame `seq`. */
export function samplePacket(seed: number, path: PathTruth, seq: number, tunnel: boolean, salt = 0): PacketOutcome {
  const h = pathHash(path.id);
  const u1 = crn(seed, h, seq, 11 + salt);
  const u2 = crn(seed, h, seq, 12 + salt);
  if (!path.up || u1 < path.loss) return { lost: true, delayMs: Infinity };
  const delay = path.owdMs + (tunnel ? v('anchorDetourMs') : 0) + expFromUniform(u2, path.jitterMs);
  return { lost: false, delayMs: delay };
}

/** Probe round trip on a path (common random numbers per 100 ms slot). */
export function sampleProbeRtt(seed: number, path: PathTruth, slot: number, tunnel: boolean): number {
  const h = pathHash(path.id);
  const u1 = crn(seed, h, slot, 21);
  if (!path.up || u1 < path.loss * 1.6 /* two directions ≈ */) return Infinity;
  const owd = path.owdMs + (tunnel ? v('anchorDetourMs') : 0);
  return 2 * owd + expFromUniform(crn(seed, h, slot, 22), path.jitterMs) + expFromUniform(crn(seed, h, slot, 23), path.jitterMs);
}

export function rttOf(p: PathTruth, tunnel: boolean): number {
  return 2 * (p.owdMs + (tunnel ? v('anchorDetourMs') : 0));
}
