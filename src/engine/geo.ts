/**
 * Satellite geometry. Trap #13: the GEO dish must point where the maths says.
 */
import { v } from './params';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface LookAngle { azDeg: number; elDeg: number; rangeKm: number }

/**
 * Standard GEO look-angle formula (spherical Earth).
 * Al Ain (24.2°N, 55.7°E) → 52.5°E gives ≈188° azimuth, ≈61° elevation (unit-tested).
 */
export function geoLookAngle(latDeg: number, lonDeg: number, satLonDeg: number): LookAngle {
  const re = v('earthRadiusKm');
  const rs = re + v('geoAltitudeKm');
  const lat = latDeg * D2R;
  const dLon = (satLonDeg - lonDeg) * D2R;
  const cosGamma = Math.cos(lat) * Math.cos(dLon);
  const gamma = Math.acos(cosGamma);
  const sinGamma = Math.sin(gamma);
  const el = Math.atan2(cosGamma - re / rs, sinGamma);
  // Azimuth from north, clockwise.
  const a = Math.atan2(Math.tan(Math.abs(dLon)), Math.sin(Math.abs(lat))) * R2D;
  let az: number;
  const north = latDeg >= 0;
  const satEast = dLon > 0;
  if (north) az = satEast ? 180 - a : 180 + a;
  else az = satEast ? a : 360 - a;
  const rangeKm = Math.sqrt(re * re + rs * rs - 2 * re * rs * cosGamma);
  return { azDeg: az, elDeg: el * R2D, rangeKm };
}

/** One-way propagation delay ground → GEO satellite → ground (bent pipe), ms. */
export function geoBentPipeOneWayMs(rangeUserKm: number, rangeGatewayKm = rangeUserKm): number {
  return ((rangeUserKm + rangeGatewayKm) / 299792.458) * 1000;
}

/**
 * Visual-only LEO pass helper: a satellite crossing the sky on a great-circle-ish arc.
 * Returns az/el for a pass parameterised by phase ∈ [0,1].
 */
export function leoPassAzEl(phase: number, passAzDeg: number, maxElDeg: number): { azDeg: number; elDeg: number } {
  const ph = Math.min(1, Math.max(0, phase));
  const el = Math.sin(ph * Math.PI) * maxElDeg;
  const az = (passAzDeg + (ph < 0.5 ? 0 : 180)) % 360;
  return { azDeg: az, elDeg: Math.max(5, el) };
}
