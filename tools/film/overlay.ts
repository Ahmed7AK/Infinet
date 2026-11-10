/// <reference lib="dom" />
/// <reference types="vite/client" />
/**
 * The film's overlay on the 3D footage (tools/record/film.ts injects it into the app page, served by Vite dev).
 * Style guide v1.1: a 64 px top bar with the lockup, the scene and the Simulated tag on every frame from the world
 * (p18, p25); chapter cards (p25); "Today's phone" left in Steel, Infinet right in Violet, same rows (p18); states as
 * an icon and a word (p10); captions burned in. Everything it shows about the two phones is read from the running
 * simulation (driver.snap) at that frame. The app's own HUD is hidden while filming; its in-world labels stay, set in
 * the brand's fonts and square corners.
 */
import { C, CSS, LOGO, clamp, ease, ease2, fontsReady, hash, injectCss, ro, span } from './brand';

type Cap = { a: number; b: number; k: string; t: string };
export type Setup = {
  /** 'data': top bar, both phones and captions · 'clean': top bar and captions only */
  hud: 'data' | 'clean';
  top: { n: string; title: string; sub: string };
  chapter?: { a: number; b: number; n: string; title: string; sub: string; ar?: string };
  caps: Cap[];
  /** when the data panels slide in / out (s into the shot) */
  panels?: [number, number];
  /** when the trust card may show (s into the shot): the network Infinet is checking or has just decided on */
  trust?: [number, number];
};

