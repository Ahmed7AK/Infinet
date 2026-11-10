/**
 * Truth propagation models.
 *  - Wi-Fi: log-distance + multi-wall (ITU-R P.1238 style), walls from layout.json (plan D9).
 *  - 5G: 3GPP TR 38.901 UMa / UMi / RMa NLOS path loss, 3GPP sector pattern, O2I penetration.
 * All coefficients in params.ts or cited inline with the TR 38.901 table they come from.
 */
import { v } from '../params';
import type { Vec2, Vec3 } from '../types';
import { LAYOUT, segmentsCross, buildingAt, distToPolyEdge, type Transmitter, type Wall } from '../world/layout';

const log10 = Math.log10;
const UE_PHONE_H = 1.2; // phone held in hand (m); ASSUMPTION

// ───────────────────────────── Wi-Fi ─────────────────────────────

export interface WallSet { walls: Wall[]; bbox: Float64Array }

export function wallSet(opts: { survey: boolean }): WallSet {
  const walls = LAYOUT.walls.filter((w) => !w.rfIgnore && !(opts.survey && w.addedAfterSurvey));
  const bbox = new Float64Array(walls.length * 4);
  walls.forEach((w, i) => {
    bbox[i * 4] = Math.min(w.a[0], w.b[0]);
    bbox[i * 4 + 1] = Math.min(w.a[1], w.b[1]);
    bbox[i * 4 + 2] = Math.max(w.a[0], w.b[0]);
    bbox[i * 4 + 3] = Math.max(w.a[1], w.b[1]);
  });
  return { walls, bbox };
}

/** Sum of wall losses crossed on the straight 2D path a→b. */
export function wallLossDb(a: Vec2, b: Vec2, ws: WallSet, crossed?: Wall[]): number {
  const losses = v('wallLossDb');
  const minx = Math.min(a[0], b[0]), maxx = Math.max(a[0], b[0]);
  const miny = Math.min(a[1], b[1]), maxy = Math.max(a[1], b[1]);
  let sum = 0;
  for (let i = 0; i < ws.walls.length; i++) {
    const o = i * 4;
    if (ws.bbox[o + 2] < minx || ws.bbox[o] > maxx || ws.bbox[o + 3] < miny || ws.bbox[o + 1] > maxy) continue;
    const w = ws.walls[i];
    if (segmentsCross(a, b, w.a, w.b)) {
      sum += losses[w.material] ?? 10;
      crossed?.push(w);
    }
  }
  return sum;
}

/** Wi-Fi path gain (dB, negative) excluding EIRP and shadowing. */
export function wifiPathGainDb(tx: { pos: Vec3; band?: string; plExp?: number }, p: Vec2, ws: WallSet, txPos?: Vec3): number {
  const pos = txPos ?? tx.pos;
  const dx = p[0] - pos[0], dy = p[1] - pos[1], dz = UE_PHONE_H - pos[2];
  const d = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
  const pl0 = tx.band === '2.4' ? v('wifiPl1m2GHz') : v('wifiPl1m5GHz');
  const pl = pl0 + 10 * (tx.plExp ?? v('wifiPathLossExp')) * log10(d) + wallLossDb([pos[0], pos[1]], p, ws);
  return -pl;
}

// ───────────────────────────── 5G NR ─────────────────────────────

/** 3GPP TR 38.901 Table 7.4.1-1 (UMa). fc in GHz, distances in m. NLOS assumed (ASSUMPTION, conservative). */
export function plUMa(d2D: number, hBS: number, hUT: number, fc: number): number {
  const d3D = Math.sqrt(d2D * d2D + (hBS - hUT) ** 2);
  const dBP = (4 * (hBS - 1) * (hUT - 1) * fc * 1e9) / 3e8; // hE = 1 m
  const plLos = d2D <= dBP
    ? 28.0 + 22 * log10(d3D) + 20 * log10(fc)
    : 28.0 + 40 * log10(d3D) + 20 * log10(fc) - 9 * log10(dBP * dBP + (hBS - hUT) ** 2);
  const plNlos = 13.54 + 39.08 * log10(d3D) + 20 * log10(fc) - 0.6 * (hUT - 1.5);
  return Math.max(plLos, plNlos);
}

/** 3GPP TR 38.901 Table 7.4.1-1 (UMi street canyon), NLOS. */
export function plUMi(d2D: number, hBS: number, hUT: number, fc: number): number {
  const d3D = Math.sqrt(d2D * d2D + (hBS - hUT) ** 2);
  const plLos = 32.4 + 21 * log10(d3D) + 20 * log10(fc);
  const plNlos = 35.3 * log10(d3D) + 22.4 + 21.3 * log10(fc) - 0.3 * (hUT - 1.5);
  return Math.max(plLos, plNlos);
}

