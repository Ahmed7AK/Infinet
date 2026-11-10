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

export type { Tier } from '../engine/types';
import type { Tier } from '../engine/types';
import { mobileWord } from '../engine/policies/agent';
/** verdict badges (Security spec §2): icon + word + colour, never colour alone */
export const badge: Record<Tier, { icon: string; word: string; color: string }> = {
  trusted: { icon: '✓', word: 'Trusted', color: tech.ok },
  tunnel: { icon: '◇', word: 'Tunnel only', color: tech.tunnel },
  unreachable: { icon: '○', word: 'Unreachable', color: ui.mute },
  blocked: { icon: '✕', word: 'Blocked', color: tech.threat },
  checking: { icon: '…', word: 'Checking', color: tech.check },
  unchecked: { icon: '·', word: 'Not checked', color: ui.dim },
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
/** Wi-Fi generation from Android's reported standard (WifiAnnotations: 4 = 802.11n, 5 = ac, 6 = ax, 7 = ad, 8 = be) */
export const wifiGen = (std?: number) => (std === undefined ? '' : ({ 1: 'Wi-Fi 1–3', 4: 'Wi-Fi 4', 5: 'Wi-Fi 5', 6: 'Wi-Fi 6', 7: '802.11ad', 8: 'Wi-Fi 7' } as Record<number, string>)[std] ?? '');
/** what an anonymous network is, from its address alone (never its name) */
export const ANON_KIND: Record<string, string> = { hotspot: 'Phone hotspot', device: 'Fixed device', 'venue-other': 'Venue access point' };
/** one line of facts about a network (band, channel, width, security, generation); empty parts dropped */
export const netFacts = (e: { band?: string; channel?: number; bwMHz?: number; security?: string; std?: number }, sec: Record<string, string>) =>
  [e.band ? `${e.band} GHz ch ${e.channel ?? '—'}${e.bwMHz && e.bwMHz > 20 ? ` · ${e.bwMHz} MHz` : ''}` : '', e.security ? sec[e.security] ?? e.security : '', wifiGen(e.std)].filter(Boolean).join(' · ');

/** friendly names for network ids (never real operator or venue names) */
export const NET_NAME: Record<string, string> = {
  'office-corp': 'Office-Corp', 'cafe-guest': 'Cafe_Guest', twin: 'Cafe_Guest (copy)', 'site-net': 'Site-Net', 'site-twin': 'Site-Net (copy)',
  'cell-a': 'Cellular A · 5G', 'cell-b': 'Cellular B · 5G', 'venue-free': 'Venue-Free-WiFi',
};
// the mobile word follows the scene (4G in the hall, where we measured LTE): read it when drawing, never at import
Object.defineProperty(NET_NAME, 'cell-a', { get: () => `Cellular A · ${mobileWord()}`, enumerable: true });
Object.defineProperty(NET_NAME, 'cell-b', { get: () => `Cellular B · ${mobileWord()}`, enumerable: true });
export const pathName = (p?: string | null) => {
  if (!p) return '—';
  const [k, n] = p.split(':');
  if (k === 'cell') return `${mobileWord()} (Cellular ${n === 'cell-b' ? 'B' : 'A'})`;
  return ({ 'office-corp': 'Office Wi-Fi', 'cafe-guest': 'Café Wi-Fi', twin: 'Café Wi-Fi (copy)', 'site-net': 'Site Wi-Fi', 'site-twin': 'Site Wi-Fi (copy)', flood: 'Fake beacon', 'venue-free': 'Venue Wi-Fi' } as Record<string, string>)[n] ?? n;
};