const FILM_CSS = `
${CSS}
.stage, .hints, .jump, .banner, .caption, .help, .perf, .attract { display: none !important; }
/* the app's in-world labels in the brand's type, square corners */
:root { --sans: 'IBM Plex Sans', system-ui, sans-serif; --mono: 'IBM Plex Mono', monospace; }
.ntag, .atag, .holo, .edgetag, .youtag, .zlabel, .livetag, .badge { border-radius: 0 !important; }
.holo, .ntag, .youtag, .edgetag { backdrop-filter: none !important; box-shadow: none !important; }
.holo { background: rgba(10, 11, 20, 0.92) !important; }
.holo { display: none !important; } /* the film draws the trust card itself, large (p18) */
.zlabel { font-family: 'Chakra Petch', sans-serif !important; }
#film { position: fixed; inset: 0; z-index: 9999; pointer-events: none; font-family: var(--b-text); color: #fff; }
#film .fm-top { position: absolute; left: 0; right: 0; top: 0; height: 64px; background: var(--b-night); display: flex; align-items: center; padding: 0 48px; gap: 26px; }
#film .fm-top .b-logo { width: 156px; flex: none; }
#film .fm-top .fm-div { width: 1px; height: 28px; background: var(--b-steel); }
#film .fm-top .fm-scene { display: flex; align-items: baseline; gap: 18px; }
#film .fm-top .fm-scene .b-label { font-size: 17px; }
#film .fm-top .fm-scene .fm-sub { font: 400 17px/1 var(--b-text); color: var(--b-mute); }
#film .fm-top .fm-sp { flex: 1; }
#film .fm-chap { position: absolute; left: 0; top: 64px; bottom: 0; width: 760px; }
#film .fm-chap .fm-bg { position: absolute; inset: 0; background: var(--b-night); }
#film .fm-chap .fm-in { position: absolute; left: 96px; top: 290px; width: 600px; }
#film .fm-chap .fm-no { font: 500 24px/1 var(--b-data); color: var(--b-mute); margin: 34px 0 22px; letter-spacing: 0.04em; }
#film .fm-chap h1 { font: 700 96px/1.0 var(--b-display); margin: 0; letter-spacing: -0.005em; }
#film .fm-chap .fm-sub { font: 400 30px/1.35 var(--b-text); color: var(--b-mute); margin-top: 26px; }
#film .fm-chap .fm-ar { font: 600 38px/1.4 var(--b-arabic); color: #fff; direction: rtl; text-align: right; margin-top: 18px; }
#film .fm-chap .fm-cells { position: absolute; inset: 0; }
#film .fm-chap .fm-cells i { position: absolute; width: 22px; height: 22px; }
#film .fm-cap { position: absolute; bottom: 48px; background: var(--b-night); --b-c: 14px; padding: 20px 28px 22px; }
#film .fm-cap.fm-clean { left: 48px; width: 1000px; }
#film .fm-cap.fm-data { left: 50%; width: 944px; margin-left: -472px; }
#film .fm-cap .b-label { display: flex; align-items: center; gap: 12px; font-size: 18px; margin-bottom: 12px; }
#film .fm-cap .b-label i { width: 12px; height: 12px; background: var(--b-violet); }
#film .fm-cap .fm-t { font: 500 28px/1.36 var(--b-text); }
#film .fm-ph { position: absolute; bottom: 48px; width: 416px; background: var(--b-night); --b-c: 16px; padding: 20px 22px 18px; }
#film .fm-ph.fm-l { left: 48px; } #film .fm-ph.fm-r { right: 48px; }
#film .fm-ph .fm-row1 { display: flex; justify-content: space-between; align-items: center; }
#film .fm-ph .fm-who { font: 700 24px/1 var(--b-display); }
#film .fm-ph.fm-r .fm-who { color: var(--b-violetLt); }
#film .fm-ph .fm-what { font: 400 17px/1 var(--b-text); color: var(--b-mute); margin-top: 8px; }
#film .fm-ph .fm-net { font: 500 20px/1.2 var(--b-text); margin-top: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#film .fm-ph .fm-net b { font-weight: 500; color: var(--b-mute); }
#film .fm-ph .fm-lane { position: relative; height: 12px; margin-top: 14px; background: var(--b-night3); overflow: hidden; }
#film .fm-ph .fm-lane i { position: absolute; top: 0; bottom: 0; }
#film .fm-ph .fm-row3 { display: flex; justify-content: space-between; align-items: baseline; margin-top: 14px; }
#film .fm-ph .fm-row3 .b-label { font-size: 14px; color: var(--b-mute); }
#film .fm-ph .fm-row3 .b-ro { font-size: 40px; }
#film .fm-tc { position: absolute; right: 48px; bottom: 270px; width: 416px; background: var(--b-night); --b-c: 16px; padding: 20px 22px 20px; }
#film .fm-tc .b-label { font-size: 15px; color: var(--b-mute); }
#film .fm-tc .fm-nm { font: 700 28px/1.1 var(--b-display); margin: 10px 0 14px; }
#film .fm-tc li { list-style: none; display: flex; gap: 12px; font: 400 19px/1.35 var(--b-text); padding: 4px 0; }
#film .fm-tc li i { flex: none; width: 18px; font: 600 19px/1.35 var(--b-data); font-style: normal; text-align: center; }
#film .fm-tc li.fm-bad i { color: var(--b-orange); } #film .fm-tc li.fm-good i { color: #fff; } #film .fm-tc li.fm-wait { color: var(--b-mute); } #film .fm-tc li.fm-wait i { color: var(--b-cyan); }
#film .fm-tc ul { padding: 0; margin: 0; }
#film .fm-tc .fm-ft { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--b-night3); }
#film .fm-tc .fm-mc { font: 500 15px/1.3 var(--b-data); letter-spacing: 0.08em; text-transform: uppercase; color: var(--b-mute); max-width: 200px; }
`;

const BASE: Record<string, [string, string]> = {
  b1: ["Today's phone", 'switches after the drop'],
  b2: ['Strongest signal', 'joins whatever is loudest'],
  b3: ['Tunnel, no check', 'keeps the call, trusts every network'],
};
const STATE: Record<string, [string, string]> = {
  live: ['live', 'Call live'], handover: ['handover', 'Handing over'], frozen: ['frozen', 'Call frozen'], dropped: ['frozen', 'Call dropped'],
};