/** 3GPP TR 38.901 Table 7.4.1-1 (RMa), NLOS, defaults W = 20 m street width, h = 5 m building height. */
export function plRMa(d2D: number, hBS: number, hUT: number, fc: number, W = 20, h = 5): number {
  const d3D = Math.sqrt(d2D * d2D + (hBS - hUT) ** 2);
  const plLos = 20 * log10((40 * Math.PI * d3D * fc) / 3) + Math.min(0.03 * h ** 1.72, 10) * log10(d3D)
    - Math.min(0.044 * h ** 1.72, 14.77) + 0.002 * log10(h) * d3D;
  const plNlos = 161.04 - 7.1 * log10(W) + 7.5 * log10(h) - (24.37 - 3.7 * (h / hBS) ** 2) * log10(hBS)
    + (43.42 - 3.1 * log10(hBS)) * (log10(d3D) - 3) + 20 * log10(fc) - (3.2 * log10(11.75 * hUT) ** 2 - 4.97);
  return Math.max(plLos, plNlos);
}

/** 3GPP TR 38.901 Table 7.3-1 element pattern, with our macro-panel HPBWs (params). Returns gain offset ≤ 0 dB. */
export function sectorPatternDb(offAzDeg: number, offElDeg: number): number {
  const a = ((offAzDeg + 540) % 360) - 180;
  const am = v('nrPatternMaxAttDb');
  const aH = -Math.min(12 * (a / v('nrHpbwHDeg')) ** 2, am);
  const aV = -Math.min(12 * (offElDeg / v('nrHpbwVDeg')) ** 2, v('nrSlaVDb'));
  return -Math.min(-(aH + aV), am);
}

/** 3GPP TR 38.901 §7.4.3.1 O2I building penetration loss through the external wall (dB). */
export function o2iWallLossDb(kind: 'high' | 'low', fc: number): number {
  const lConc = 5 + 4 * fc;
  if (kind === 'high') {
    const lIrr = 23 + 0.3 * fc;
    return 5 - 10 * log10(0.7 * 10 ** (-lIrr / 10) + 0.3 * 10 ** (-lConc / 10));
  }
  const lGlass = 2 + 0.2 * fc;
  return 5 - 10 * log10(0.3 * 10 ** (-lGlass / 10) + 0.7 * 10 ** (-lConc / 10));
}

export interface CellSample { rsrpDbm: number; o2iDb: number; sector: number; indoor: boolean }

/** Deterministic part of RSRP (no shadowing). */
export function cellRsrpDet(tx: Transmitter, p: Vec2): CellSample {
  const fc = tx.fcGHz ?? v('nrFcGHz');
  const hBS = tx.pos[2];
  const hUT = v('ueHeightM');
  const dx = p[0] - tx.pos[0], dy = p[1] - tx.pos[1];
  const d2D = Math.max(10, Math.sqrt(dx * dx + dy * dy)); // 38.901 validity: d2D ≥ 10 m
  const pl = tx.model === 'RMa' ? plRMa(d2D, hBS, hUT, fc) : tx.model === 'UMi' ? plUMi(d2D, hBS, hUT, fc) : plUMa(d2D, hBS, hUT, fc);
  const azToUe = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360; // bearing from north, clockwise
  const elBelow = (Math.atan2(hBS - hUT, d2D) * 180) / Math.PI;
  let best = -Infinity, bestS = 0;
  (tx.sectors ?? []).forEach((s, i) => {
    const g = sectorPatternDb(azToUe - s.azDeg, elBelow - s.downtiltDeg);
    if (g > best) { best = g; bestS = i; }
  });
  let o2i = 0;
  const b = buildingAt(p);
  if (b) o2i = o2iWallLossDb(b.o2i, fc) + v('o2iInsideDistCoef') * Math.min(25, distToPolyEdge(p, b.poly));
  const rsrp = v('nrPerRePowerDbm') + v('nrSectorGainDbi') + best - pl - o2i + (tx.rsrpOffsetDb ?? 0);
  return { rsrpDbm: rsrp, o2iDb: o2i, sector: bestS, indoor: !!b };
}

export function shadowSigmaCell(tx: Transmitter): number {
  return tx.model === 'RMa' ? v('rmaSigmaNlosDb') : tx.model === 'UMi' ? v('umiSigmaNlosDb') : v('umaSigmaNlosDb');
}

export function sinrDb(rsrpDbm: number, o2iDb: number): number {
  const n = 10 ** (v('nrNoisePerReDbm') / 10);
  const i = 10 ** ((v('nrInterferencePerReDbm') - o2iDb) / 10);
  return rsrpDbm - 10 * log10(n + i);
}
