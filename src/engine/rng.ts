/**
 * Seeded randomness. Determinism rule (plan §0.2.4): same seed + same inputs → same outputs.
 *
 * Two flavours:
 *  - `Rng`: a sequential mulberry32 stream, split by name so adding a draw in one subsystem
 *    never shifts another subsystem's numbers.
 *  - `crn(seed, ...keys)`: a stateless hash → uniform [0,1). Used for "common random numbers":
 *    the channel luck of path P at frame N is identical for every policy (plan §9.1).
 */

export function hashString(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** murmur3-style finaliser. */
function mix32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Stateless uniform in [0,1) from integer keys. */
export function crn(...keys: number[]): number {
  let h = 0x9e3779b9;
  for (const k of keys) h = mix32((h ^ (k >>> 0)) + 0x7f4a7c15 + ((k / 4294967296) | 0));
  return mix32(h) / 4294967296;
}

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x12345678;
  }
  static named(seed: number, name: string): Rng {
    return new Rng(mix32(seed ^ hashString(name)));
  }
  next(): number {
    // mulberry32
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, bInclusive: number): number {
    return a + Math.floor(this.next() * (bInclusive - a + 1));
  }
  gauss(): number {
    return gaussFromUniforms(this.next(), this.next());
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

export function gaussFromUniforms(u1: number, u2: number): number {
  const a = Math.max(u1, 1e-12);
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u2);
}

/** Exponential with the given mean, from one uniform. */
export function expFromUniform(u: number, mean: number): number {
  return -Math.log(1 - Math.min(u, 1 - 1e-12)) * mean;
}