type Lane = { t0: number; t1: number; state: string; net: string; checked: boolean };
type Pol = { callState: string; activeLabel: string; checked: boolean; metrics: { frozenS: number }; laneSegments: Lane[] };
type TV = { bssid: string; net: string; tier: string; firstSeenT: number; decidedT?: number; follows?: string; mayCarry: string; steps: Array<{ text: string; ok: boolean | null }> };
type Snap = { t: number; lab: { baseline: string }; policies: Record<string, Pol>; infinet: { trust: Record<string, TV> } };
/** what the network is (the film shows the truth: the copy is named as a copy) */
const NET: Record<string, string> = { twin: 'Café Wi-Fi (copy)', 'cafe-guest': 'Café Wi-Fi', 'venue-free': 'Venue Wi-Fi', 'site-twin': 'Site Wi-Fi (copy)', 'site-net': 'Site Wi-Fi', 'office-corp': 'Office Wi-Fi' };
const TIER: Record<string, [string, string]> = {
  blocked: ['blocked', 'Blocked'], trusted: ['trusted', 'Trusted'], tunnel: ['tunnel', 'Tunnel only'], checking: ['checking', 'Checking'],
  unreachable: ['unchecked', 'Unreachable'], unchecked: ['unchecked', 'Not checked'],
};
/** the network the app's own trust hologram would show: being checked, blocked, or decided in the last 12 s */
function pickTrust(sn: Snap): TV | undefined {
  const all = Object.values(sn.infinet.trust).filter((tv) => !tv.net.startsWith('cell') && tv.net !== 'flood' && tv.steps.length && !tv.follows);
  const recent = (tv: TV) => tv.decidedT !== undefined && sn.t - tv.decidedT < 12 && tv.firstSeenT > 0.5;
  return all.find((tv) => tv.tier === 'blocked') ?? all.find((tv) => tv.tier === 'checking') ?? all.filter(recent).sort((a, b) => (b.decidedT ?? 0) - (a.decidedT ?? 0))[0];
}
function trustCard(el: HTMLElement, tv: TV) {
  const [cls, word] = TIER[tv.tier] ?? TIER.unchecked;
  const html = `<div class="b-label">Trust check</div><div class="fm-nm">${NET[tv.net] ?? tv.net}</div><ul>${tv.steps.map((st) =>
    `<li class="${st.ok === null ? 'fm-wait' : st.ok ? 'fm-good' : 'fm-bad'}"><i>${st.ok === null ? '…' : st.ok ? '✓' : '✕'}</i><span>${st.text}</span></li>`).join('')}</ul>
    <div class="fm-ft"><span class="fm-mc">May carry: ${tv.mayCarry}</span><span class="b-state b-cut1 b-${cls}"><i></i>${word}</span></div>`;
  if (el.dataset.k !== html) { el.dataset.k = html; el.innerHTML = html; }
}
const snap = (): Snap => (globalThis as unknown as { __infinet: { driver: { snap: Snap } } }).__infinet.driver.snap;

let root: HTMLDivElement;
let S: Setup;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T;

function laneHtml(p: Pol, now: number, inf: boolean) {
  const W = 15; // the last 15 s
  const a = now - W;
  return p.laneSegments.filter((s) => s.t1 > a).map((s) => {
    const x0 = (Math.max(s.t0, a) - a) / W, x1 = (Math.min(s.t1, now) - a) / W;
    if (x1 <= x0) return '';
    const live = inf ? C.violet : C.steel;
    const bg = ({
      live: live, weak: `repeating-linear-gradient(135deg, ${C.steel} 0 4px, ${C.night3} 4px 8px)`, checking: C.night,
      handover: `repeating-linear-gradient(90deg, ${C.violet} 0 6px, transparent 6px 10px)`, frozen: C.orange, dropped: C.orange, idle: C.night3,
    } as Record<string, string>)[s.state] ?? C.night3;
    const ol = s.state === 'checking' ? `box-shadow: inset 0 0 0 2px ${C.cyan};` : '';
    return `<i style="left:${(x0 * 100).toFixed(2)}%;width:${((x1 - x0) * 100).toFixed(2)}%;background:${bg};${ol}"></i>`;
  }).join('');
}

