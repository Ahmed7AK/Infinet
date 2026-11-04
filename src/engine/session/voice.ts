/**
 * Voice receiver (the phone's side: what the player hears), adaptive jitter buffer, PLC,
 * frozen detection, E-model MOS, and the lane recorder for the comparison strip.
 */
import { v } from '../params';
import type { LaneSegment, LaneState, LiveMetrics } from '../types';
import { mos } from './emodel';

export type FrameOutcome = 'played' | 'concealed' | 'silent';

interface Pending { seq: number; sendT: number; playT: number; arr: number; p: number }

export class Receiver {
  /** playout offset: send → playout (ms), includes network delay + buffer */
  P = 80;
  private delays: Array<{ t: number; d: number }> = [];
  private jit = 4;
  private lateBoost = 0;
  stretchMs = 0;
  private pending: Pending[] = [];
  consecMiss = 0;
  outcomes: Array<{ t: number; o: FrameOutcome; late: boolean; d: number }> = [];

  // accumulators
  frames = 0;
  notPlayed = 0;
  lateFrames = 0;
  frozenS = 0;
  longestFrozenS = 0;
  frozenCount = 0;
  private runFrames = 0;
  dropped = false;
  mosSum = 0;
  mosN = 0;
  minMos5 = 4.5;
  lastFrozenRunStart = -1;
  onFrozenStart?: (t: number) => void;
  onFrozenEnd?: (t: number, ms: number) => void;
  onDropped?: (t: number) => void;

  reset(initialOwdMs: number) {
    this.P = initialOwdMs + v('jbTargetMs');
  }

  push(seq: number, sendT: number, arr: number) {
    this.pending.push({ seq, sendT, playT: sendT + this.P / 1000, arr, p: this.P });
  }

