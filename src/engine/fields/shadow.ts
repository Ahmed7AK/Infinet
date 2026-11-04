/**
 * Spatially correlated shadowing (plan P8).
 * Separable first-order autoregressive filter along x then y gives a unit-variance Gaussian field
 * with exponential autocorrelation exp(−|Δx|/d)·exp(−|Δy|/d), the Gudmundson model's shape.
 */
import { Rng, hashString } from '../rng';

export interface FieldSpec { nx: number; ny: number; res: number; corrM: number }

export function correlatedField(seed: number, key: string, spec: FieldSpec): Float32Array {
  const { nx, ny, res, corrM } = spec;
  const rng = Rng.named(seed, `field:${key}`);
  const a = Math.exp(-res / corrM);
  const b = Math.sqrt(1 - a * a);
  const f = new Float32Array(nx * ny);
  // pass 1: AR(1) along x, independent per row
  for (let j = 0; j < ny; j++) {
    let x = rng.gauss();
    f[j * nx] = x;
    for (let i = 1; i < nx; i++) {
      x = a * x + b * rng.gauss();
      f[j * nx + i] = x;
    }
  }
  // pass 2: AR(1) along y on the row-correlated field
  for (let i = 0; i < nx; i++) {
    let y = f[i];
    for (let j = 1; j < ny; j++) {
      y = a * y + b * f[j * nx + i];
      f[j * nx + i] = y;
    }
  }
  return f;
}

export const fieldKey = (...parts: (string | number)[]) => parts.join('|');
export const keyHash = (s: string) => hashString(s);
