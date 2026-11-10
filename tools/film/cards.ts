/// <reference lib="dom" />
/// <reference types="vite/client" />
/**
 * The film's cards (style guide v1.1, p25 "Video loop"): title, the idea, results, built / simulated / next, the end.
 * Night ground, one accent at a time, the edge cut, Chakra Petch / IBM Plex. The title card's first frame is also the
 * film's last frame, so the loop is seamless. Results follow p17: Today's phone in Steel, Infinet in Violet, bar =
 * average, tick = worst run, unit, runs and the word simulated on every number, source under the chart.
 * Copy is the guide's own where it has it (brand story p3, Arabic p11–12); every number comes from the batch via film.ts.
 */
import { C, CSS, LOGO, SIGNAL_BINS, clamp, ease, ease2, fontsReady, hash, injectCss, span } from './brand';

const CARD_CSS = `
${CSS}
#stage { position: absolute; inset: 0; overflow: hidden; background: var(--b-night); font-family: var(--b-text); color: #fff; }
.abs { position: absolute; }
canvas.field { position: absolute; left: 0; top: 0; }
.kick { display: flex; align-items: center; gap: 14px; font-size: 20px; color: var(--b-mute); }
.kick i { width: 14px; height: 14px; background: var(--b-violet); }
h1, h2 { font-family: var(--b-display); font-weight: 700; margin: 0; }
.h-xl { font-size: 124px; line-height: 1.0; letter-spacing: -0.005em; }
.h-l { font-size: 80px; line-height: 1.04; }
.h-m { font-size: 64px; line-height: 1.06; }
.ar { font-family: var(--b-arabic); font-weight: 600; direction: rtl; }
.mono { font-family: var(--b-data); }
.panel { background: var(--b-night2); }
.tl-row { position: absolute; height: 58px; }
.tl-row i { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; padding: 0 14px; font: 500 21px/1 var(--b-text); white-space: nowrap; overflow: hidden; }
.tile .num { font: 500 24px/1 var(--b-data); color: var(--b-mute); }
.tile h3 { font: 700 36px/1.1 var(--b-display); margin: 14px 0 12px; }
.tile p { font: 400 25px/1.4 var(--b-text); color: var(--b-mute); }
.bars .scn { font: 600 26px/1 var(--b-text); }
.bars .who { font: 500 19px/1 var(--b-text); }
.bars .val { font: 500 26px/1 var(--b-data); white-space: nowrap; }
.bars .val small { font-size: 13px; margin-left: 4px; }
.res .tile h4 { font: 600 18px/1 var(--b-display); letter-spacing: 0.16em; text-transform: uppercase; color: #fff; }
.res .tile .d { font: 400 20px/1.3 var(--b-text); color: var(--b-mute); margin-top: 8px; }
.res .tile .big { font: 500 72px/1 var(--b-data); }
.res .tile .big small { font-size: 36px; margin-left: 8px; }
.res .tile .cmp { font: 500 16px/1.4 var(--b-data); letter-spacing: 0.1em; color: var(--b-mute); text-transform: uppercase; text-align: right; }
.res .tile .cmp b { display: block; font: 500 30px/1.2 var(--b-data); color: #9AA0B4; letter-spacing: 0; }
.res .tile .foot { font: 500 15px/1 var(--b-data); letter-spacing: 0.12em; color: var(--b-mute); text-transform: uppercase; }
.col li { list-style: none; position: relative; padding-left: 30px; font: 400 29px/1.36 var(--b-text); margin: 0 0 22px; }
.col li::before { content: ''; position: absolute; left: 0; top: 14px; width: 12px; height: 12px; background: currentColor; }
.col ul { padding: 0; margin-top: 34px; }
`;

const stage = document.getElementById('stage')!;
type Draw = (t: number, dur: number) => void;
type Row = { label: string; b1: number; b1max: number; inf: number; infmax: number };
type Data = {
  cut: string; N: number; runs: number; rows: Row[]; survB1: number; survInf: number; survOf: number;
  property: { runs: number; violations: number; fakeAdmissionFrames: number }; dupMin: number; dupMax: number;
  built: string[]; simulated: string[]; next: string[];
};
const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild as HTMLElement; };
const add = (html: string) => stage.appendChild(el(html));
const show = (e: HTMLElement, k: number, dy = 20, dx = 0) => {
  e.style.opacity = String(k);
  e.style.transform = `translate(${(1 - k) * dx}px, ${(1 - k) * dy}px)`;
};
const M = 112; // margin, px

