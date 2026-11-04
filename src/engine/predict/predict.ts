/**
 * Feature 1: Sees the drop coming (plan §9.6).
 * Forecast the trajectory (constant velocity, heading smoothed over 1.5 s), sample the BELIEF map along it,
 * and combine with a trend fit of measured RSSI. TTL = min(map, trend).
 */
import { v } from '../params';
import type { Vec2 } from '../types';
import type { RfGrid } from '../maps/rfmaps';

export interface TtlResult {
  ttlS?: number;
  ttlMapS?: number;
  ttlTrendS?: number;
  confidence: number;
  edgePoint?: Vec2;
  forecast: Vec2[];
  vel: Vec2;
}

export class Predictor {
  private pos: Array<{ t: number; p: Vec2 }> = [];
  private rssi: Array<{ t: number; r: number }> = [];

  observePos(t: number, p: Vec2) {
    this.pos.push({ t, p });
    while (this.pos.length && this.pos[0].t < t - v('headingSmoothS')) this.pos.shift();
  }
  observeRssi(t: number, r: number) {
    this.rssi.push({ t, r });
    while (this.rssi.length && this.rssi[0].t < t - v('trendWindowS')) this.rssi.shift();
  }
  clearRssi() { this.rssi = []; }

  velocity(): Vec2 {
    const n = this.pos.length;
    if (n < 3) return [0, 0];
    // least-squares slope of x(t), y(t)
    let st = 0, sx = 0, sy = 0, stt = 0, stx = 0, sty = 0;
    const t0 = this.pos[0].t;
    for (const { t, p } of this.pos) {
      const tt = t - t0;
      st += tt; sx += p[0]; sy += p[1]; stt += tt * tt; stx += tt * p[0]; sty += tt * p[1];
    }
    const den = n * stt - st * st;
    if (den < 1e-9) return [0, 0];
    return [(n * stx - st * sx) / den, (n * sty - st * sy) / den];
  }

  /**
   * @param grids belief grids (+EIRP) of the access points of the current network (ESS)
   */
  ttl(now: number, grids: Array<{ g: RfGrid; eirp: number }>, threshold: number): TtlResult {
    const last = this.pos[this.pos.length - 1];
    const vel = this.velocity();
    const forecast: Vec2[] = [];
    const H = v('forecastHorizonS');
    const step = 0.2;
    let ttlMap: number | undefined;
    let edge: Vec2 | undefined;
    const speed = Math.hypot(vel[0], vel[1]);
    if (last) {
      for (let k = 0; k <= H / step + 1e-9; k++) {
        const s = k * step;
        const p: Vec2 = [last.p[0] + vel[0] * s, last.p[1] + vel[1] * s];
        forecast.push(p);
        if (ttlMap === undefined && speed > 0.2) {
          let best = -Infinity;
          for (const { g, eirp } of grids) best = Math.max(best, g.sample(p) + eirp);
          if (best < threshold) { ttlMap = s; edge = p; }
        }
      }
    }
    // trend
    let ttlTrend: number | undefined;
    const n = this.rssi.length;
    if (n >= 10) {
      let st = 0, sr = 0, stt = 0, str = 0;
      const t0 = this.rssi[0].t;
      for (const { t, r } of this.rssi) { const tt = t - t0; st += tt; sr += r; stt += tt * tt; str += tt * r; }
      const den = n * stt - st * st;
      if (den > 1e-9) {
        const slope = (n * str - st * sr) / den;
        const icpt = (sr - slope * st) / n;
        const cur = icpt + slope * (now - t0);
        // a straight-line trend is only credible close to the threshold: from −56 dBm, fast fading alone
        // can fake a slope that "reaches" −75 dBm in 4 s (false heads-up while the map says strong)
        if (cur < threshold) ttlTrend = 0;
        else if (slope < -0.5 && cur < threshold + v('trendMaxGapDb')) ttlTrend = Math.min(H, (threshold - cur) / slope);
      }
    }
    const cands = [ttlMap, ttlTrend].filter((x): x is number => x !== undefined);
    const ttl = cands.length ? Math.min(...cands) : undefined;
    let confidence = 0.5;
    if (ttlMap !== undefined && ttlTrend !== undefined) confidence = 1 - Math.min(1, Math.abs(ttlMap - ttlTrend) / 4);
    else if (ttlMap !== undefined) confidence = 0.7;
    else if (ttlTrend !== undefined) confidence = 0.4;
    if (ttl !== undefined && !edge && last) edge = [last.p[0] + vel[0] * ttl, last.p[1] + vel[1] * ttl];
    return { ttlS: ttl, ttlMapS: ttlMap, ttlTrendS: ttlTrend, confidence, edgePoint: edge, forecast, vel };
  }
}