function phone(el: HTMLElement, p: Pol, now: number, inf: boolean) {
  const [cls, word] = STATE[p.callState] ?? STATE.live;
  const st = el.querySelector('.b-state') as HTMLElement;
  if (st.dataset.k !== cls) { st.dataset.k = cls; st.className = `b-state b-cut1 b-${cls}`; st.innerHTML = `<i></i>${word}`; }
  const net = `${p.activeLabel}<b> · ${p.checked ? 'checked' : 'not checked'}</b>`;
  const n = el.querySelector('.fm-net') as HTMLElement;
  if (n.innerHTML !== net) n.innerHTML = net;
  (el.querySelector('.fm-lane') as HTMLElement).innerHTML = laneHtml(p, now, inf);
  const f = p.metrics.frozenS;
  const v = el.querySelector('.fm-row3 .fm-v') as HTMLElement;
  v.innerHTML = ro(f.toFixed(1), 's');
  v.style.color = p.callState === 'frozen' || p.callState === 'dropped' ? C.orange : '#fff';
}

/** the chapter card builds from signal cells, holds, then wipes away to the left */
function chapterAt(t: number) {
  const ch = S.chapter!, el = $('.fm-chap');
  if (t > ch.b + 0.7) { el.style.display = 'none'; return; }
  el.style.display = '';
  const kin = span(t, ch.a, ch.a + 0.55, ease2), kout = span(t, ch.b, ch.b + 0.6, ease2);
  // cells: a column of squares that sweeps across ahead of the panel's edge
  const edge = 760 * (kin - kout);
  const bg = $('.fm-chap .fm-bg');
  bg.style.clipPath = kout > 0 ? `inset(0 0 0 ${(kout * 100).toFixed(2)}%)` : `inset(0 ${((1 - kin) * 100).toFixed(2)}% 0 0)`;
  const cells = root.querySelectorAll<HTMLElement>('.fm-chap .fm-cells i');
  const sweeping = (kin > 0 && kin < 1) || (kout > 0 && kout < 1);
  cells.forEach((c, i) => {
    const row = Math.floor(i / 3), col = i % 3, r = hash(row, col);
    const x = (kout > 0 ? 760 * kout : edge) + (col - 1) * 26 + (r - 0.5) * 30;
    c.style.left = `${x}px`; c.style.top = `${row * 26}px`;
    c.style.opacity = sweeping && r > 0.35 ? '1' : '0';
    c.style.background = r > 0.8 ? C.cyan : C.violet;
  });
  const inn = $('.fm-chap .fm-in');
  const kText = span(t, ch.a + 0.35, ch.a + 0.95) * (1 - span(t, ch.b - 0.05, ch.b + 0.3, ease2));
  inn.style.opacity = String(kText);
  inn.style.transform = `translateX(${(1 - kText) * -28}px)`;
}

function capAt(t: number) {
  const el = $('.fm-cap');
  const c = S.caps.find((x) => t >= x.a && t < x.b);
  if (!c) { el.style.opacity = '0'; return; }
  const op = Math.min(span(t, c.a, c.a + 0.35), 1 - span(t, c.b - 0.3, c.b, ease2));
  if (el.dataset.k !== c.k + c.t) {
    el.dataset.k = c.k + c.t;
    el.innerHTML = `<div class="b-label"><i></i>${c.k}</div><div class="fm-t">${c.t}</div>`;
  }
  el.style.opacity = String(op);
  el.style.transform = `translateY(${(1 - op) * 16}px)`;
}