// ───────────── the signal field (p14): cells from a radio model, shrinking with distance; orange only at the edge ─────────────
type Cell = { x: number; y: number; d: number; dbm: number };
const PITCH = 40;
const SOURCES: Array<{ x: number; y: number; p: number }> = [{ x: 1760, y: 250, p: -30 }, { x: 1640, y: 900, p: -33 }];
const FIELD: Cell[] = (() => {
  const out: Cell[] = [];
  for (let gy = 0; gy < 1080 / PITCH; gy++) {
    for (let gx = 0; gx < 1920 / PITCH; gx++) {
      const x = gx * PITCH + PITCH / 2, y = gy * PITCH + PITCH / 2;
      if (x < 1200) continue; // the left side stays clear for text (one zone, p14)
      let best = -200, bd = 0;
      for (const s of SOURCES) {
        const d = Math.max(PITCH, Math.hypot(x - s.x, y - s.y));
        const v = s.p - 36 * Math.log10(d / PITCH) + (hash(gx, gy) - 0.5) * 7;
        if (v > best) { best = v; bd = d; }
      }
      if (best < -84) continue;
      out.push({ x, y, d: bd, dbm: best });
    }
  }
  return out;
})();
const binColor = (dbm: number) => SIGNAL_BINS.find(([lo]) => dbm >= lo)![1];

function drawField(cv: HTMLCanvasElement, t: number, ripple = true, k = 1) {
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  for (const c of FIELD) {
    const base = 0.2 + 0.64 * clamp((c.dbm + 84) / 34);
    // a pulse of signal travels out from the sources, then the field is back at rest (the loop frame)
    const w = ripple ? Math.exp(-(((c.d - (t - 0.6) * 520) / 110) ** 2)) * (t > 0.6 ? 1 : 0) : 0;
    const appear = k >= 1 ? 1 : clamp((k * 1700 - c.d) / 260);
    const s = PITCH * Math.min(0.88, base * (1 + 0.32 * w)) * appear;
    if (s < 1) continue;
    g.fillStyle = w > 0.55 && c.dbm < -55 ? C.cyan : binColor(c.dbm);
    g.fillRect(Math.round(c.x - s / 2), Math.round(c.y - s / 2), Math.round(s), Math.round(s));
  }
}
function fieldCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 1920; cv.height = 1080; cv.className = 'field';
  stage.appendChild(cv);
  return cv;
}

