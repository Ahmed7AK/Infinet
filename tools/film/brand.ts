/// <reference lib="dom" />
/// <reference types="vite/client" />
/**
 * The brand system for the film (Infinet style guide v1.1, Nov 2026): colours, fonts, the edge cut and the master
 * logo artwork. Used by the film cards (cards.html) and the overlay on the 3D footage (overlay.ts). Film only: the
 * simulation keeps its own realistic look (DECISIONS.md D3).
 *
 * The logo SVGs in ./brand are the master artwork taken from the style guide PDF (page 5, "On Night"): the mark's
 * cells are its own rectangles, the wordmark is its own Chakra Petch Bold glyphs at the guide's positions. Never retyped.
 */
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/ibm-plex-sans/300.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import lockupNight from './brand/lockup-night.svg?raw';
import lockupPlain from './brand/lockup-plain.svg?raw';
import markWhite from './brand/mark-white.svg?raw';

export const LOGO = { lockupNight, lockupPlain, markWhite };

/** style guide p22 build tokens */
export const C = {
  night: '#0A0B14', night2: '#151827', night3: '#23273A',
  violet: '#730FFF', cyan: '#00EBFF', orange: '#FF5A3C',
  steel: '#5C6272', haze: '#E9EBF0', white: '#FFFFFF',
  /** text on Night: secondary (the guide's "unchecked" icon grey) and Infinet's light violet ("tunnel only" icon) */
  mute: '#9AA0B4', violetLt: '#C9B3FF',
} as const;

/** signal bins on Night (p22): lowest dBm for each colour */
export const SIGNAL_BINS: Array<[number, string]> = [[-55, C.cyan], [-62, C.violet], [-68, '#560EBD'], [-73, '#3C0D85'], [-77, '#2A0C5A'], [-Infinity, C.orange]];

export const CSS = `
:root {
  --b-night: ${C.night}; --b-night2: ${C.night2}; --b-night3: ${C.night3}; --b-violet: ${C.violet}; --b-cyan: ${C.cyan};
  --b-orange: ${C.orange}; --b-steel: ${C.steel}; --b-haze: ${C.haze}; --b-white: #fff; --b-mute: ${C.mute}; --b-violetLt: ${C.violetLt};
  --b-display: 'Chakra Petch', Arial, sans-serif; --b-text: 'IBM Plex Sans', Arial, system-ui, sans-serif;
  --b-arabic: 'IBM Plex Sans Arabic', 'IBM Plex Sans', sans-serif; --b-data: 'IBM Plex Mono', Menlo, Consolas, monospace;
}
/* the edge cut (p13): 45°, c = short side ÷ 8. Cards and panels: top-left + bottom-right. Chips: top-left only. */
.b-cut2 { clip-path: polygon(var(--b-c, 16px) 0, 100% 0, 100% calc(100% - var(--b-c, 16px)), calc(100% - var(--b-c, 16px)) 100%, 0 100%, 0 var(--b-c, 16px)); }
.b-cut1 { clip-path: polygon(var(--b-c, 8px) 0, 100% 0, 100% 100%, 0 100%, 0 var(--b-c, 8px)); }
/* labels (p12): Chakra 600, caps, +160 tracking, never more than four words */
.b-label { font: 600 15px/1 var(--b-display); letter-spacing: 0.16em; text-transform: uppercase; }
/* honesty tags (p17) */
.b-tag { display: inline-flex; align-items: center; gap: 9px; font: 500 15px/1 var(--b-data); letter-spacing: 0.14em; text-transform: uppercase; padding: 8px 12px; }
.b-tag::before { content: ''; width: 9px; height: 9px; background: currentColor; }
.b-tag.b-sim { color: var(--b-cyan); outline: 1.5px dashed var(--b-cyan); outline-offset: -1.5px; }
.b-tag.b-sim::before { background: none; outline: 1.5px solid var(--b-cyan); outline-offset: -1.5px; }
.b-tag.b-built { color: #fff; outline: 1.5px solid #fff; outline-offset: -1.5px; }
.b-tag.b-next { color: var(--b-mute); outline: 1.5px dotted var(--b-mute); outline-offset: -1.5px; }
.b-tag.b-next::before { background: none; outline: 1.5px solid var(--b-mute); outline-offset: -1.5px; }
/* readouts (p12): value in Plex Mono, unit at half size, one space */
.b-ro { font: 500 1em/1 var(--b-data); white-space: nowrap; }
.b-ro small { font-size: 0.5em; margin-left: 0.25em; }
/* states (p10): always an icon and a word */
.b-state { display: inline-flex; align-items: center; gap: 9px; font: 600 15px/1 var(--b-display); letter-spacing: 0.14em; text-transform: uppercase; padding: 9px 12px 9px 11px; white-space: nowrap; }
.b-state i { width: 10px; height: 10px; flex: none; background: currentColor; }
.b-state.b-live { background: var(--b-cyan); color: var(--b-night); }
.b-state.b-handover { background: var(--b-night); color: var(--b-violetLt); outline: 2px dashed var(--b-violet); outline-offset: -2px; }
.b-state.b-frozen { background: var(--b-orange); color: var(--b-night); }
.b-state.b-blocked { background: var(--b-orange); color: var(--b-night); }
.b-state.b-trusted { background: var(--b-violet); color: #fff; }
.b-state.b-tunnel { background: var(--b-night); color: var(--b-violetLt); outline: 2px solid var(--b-violet); outline-offset: -2px; }
.b-state.b-checking { background: var(--b-night); color: var(--b-cyan); outline: 2px solid var(--b-cyan); outline-offset: -2px; }
.b-state.b-unchecked { background: var(--b-night3); color: #9AA0B4; }
.b-logo svg { display: block; width: 100%; height: auto; }
`;

export function injectCss(css = CSS) {
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
}

/** wait for the brand fonts (they load lazily from the CSS above) */
export async function fontsReady() {
  const want = ['600 20px "Chakra Petch"', '700 20px "Chakra Petch"', '400 20px "IBM Plex Sans"', '500 20px "IBM Plex Sans"',
    '600 20px "IBM Plex Sans"', '500 20px "IBM Plex Mono"', '400 20px "IBM Plex Mono"', '600 20px "IBM Plex Sans Arabic"'];
  await Promise.all(want.map((f) => document.fonts.load(f, f.includes('Arabic') ? 'نفحص' : 'Aa 0.1 s')));
  await document.fonts.ready;
}

export const clamp = (x: number) => Math.max(0, Math.min(1, x));
/** ease out (cubic) */
export const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
/** ease in-out (smoothstep) */
export const ease2 = (x: number) => { const u = clamp(x); return u * u * (3 - 2 * u); };
/** 0 → 1 between a and b (eased) */
export const span = (t: number, a: number, b: number, f = ease) => f((t - a) / (b - a));
/** a one-decimal readout with the unit at half size */
export const ro = (v: string, unit: string) => `<span class="b-ro">${v}<small>${unit}</small></span>`;
/** deterministic hash noise in [0, 1) */
export const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