const api = {
  async setup(s: Setup) {
    S = s;
    if (!root) {
      injectCss(FILM_CSS);
      root = document.createElement('div');
      root.id = 'film';
      document.body.appendChild(root);
    }
    const base = BASE[snap().lab.baseline] ?? BASE.b1;
    root.innerHTML = `
      <div class="fm-top"><div class="b-logo">${LOGO.lockupPlain}</div><div class="fm-div"></div>
        <div class="fm-scene"><span class="b-label">${s.top.n} · ${s.top.title}</span><span class="fm-sub">${s.top.sub}</span></div>
        <div class="fm-sp"></div><span class="b-tag b-sim">Simulated</span></div>
      ${s.chapter ? `<div class="fm-chap"><div class="fm-bg"></div><div class="fm-cells">${'<i></i>'.repeat(3 * 40)}</div>
        <div class="fm-in"><span class="b-tag b-sim">Simulated</span><div class="fm-no">${s.chapter.n}</div><h1>${s.chapter.title}</h1>
        <div class="fm-sub">${s.chapter.sub}</div>${s.chapter.ar ? `<div class="fm-ar" lang="ar">${s.chapter.ar}</div>` : ''}</div></div>` : ''}
      <div class="fm-ph fm-l b-cut2"><div class="fm-row1"><span class="fm-who">${base[0]}</span><span class="b-state"></span></div>
        <div class="fm-what">${base[1]}</div><div class="fm-net"></div><div class="fm-lane"></div>
        <div class="fm-row3"><span class="b-label">Seconds frozen</span><span class="fm-v"></span></div></div>
      <div class="fm-ph fm-r b-cut2"><div class="fm-row1"><span class="fm-who">Infinet</span><span class="b-state"></span></div>
        <div class="fm-what">sees the drop coming · checks first</div><div class="fm-net"></div><div class="fm-lane"></div>
        <div class="fm-row3"><span class="b-label">Seconds frozen</span><span class="fm-v"></span></div></div>
      <div class="fm-tc b-cut2"></div>
      <div class="fm-cap b-cut2 fm-${s.hud}"></div>`;
    await fontsReady();
  },
  frame(t: number) {
    const sn = snap();
    const data = S.hud === 'data';
    const [pa, pb] = S.panels ?? [S.chapter ? S.chapter.b + 0.2 : 0.25, 1e9];
    const kp = data ? Math.min(span(t, pa, pa + 0.45), 1 - span(t, pb, pb + 0.4, ease2)) : 0;
    root.querySelectorAll<HTMLElement>('.fm-ph').forEach((el, i) => {
      el.style.display = kp > 0 ? '' : 'none';
      el.style.opacity = String(kp);
      el.style.transform = `translateY(${(1 - kp) * 24}px)`;
      if (kp > 0) phone(el, i === 0 ? sn.policies[sn.lab.baseline] : sn.policies.infinet, sn.t, i === 1);
    });
    const tc = $('.fm-tc'), tv = S.trust ? pickTrust(sn) : undefined;
    const kt = tv && S.trust ? Math.min(span(t, S.trust[0], S.trust[0] + 0.4), 1 - span(t, S.trust[1] - 0.3, S.trust[1], ease2)) : 0;
    tc.style.display = kt > 0 ? '' : 'none';
    if (kt > 0 && tv) { trustCard(tc, tv); tc.style.opacity = String(kt); tc.style.transform = `translateX(${(1 - kt) * 30}px)`; }
    // the scene name in the top bar waits for the chapter card to leave
    const sc = $('.fm-top .fm-scene');
    sc.style.opacity = String(S.chapter ? span(t, S.chapter.b + 0.1, S.chapter.b + 0.5) : 1);
    if (S.chapter) chapterAt(t);
    capAt(t);
  },
  clamp,
  ease,
};
(globalThis as unknown as { __film: typeof api }).__film = api;