// ───────────── cards ─────────────
const CARDS: Record<string, (d: Data) => Draw> = {
  /** p25 title card: the lockup, the tagline in both languages, the signal field. Complete from its first frame. */
  title: (d) => {
    const cv = fieldCanvas();
    add(`<div class="abs b-logo" style="left:${M}px;top:118px;width:420px">${LOGO.lockupNight}</div>`);
    add(`<h1 class="abs h-xl" style="left:${M}px;top:430px">Stay connected.<br>Stay secure.</h1>`);
    add(`<div class="abs ar" style="left:${M}px;top:700px;width:760px;text-align:right;font-size:50px;line-height:1.4">ابقَ متصلاً. ابقَ آمناً.</div>`);
    add(`<div class="abs" style="left:${M}px;top:690px;width:760px;height:1px;background:${C.steel}"></div>`);
    add(`<div class="abs mono" style="left:${M}px;top:948px;font-size:20px;letter-spacing:0.14em;color:${C.mute}">TEAM INFINET · 42 ABU DHABI · STAND 31 · EDGE TRACK</div>`);
    return (t) => drawField(cv, (d as unknown as { hold?: boolean }).hold ? 0 : t);
  },

  /** the idea: the guide's handover timeline (p17), drawn as it happens, and the three features (p3) */
  idea: () => {
    const kick = add(`<div class="abs kick b-label" style="left:${M}px;top:110px"><i></i>The idea</div>`);
    const h = add(`<h1 class="abs h-l" style="left:${M}px;top:150px">Prediction buys time.<br>Infinet spends it on trust.</h1>`);
    const ar = add(`<div class="abs ar" style="right:${M}px;top:118px;width:640px;text-align:right;font-size:31px;line-height:1.55;color:${C.haze}">يرى إنفينت انقطاع الشبكة قبل حدوثه، ويفحص الشبكة التالية قبل أن يثق بها.</div>`);
    const P = { x: M, y: 400, w: 1920 - 2 * M, h: 300 };
    const panel = add(`<div class="abs panel b-cut2" style="--b-c:24px;left:${P.x}px;top:${P.y}px;width:${P.w}px;height:${P.h}px"></div>`);
    panel.appendChild(el(`<div class="abs b-label" style="left:40px;top:30px;font-size:17px;color:${C.mute}">Handover timeline · same walk, same signal</div>`));
    panel.appendChild(el(`<div class="abs mono" style="right:40px;top:30px;font-size:15px;letter-spacing:0.12em;color:${C.mute}">ILLUSTRATION, NOT MEASURED DATA</div>`));
    const X0 = 280, W = P.w - X0 - 40;
    const rows: Array<{ who: string; col: string; y: number; segs: Array<[number, number, string, string, string]> }> = [
      { who: "Today's phone", col: '#fff', y: 84, segs: [
        [0, 0.44, 'Wi-Fi', C.night3, '#fff'], [0.44, 0.58, 'getting weak', `repeating-linear-gradient(135deg, ${C.steel} 0 6px, ${C.night3} 6px 12px)`, '#fff'],
        [0.58, 0.8, 'call frozen', C.orange, C.night], [0.8, 1, '5G · not checked', C.night3, '#fff']] },
      { who: 'Infinet', col: C.violetLt, y: 160, segs: [
        [0, 0.33, 'Wi-Fi', C.night3, '#fff'], [0.33, 0.46, 'checking 5G', C.night, C.cyan], [0.46, 1, '5G · trusted · call continues', C.violet, '#fff']] },
    ];
    const segEls: Array<{ e: HTMLElement; a: number; b: number }> = [];
    for (const r of rows) {
      panel.appendChild(el(`<div class="abs" style="left:40px;top:${r.y + 16}px;font:500 26px/1 var(--b-text);color:${r.col}">${r.who}</div>`));
      const row = el(`<div class="tl-row" style="left:${X0}px;top:${r.y}px;width:${W}px"></div>`);
      panel.appendChild(row);
      for (const [a, b, txt, bg, fg] of r.segs) {
        const e = el(`<i style="left:${(a * 100).toFixed(2)}%;width:0;background:${bg};color:${fg};${txt === 'checking 5G' ? `box-shadow: inset 0 0 0 2px ${C.cyan};` : ''}"><span>${txt}</span></i>`);
        row.appendChild(e);
        segEls.push({ e, a, b });
      }
    }
    const mk = (x: number, txt: string, dashed: boolean) => {
      const m = el(`<div class="abs" style="left:${X0 + x * W}px;top:${dashed ? 70 : 226}px;height:${dashed ? 160 : 0}px;border-left:${dashed ? `2px dashed ${C.haze}` : '0'}"></div>`);
      const l = el(`<div class="abs mono" style="left:${X0 + x * W + (dashed ? 12 : -6)}px;top:${dashed ? 244 : 234}px;font-size:16px;letter-spacing:0.12em;color:${dashed ? '#fff' : C.cyan};white-space:nowrap">${txt}</div>`);
      panel.appendChild(m); panel.appendChild(l);
      return [m, l];
    };
    const edge = mk(0.33, '▲ EDGE SEEN ON THE MAP', false), dies = mk(0.58, 'WI-FI ACTUALLY DIES', true);
    const head = el(`<div class="abs" style="top:70px;height:160px;width:2px;background:#fff"></div>`);
    panel.appendChild(head);
    const tiles = [
      ['01', 'Sees the drop coming', 'Our coverage map knows where signal ends: seconds of warning, not fractions of one.'],
      ['02', 'Checks before it trusts', 'Every new network passes a check before the call touches it.'],
      ['03', 'Keeps the call', 'One encrypted tunnel to our anchor server, so changing networks never breaks the call.'],
    ].map(([n, t, p], i) => add(`<div class="abs tile panel b-cut2" style="--b-c:20px;left:${M + i * 576}px;top:740px;width:544px;height:232px;padding:30px 34px"><div class="num">${n}</div><h3>${t}</h3><p>${p}</p></div>`));
    return (t) => {
      show(kick, span(t, 0, 0.5)); show(h, span(t, 0.1, 0.7)); show(ar, span(t, 0.4, 1.0));
      show(panel, span(t, 0.6, 1.2), 30);
      const q = clamp((t - 1.3) / 4.2);
      for (const s of segEls) {
        const w = clamp((q - s.a) / (s.b - s.a));
        s.e.style.width = `${(w * (s.b - s.a) * 100).toFixed(3)}%`;
        (s.e.firstElementChild as HTMLElement).style.opacity = String(clamp(w * 4 - 1));
      }
      head.style.left = `${X0 + q * W - 1}px`;
      head.style.opacity = String(q > 0 && q < 1 ? 1 : 0);
      for (const e of edge) e.style.opacity = String(clamp((q - 0.33) * 12));
      for (const e of dies) e.style.opacity = String(clamp((q - 0.58) * 12));
      tiles.forEach((e, i) => show(e, span(t, 5.2 + i * 0.25, 5.9 + i * 0.25), 26));
    };
  },

  /** results (p17): the frozen-seconds chart and three tiles. Every value from the batch. */
  results: (d) => {
    stage.classList.add('res');
    const kick = add(`<div class="abs kick b-label" style="left:${M}px;top:96px"><i></i>Results · simulated · ${d.runs} runs per scene</div>`);
    const h = add(`<h1 class="abs h-m" style="left:${M}px;top:136px">${d.survInf} of ${d.survOf} calls survived.</h1>`);
    const sub = add(`<div class="abs" style="left:${M}px;top:222px;font:400 28px/1.4 var(--b-text);color:${C.mute}">Today's phone: ${d.survB1} of ${d.survOf}. Same walk, same signal, same radio for every phone.</div>`);
    const P = { x: M, y: 300, w: 1060, h: 690 };
    const panel = add(`<div class="abs panel b-cut2 bars" style="--b-c:24px;left:${P.x}px;top:${P.y}px;width:${P.w}px;height:${P.h}px"></div>`);
    panel.appendChild(el(`<div class="abs b-label" style="left:40px;top:32px;font-size:17px;color:${C.mute}">Seconds frozen per call · bar = average · tick = worst run</div>`));
    const X0 = 230, W = 760, MAX = 40, sx = (s: number) => (s / MAX) * W;
    for (const v of [0, 10, 20, 30, 40]) {
      panel.appendChild(el(`<div class="abs" style="left:${X0 + sx(v)}px;top:84px;height:500px;width:1px;background:${C.night3}"></div>`));
      panel.appendChild(el(`<div class="abs mono" style="left:${X0 + sx(v)}px;top:594px;transform:translateX(-50%);font-size:17px;color:${C.mute}">${v}${v === 40 ? ' s' : ''}</div>`));
    }
    panel.appendChild(el(`<div class="abs mono" style="left:40px;top:640px;font-size:15px;color:${C.mute};letter-spacing:0.04em">Source: our simulation, ${d.runs} randomised runs per scene, 10 Nov 2026 batch.</div>`));
    const bars: Array<{ fill: HTMLElement; tick: HTMLElement; val: HTMLElement; v: number; max: number; at: number }> = [];
    d.rows.forEach((r, i) => {
      const y = 96 + i * 166;
      panel.appendChild(el(`<div class="abs scn" style="left:40px;top:${y}px">${r.label}</div>`));
      ([['Today\'s phone', r.b1, r.b1max, C.steel, '#C4C8D4'], ['Infinet', r.inf, r.infmax, C.violet, C.violetLt]] as const).forEach(([who, v, mx, col, tc], j) => {
        const yy = y + 42 + j * 50;
        panel.appendChild(el(`<div class="abs who" style="left:40px;top:${yy + 10}px;color:${tc}">${who}</div>`));
        const fill = el(`<div class="abs" style="left:${X0}px;top:${yy}px;height:38px;width:0;background:${col}"></div>`);
        const tick = el(`<div class="abs" style="left:${X0 + sx(mx)}px;top:${yy - 5}px;height:48px;width:3px;background:#fff;opacity:0"></div>`);
        const val = el(`<div class="abs val" style="top:${yy + 6}px;color:${j ? '#fff' : '#E9EBF0'}"></div>`);
        panel.appendChild(fill); panel.appendChild(tick); panel.appendChild(val);
        bars.push({ fill, tick, val, v, max: mx, at: 1.4 + i * 0.45 + j * 0.15 });
      });
    });
    const T = { x: M + P.w + 32, w: 1920 - 2 * M - P.w - 32 };
    const tile = (y: number, h4: string, dsc: string, big: string, cmp: string, foot: string) =>
      add(`<div class="abs tile panel b-cut2" style="--b-c:20px;left:${T.x}px;top:${y}px;width:${T.w}px;height:214px;padding:26px 30px">
        <h4>${h4}</h4><div class="d">${dsc}</div>
        <div class="abs" style="left:30px;bottom:48px" data-big><span class="big">${big}</span></div>
        <div class="abs cmp" style="right:30px;bottom:52px">${cmp}</div>
        <div class="abs foot" style="left:30px;bottom:20px">${foot}</div></div>`);
    const t1 = tile(300, 'Calls survived', 'Calls still up at the end of the walk', `<span data-n>${d.survInf}</span><small>/ ${d.survOf}</small>`, `Today's phone<b>${d.survB1} / ${d.survOf}</b>`, 'All three places · simulated');
    const t2 = tile(538, 'Fake networks used', 'Voice frames sent over a fake or unchecked network', `${d.property.fakeAdmissionFrames}`, `Attack runs<b>${d.property.runs.toLocaleString('en')}</b>`, 'Randomised copies · simulated');
    const t3 = tile(776, 'Extra data used', 'Duplicate packets, in risky moments only', `+${d.dupMin.toFixed(1)}–${d.dupMax.toFixed(1)}<small>%</small>`, `Today's phone<b>+0%</b>`, 'The cost of being careful');
    const nEl = t1.querySelector('[data-n]') as HTMLElement;
    return (t) => {
      show(kick, span(t, 0, 0.5)); show(h, span(t, 0.1, 0.7)); show(sub, span(t, 0.3, 0.9));
      show(panel, span(t, 0.5, 1.1), 30);
      for (const b of bars) {
        const k = span(t, b.at, b.at + 1.1);
        b.fill.style.width = `${sx(b.v) * k}px`;
        const after = sx(b.max) - sx(b.v) < 110 ? sx(b.max) : 0;
        b.val.style.left = `${X0 + Math.max(sx(b.v) * k, after) + 14}px`;
        b.val.innerHTML = `${(b.v * k).toFixed(b.v < 1 ? 2 : 1)}<small>s</small>`;
        b.val.style.opacity = String(span(t, b.at, b.at + 0.3));
        b.tick.style.opacity = String(span(t, b.at + 1.0, b.at + 1.4));
      }
      [t1, t2, t3].forEach((e, i) => show(e, span(t, 3.6 + i * 0.35, 4.3 + i * 0.35), 0, 40));
      nEl.textContent = String(Math.round(d.survInf * span(t, 3.8, 5.0, ease2)));
    };
  },

  /** p17 honesty tags: what is built, what is simulated, what comes next */
  built: (d) => {
    const kick = add(`<div class="abs kick b-label" style="left:${M}px;top:110px"><i></i>What's real</div>`);
    const h = add(`<h1 class="abs h-l" style="left:${M}px;top:150px">Built, simulated, next.</h1>`);
    const cols = ([['built', 'Built', d.built, '#fff'], ['sim', 'Simulated', d.simulated, C.cyan], ['next', 'Next', d.next, C.mute]] as const).map(([cls, word, items, col], i) => {
      const c = add(`<div class="abs col" style="left:${M + i * 576}px;top:330px;width:544px;color:${col}"><span class="b-tag b-${cls}">${word}</span><ul>${items.map((x) => `<li style="color:${col}"><span style="color:#fff">${x}</span></li>`).join('')}</ul></div>`);
      return { c, lis: [...c.querySelectorAll('li')] as HTMLElement[], i };
    });
    return (t) => {
      show(kick, span(t, 0, 0.5)); show(h, span(t, 0.1, 0.7));
      for (const { c, lis, i } of cols) {
        show(c.firstElementChild as HTMLElement, span(t, 0.6 + i * 0.3, 1.1 + i * 0.3), 14);
        lis.forEach((li, j) => show(li, span(t, 1.0 + i * 0.3 + j * 0.22, 1.5 + i * 0.3 + j * 0.22), 16));
      }
    };
  },

  /** the end: the pitch line, where to find us; the field at rest, as on the title card */
  end: () => {
    const cv = fieldCanvas();
    add(`<div class="abs b-logo" style="left:${M}px;top:118px;width:420px">${LOGO.lockupNight}</div>`);
    const h = add(`<h1 class="abs h-l" style="left:${M}px;top:420px">Prediction buys time.<br>Infinet spends it on trust.</h1>`);
    const f = add(`<div class="abs" style="left:${M}px;top:640px;font:600 44px/1.2 var(--b-display)">Find us at Stand 31.</div>`);
    const lab = add(`<div class="abs mono" style="left:${M}px;top:948px;font-size:20px;letter-spacing:0.14em;color:${C.mute}">TEAM INFINET · 42 ABU DHABI · DEVELOPED IN THE EDGE TRACK OF ATRC ATP 2026</div>`);
    return (t) => {
      drawField(cv, 0, false);
      show(h, span(t, 0.1, 0.8)); show(f, span(t, 0.6, 1.2)); show(lab, span(t, 0.9, 1.5));
    };
  },
};

let draw: Draw = () => {};
(globalThis as unknown as { __card: unknown }).__card = {
  async ready() { injectCss(CARD_CSS); await fontsReady(); },
  show(name: string, data: Data) {
    stage.innerHTML = '';
    stage.className = '';
    draw = CARDS[name](data);
    draw(0, 1);
  },
  render(t: number, dur: number) { draw(t, dur); },
  ease,
};
