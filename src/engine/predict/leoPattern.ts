/**
 * Learns the LEO reconfiguration period from measured RTT (trap #10): it is not hard-coded.
 * Input: relative one-way transit of every voice frame (RFC 3550-style; no clock sync needed), 50 per second.
 * Autocorrelation of a per-100 ms spike indicator over lags 5–30 s; period refined by a least-squares fit
 * of spike-event times; phase from the circular mean of spike times.
 */
import { v } from '../params';

export class LeoLearner {
  private samples: Array<{ t: number; rtt: number }> = [];
  periodS?: number;
  confidence = 0;
  phaseS?: number;
  private lastFit = -Infinity;
  announced = false;

  reset() {
    this.samples = [];
    this.periodS = undefined;
    this.confidence = 0;
    this.phaseS = undefined;
    this.announced = false;
  }

  observe(t: number, rtt: number) {
    this.samples.push({ t, rtt });
    while (this.samples.length && this.samples[0].t < t - 90) this.samples.shift();
  }

  /** Re-fit about once per second. Returns true when a period is (newly) confident. */
  fit(t: number): boolean {
    if (t - this.lastFit < 1) return false;
    this.lastFit = t;
    if (this.samples.length < 50) return false;
    const span = t - this.samples[0].t;
    if (span < v('leoLearnMinS')) return false;
    // resample to 10 Hz bins
    const dt = 0.1;
    const t0 = this.samples[0].t;
    const n = Math.floor(span / dt);
    const x = new Float64Array(n);
    const finite = this.samples.filter((s) => Number.isFinite(s.rtt)).map((s) => s.rtt).sort((a, b) => a - b);
    if (finite.length < 20) return false;
    const med = finite[Math.floor(finite.length / 2)];
    const iqr = finite[Math.floor(finite.length * 0.75)] - finite[Math.floor(finite.length * 0.25)];
    const thr = med + Math.max(15, 2 * iqr);
    // per 100 ms bin: median transit (lost frames count as very late). A bin is a "spike" if its median is high.
    const bins: number[][] = Array.from({ length: n }, () => []);
    for (const s of this.samples) {
      const i = Math.floor((s.t - t0) / dt);
      if (i >= 0 && i < n) bins[i].push(Number.isFinite(s.rtt) ? s.rtt : 1e6);
    }
    for (let i = 0; i < n; i++) {
      const b = bins[i];
      if (b.length < 2) continue;
      b.sort((p, q) => p - q);
      x[i] = b[Math.floor(b.length / 2)] > thr ? 1 : 0;
    }
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[i];
    mean /= n;
    let var0 = 0;
    for (let i = 0; i < n; i++) var0 += (x[i] - mean) ** 2;
    if (var0 < 1e-9) return false;
    let bestLag = 0, best = -1;
    for (let lag = 50; lag <= Math.min(300, n - 50); lag++) {
      let c = 0;
      for (let i = 0; i + lag < n; i++) c += (x[i] - mean) * (x[i + lag] - mean);
      c /= var0 * ((n - lag) / n);
      if (c > best) { best = c; bestLag = lag; }
    }
    // prefer the fundamental: if half the lag scores nearly as well, take it
    const half = Math.round(bestLag / 2);
    if (half >= 50) {
      let c = 0;
      for (let i = 0; i + half < n; i++) c += (x[i] - mean) * (x[i + half] - mean);
      c /= var0 * ((n - half) / n);
      if (c > 0.8 * best) { best = c; bestLag = half; }
    }
    this.confidence = Math.max(0, best);
    if (best < v('leoLearnConfidence')) return false;
    let P = bestLag * dt;
    // refine with a least-squares fit of spike-event times against their cycle index
    const evts: number[] = [];
    let lastEv = -Infinity;
    for (let i = 0; i < n; i++) if (x[i] > 0.5) { const tt = t0 + i * dt; if (tt - lastEv > 1.5) evts.push(tt); lastEv = tt; }
    if (evts.length >= 3) {
      // keep events that sit on the comb implied by the autocorrelation lag (drops false spikes)
      const P0 = P;
      const anchor = evts[0];
      const onComb = evts.filter((e) => { const k = Math.round((e - anchor) / P0); return Math.abs(e - anchor - k * P0) < 1.0; });
      evts.length = 0; evts.push(...onComb);
    }
    if (evts.length >= 3) {
      const ks = evts.map((e) => Math.round((e - evts[0]) / P));
      const m = ks.length;
      const mk = ks.reduce((a, b) => a + b, 0) / m, me = evts.reduce((a, b) => a + b, 0) / m;
      let num = 0, den = 0;
      for (let i = 0; i < m; i++) { num += (ks[i] - mk) * (evts[i] - me); den += (ks[i] - mk) ** 2; }
      if (den > 0) { const ref = num / den; if (Math.abs(ref - P) < 0.15 * P) P = ref; }
    }
    // phase: circular mean of spike bins
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) if (x[i] > 0.5) {
      const a = (2 * Math.PI * ((t0 + i * dt) % P)) / P;
      sx += Math.cos(a) * x[i]; sy += Math.sin(a) * x[i];
    }
    const ang = Math.atan2(sy, sx);
    this.phaseS = (((ang / (2 * Math.PI)) * P) % P + P) % P;
    const newly = this.periodS === undefined;
    this.periodS = P;
    return newly;
  }

  nextSpike(t: number): number | undefined {
    if (this.periodS === undefined || this.phaseS === undefined) return undefined;
    const P = this.periodS;
    let k = Math.floor((t - this.phaseS) / P);
    let s = this.phaseS + k * P;
    while (s + v('leoGuardAfterMs') / 1000 < t) { k++; s = this.phaseS + k * P; }
    return s;
  }

  protecting(t: number): boolean {
    const s = this.nextSpike(t);
    if (s === undefined) return false;
    return t >= s - v('leoGuardBeforeMs') / 1000 && t <= s + v('leoGuardAfterMs') / 1000;
  }
}
