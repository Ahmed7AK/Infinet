/**
 * ITU-T G.107 E-model (simplified, Cole & Rosenbluth form) with G.113 codec values.
 *   R   = R0 − Id − Ie_eff
 *   Id  = 0.024·d + 0.11·(d − 177.3)·H(d − 177.3)          d = mouth-to-ear delay (ms)
 *   Ie_eff = Ie + (95 − Ie)·Ppl / (Ppl/BurstR + Bpl)          Ppl in %
 *   MOS = 1 + 0.035R + 7e-6·R(R − 60)(100 − R), clamped to [1, 4.5]
 */
import { v } from '../params';

export function delayImpairment(dMs: number): number {
  return 0.024 * dMs + (dMs > 177.3 ? 0.11 * (dMs - 177.3) : 0);
}

export function ieEff(pplPct: number, burstR = 1, ie = v('g711PlcIe'), bpl = v('g711PlcBpl')): number {
  return ie + ((95 - ie) * pplPct) / (pplPct / burstR + bpl);
}

export function rFactor(mouthToEarMs: number, pplPct: number, burstR = 1): number {
  return v('emodelR0') - delayImpairment(mouthToEarMs) - ieEff(pplPct, burstR);
}

export function mosFromR(r: number): number {
  if (r <= 0) return 1;
  if (r >= 100) return 4.5;
  return 1 + 0.035 * r + 7e-6 * r * (r - 60) * (100 - r);
}

export function mos(mouthToEarMs: number, pplPct: number, burstR = 1): number {
  return mosFromR(rFactor(mouthToEarMs, pplPct, burstR));
}
