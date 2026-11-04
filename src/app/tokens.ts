/**
 * Simulation colour system (plan §7.1). Technology by hue, strength by lightness/opacity, thresholds by
 * contour lines. Never colour alone: icons and words back it up. (The brand style guide is not used for
 * the simulation; see DECISIONS.md.)
 */
export const tech = {
  wifi: '#4DA3FF',
  cell: '#34D399',
  sat: '#A78BFA',
  wired: '#F2E8D5',
  tunnel: '#67E8F9',
  check: '#FBBF24',
  threat: '#F87171',
  ok: '#4ADE80',
} as const;

/** UI surfaces: dark glass over a realistic world */
export const ui = {
  glass: 'rgba(14, 17, 24, 0.72)',
  glassStrong: 'rgba(12, 14, 20, 0.88)',
  line: 'rgba(255, 255, 255, 0.10)',
  text: '#F2F4F7',
  mute: '#A3ABB8',
  dim: '#6B7380',
} as const;

export type Tier = 'checking' | 'trusted' | 'pipe' | 'blocked' | 'unchecked';
export const badge: Record<Tier, { icon: string; word: string; color: string }> = {
  trusted: { icon: '✓', word: 'Trusted', color: tech.ok },
  pipe: { icon: '~', word: 'Pipe only', color: tech.check },
  blocked: { icon: '✕', word: 'Blocked', color: tech.threat },
  checking: { icon: '…', word: 'Checking', color: tech.check },
  unchecked: { icon: '·', word: 'Not checked', color: ui.mute },
};

/** Design thresholds drawn as contours (plan P2) */
export const THRESH = { wifiVoice: -67, wifiData: -75, cellEdge: -100 } as const;

/** Engine frame (x east, y north) → three.js (x, up, −y). */
export const W = (x: number, y: number, h = 0): [number, number, number] => [x, h, -y];

/** Typographic minus and units on every number (plan P7) */
export const fmtDb = (x: number | undefined, unit = 'dBm') => (x === undefined || !Number.isFinite(x) ? '—' : `${x < 0 ? '−' : ''}${Math.abs(Math.round(x))} ${unit}`);
export const fmtMs = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? '—' : `${Math.round(x)} ms`);
export const fmtS = (x: number | undefined, dp = 1) => (x === undefined || !Number.isFinite(x) ? '—' : `${x.toFixed(dp)} s`);
export const fmtPct = (x: number | undefined, dp = 1) => (x === undefined || !Number.isFinite(x) ? '—' : `${x.toFixed(dp)} %`);
export const minus = (s: string) => s.replace(/-/g, '−');

/** friendly names for network ids (never real operator or venue names) */
export const NET_NAME: Record<string, string> = {
  'office-corp': 'Office-Corp', 'cafe-guest': 'Cafe_Guest', twin: 'Cafe_Guest (copy)', 'site-net': 'Site-Net',
  'cell-a': 'Cellular A · 5G', 'cell-b': 'Cellular B · 5G',
};
export const pathName = (p?: string | null) => {
  if (!p) return '—';
  const [k, n] = p.split(':');
  if (k === 'cell') return n === 'cell-b' ? '5G (Cellular B)' : '5G (Cellular A)';
  return ({ 'office-corp': 'Office Wi-Fi', 'cafe-guest': 'Café Wi-Fi', twin: 'Café Wi-Fi (copy)', 'site-net': 'Site Wi-Fi' } as Record<string, string>)[n] ?? n;
};