  /** RFC 2198-style redundancy: packet n also carries frame n−1. */
  redundant(seq: number, arr: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const f = this.pending[i];
      if (f.seq === seq) { if (arr < f.arr) f.arr = arr; return; }
      if (f.seq < seq) return;
    }
  }

  /** Reveal frames whose playout time has come. Returns outcomes revealed. */
  reveal(t: number, record = true): Array<{ seq: number; o: FrameOutcome; late: boolean }> {
    const out: Array<{ seq: number; o: FrameOutcome; late: boolean }> = [];
    const frameS = v('frameS');
    const minRun = Math.round(v('frozenMinMs') / (frameS * 1000));
    while (this.pending.length && this.pending[0].playT <= t) {
      const f = this.pending.shift()!;
      const ok = f.arr <= f.playT;
      const late = !ok && f.arr < Infinity;
      if (f.arr < Infinity) this.observeDelay(f.sendT, (f.arr - f.sendT) * 1000, late);
      let o: FrameOutcome;
      if (ok) {
        o = 'played';
        if (this.runFrames >= minRun) {
          const ms = this.runFrames * frameS * 1000;
          this.onFrozenEnd?.(f.playT, ms);
        }
        this.runFrames = 0;
        this.consecMiss = 0;
      } else {
        this.consecMiss++;
        this.runFrames++;
        o = this.consecMiss <= v('plcMaxFrames') ? 'concealed' : 'silent';
        if (this.runFrames === minRun) {
          this.frozenCount++;
          this.frozenS += minRun * frameS;
          this.lastFrozenRunStart = f.playT - (minRun - 1) * frameS;
          this.onFrozenStart?.(this.lastFrozenRunStart);
        } else if (this.runFrames > minRun) {
          this.frozenS += frameS;
        }
        const runS = this.runFrames * frameS;
        if (runS > this.longestFrozenS && this.runFrames >= minRun) this.longestFrozenS = runS;
        if (!this.dropped && runS >= v('callDropS')) { this.dropped = true; this.onDropped?.(f.playT); }
      }
      if (record) {
        this.frames++;
        if (!ok) this.notPlayed++;
        if (late) this.lateFrames++;
        this.outcomes.push({ t: f.playT, o, late, d: f.p });
      }
      out.push({ seq: f.seq, o, late });
      this.adaptPlayout();
    }
    // keep 5 s of outcomes for the MOS window
    const keep = t - v('mosWindowS');
    let drop = 0;
    while (drop < this.outcomes.length && this.outcomes[drop].t < keep) drop++;
    if (drop > 0) this.outcomes.splice(0, drop);
    return out;
  }

  private observeDelay(t: number, d: number, late: boolean) {
    this.delays.push({ t, d });
    while (this.delays.length && this.delays[0].t < t - 2) this.delays.shift();
    const base = this.baseDelay();
    this.jit += (Math.abs(d - base) - this.jit) / 16; // RFC 3550-style smoothing
    if (late) this.lateBoost = Math.min(this.lateBoost + 20, 100);
  }

  private baseDelay(): number {
    let m = Infinity;
    for (const x of this.delays) if (x.d < m) m = x.d;
    return m === Infinity ? this.P - v('jbTargetMs') : m;
  }

  private adaptPlayout() {
    const buffer = Math.min(v('jbMaxMs'), Math.max(v('jbMinMs'), 2.5 * this.jit + 30 + this.lateBoost)) + this.stretchMs;
    const target = this.baseDelay() + buffer;
    const diff = target - this.P;
    // grow by time-stretching up to 10 ms per frame; shrink gently (2 ms per frame)
    this.P += diff > 0 ? Math.min(diff, 10) : Math.max(diff, -2);
    this.lateBoost = Math.max(0, this.lateBoost - 0.5);
  }

  /** Live MOS over the last 5 s window. */
  windowMos(): { mos: number; pplPct: number; m2eMs: number } {
    const n = this.outcomes.length;
    if (!n) return { mos: 4.4, pplPct: 0, m2eMs: this.mouthToEar() };
    let miss = 0, dsum = 0, dn = 0;
    for (const o of this.outcomes) {
      if (o.o !== 'played') miss++;
      else { dsum += o.d; dn++; }
    }
    const ppl = (100 * miss) / n;
    const m2e = v('codecDelayMs') + v('farEndOwdMs') + (dn ? dsum / dn : this.P);
    return { mos: mos(m2e, ppl), pplPct: ppl, m2eMs: m2e };
  }

  mouthToEar(): number {
    return v('codecDelayMs') + v('farEndOwdMs') + this.P;
  }

  sampleMos() {
    const w = this.windowMos();
    this.mosSum += w.mos;
    this.mosN++;
    if (this.frames > 250 && w.mos < this.minMos5) this.minMos5 = w.mos;
    return w;
  }
}

export class LaneRecorder {
  segments: LaneSegment[] = [];
  private cur: LaneSegment | null = null;
  constructor(private keepS = 120) {}

  update(t: number, state: LaneState, net: string, checked: boolean) {
    const c = this.cur;
    if (c && c.state === state && c.net === net && c.checked === checked) { c.t1 = t; return; }
    if (c) c.t1 = t;
    this.cur = { t0: t, t1: t, state, net, checked };
    this.segments.push(this.cur);
    const cut = t - this.keepS;
    while (this.segments.length > 1 && this.segments[0].t1 < cut) this.segments.shift();
  }

  /** Mark [t0, now] as frozen retroactively (the run is only known after 200 ms). */
  retroFrozen(t0: number, net: string, checked: boolean, state: LaneState = 'frozen') {
    const c = this.cur;
    if (!c) return;
    if (c.t0 >= t0) { c.state = state; c.net = net; c.checked = checked; return; }
    const now = c.t1;
    c.t1 = t0;
    this.cur = { t0, t1: now, state, net, checked };
    this.segments.push(this.cur);
  }
}

export function emptyMetrics(): LiveMetrics {
  return { frozenS: 0, longestFrozenS: 0, frozenCount: 0, voiceLostPct: 0, mos: 4.4, mosMean: 4.4, callDropped: false, fakeAdmissions: 0, dupExtraPct: 0 };
}
