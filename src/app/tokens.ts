/** infinet-tokens.ts — the style guide's build tokens (p. 22). Same values in tokens.css. */
export const color = {
  night: '#0A0B14', night2: '#151827', night3: '#23273A',
  violet: '#730FFF', cyan: '#00EBFF', orange: '#FF5A3C',
  steel: '#5C6272', haze: '#E9EBF0', white: '#FFFFFF',
} as const;

/** coverage cells on Night: lowest dBm for each bin */
export const signalBins: Array<[number, string]> = [
  [-55, color.cyan], [-62, color.violet], [-68, '#560EBD'],
  [-73, '#3C0D85'], [-77, '#2A0C5A'], [-Infinity, color.orange],
];
/** Orange marks only the edge: cells weaker than this are not drawn at all. */
export const EDGE_FLOOR_DBM = -80;

export type NetStateKey = 'checking' | 'trusted' | 'tunnel' | 'blocked' | 'unchecked';
export const netState: Record<NetStateKey, { fill: string; line: string | null; icon: string; word: string }> = {
  checking: { fill: color.night, line: color.cyan, icon: color.cyan, word: 'CHECKING' },
  trusted: { fill: color.violet, line: null, icon: color.white, word: 'TRUSTED' },
  tunnel: { fill: color.night, line: color.violet, icon: '#C9B3FF', word: 'TUNNEL ONLY' },
  blocked: { fill: color.orange, line: null, icon: color.night, word: 'BLOCKED' },
  unchecked: { fill: color.night3, line: null, icon: '#9AA0B4', word: 'NOT CHECKED' },
};

export const font = { display: 'Chakra Petch', text: 'IBM Plex Sans', arabic: 'IBM Plex Sans Arabic', data: 'IBM Plex Mono' };

export function binColor(dbm: number): string {
  for (const [lo, c] of signalBins) if (dbm >= lo) return c;
  return color.orange;
}

/** Engine frame (x east, y north) → three.js (x, up, −y). */
export const W = (x: number, y: number, h = 0): [number, number, number] => [x, h, -y];

/** Typographic minus and units */
export const fmtDb = (x: number | undefined, unit = 'dBm') => (x === undefined || !Number.isFinite(x) ? '—' : `${x < 0 ? '−' : ''}${Math.abs(Math.round(x))} ${unit}`);
export const fmtMs = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? '—' : `${Math.round(x)} ms`);
export const fmtS = (x: number | undefined, dp = 1) => (x === undefined || !Number.isFinite(x) ? '—' : `${x.toFixed(dp)} s`);
export const fmtPct = (x: number | undefined, dp = 1) => (x === undefined || !Number.isFinite(x) ? '—' : `${x.toFixed(dp)}%`);
export const minus = (s: string) => s.replace(/-/g, '−');
