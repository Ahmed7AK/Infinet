/**
 * The judges' film: about 75 s (public cut) or 87 s (booth cut, with our hall), 1920 × 1080, 30 fps, no audio.
 *   npm run dev   (in another terminal)   then
 *   npx tsx tools/record/film.ts --cut public    → media/infinet-film.mp4        (three scenes; safe to publish)
 *   npx tsx tools/record/film.ts --cut booth     → venue-private/media/infinet-film-booth.mp4  (adds the hall; never pushed)
 *   options: --only id,id (re-shoot some segments, reuse the rest) · --fps 30 · --url http://localhost:5173
 *
 * Deterministic, like cinematic.ts: each simulation frame steps the same per-frame driver logic by exactly 1/fps,
 * the film sets the Vision blend (window.__infinetVisionK) and, for the drone shot, the camera (window.__infinetCam)
 * itself, then screenshots. Lower thirds are injected into the page; the booth hints, captions and banners are hidden.
 * The animated cards (tools/film/cards.html) are drawn at exact times too. Every number on them is read from the
 * batch (results/2026-11-10/summary.json). Segments are encoded one by one, then joined with 0.5 s cross-fades.
 */
import { launch } from './browser';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = arg('url', 'http://localhost:5173');
const cut = arg('cut', 'public') as 'public' | 'booth';
const fps = Number(arg('fps', '30'));
const only = arg('only', '').split(',').filter(Boolean);
const work = resolve(`results/cinematic/film-${cut}`);
const outFile = resolve(cut === 'public' ? 'media/infinet-film.mp4' : 'venue-private/media/infinet-film-booth.mp4');
const FFMPEG = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
const XF = 0.5; // cross-fade, s

if (cut === 'booth' && !existsSync('venue-private/hall/venue.json')) throw new Error('the booth cut needs venue-private/ (the hall)');

// ───────────── numbers, from the batch ─────────────
const BATCH = 'results/2026-11-10/summary.json';
const S = JSON.parse(readFileSync(BATCH, 'utf8'));
const row = (id: string) => {
  const s = S.scenarios[id];
  return { b1: s.b1.frozenS.mean, b3: s.b3.frozenS.mean, inf: s.infinet.frozenS.mean, survB1: s.b1.survived.n, survInf: s.infinet.survived.n };
};
const DATA = {
  runs: S.runs,
  exit: row('building-exit'), cafe: row('cafe-twin'), desert: row('desert-sat'),
  property: S.property as { runs: number; violations: number },
  lead: S.scenarios['building-exit'].infinet.predLeadS.mean as number,
  leadMedian: S.scenarios['building-exit'].infinet.predLeadS.median as number,
  falseDeadB3: S.scenarios['desert-sat'].b3.falseDead.mean as number,
};
const f1 = (x: number) => x.toFixed(1);

const BUILT = {
  built: [
    'The policy engine: predict the edge, check before trust, one tunnel, patience on satellite',
    'Security spec v1.0: six verdicts, weighted red flags, fails closed',
    ...(cut === 'booth' ? ['Our hall, rebuilt and fitted to a 27-point Wi-Fi survey we took on set-up day'] : []),
    `${DATA.runs} runs per scene and a ${DATA.property.runs.toLocaleString('en')}-run attack test, 68 automated tests`,
  ],
  simulated: [
    'Radio: 3GPP TR 38.901 path loss, ITU wall losses',
    'Satellite behaviour from published LEO and GEO measurements',
    'The anchor server, the probe and the attacker',
    'Every assumption is listed in the app (Sim notes)',
  ],
  next: [
    'A real WireGuard tunnel with anchor handover, on two phones',
    'Screening on a phone\'s live Wi-Fi scan',
    'Re-survey with the crowd in and check the map against it',
    'A field trial on a site router with satellite backhaul',
  ],
};

// ───────────── the edit ─────────────
type Lower = { a: number; b: number; k: string; t: string };
type Card = { id: string; kind: 'card'; card: string; dur: number; data?: unknown };
type Sim = {
  id: string; kind: 'sim'; scene: string; t0: number; dur: number; lowers: Lower[];
  /** Vision on over these [from, to] real-second windows (eased 0.6 s) */
  vision?: Array<[number, number]>;
  /** camera override per frame, u = 0..1 through the segment: [x, y, h, lookX, lookY, lookH] in engine metres */
  cam?: (u: number) => number[];
  /** page scripts at real times (e.g. the sign-in tap) */
  at?: Array<{ t: number; js: string }>;
};
type Seg = Card | Sim;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a: number[], b: number[], u: number) => a.map((v, i) => v + (b[i] - v) * u);

const SEGS: Seg[] = [
  { id: 'c1-title', kind: 'card', card: 'title', dur: 5.5 },
  { id: 'c2-idea', kind: 'card', card: 'idea', dur: 8 },
  // ch1 · demo seed 26: edge seen 17.0, 5G checked 17.1, switch 18.9 (auto slow-mo for 1 s), done 21.0; today's phone frozen 25.9–28.4
  {
    id: 's1a-exit', kind: 'sim', scene: 'building-exit', t0: 14.5, dur: 9.5,
    vision: [[1.0, 99]],
    lowers: [
      { a: 0, b: 3.6, k: '01 · Leaving the building', t: 'On a call, walking out of the office. The Wi-Fi fades at the door.' },
      { a: 3.6, b: 9.5, k: 'Sees the drop coming', t: `Infinet sees the Wi-Fi edge on its map (${f1(DATA.lead)} s early on average), checks 5G, and moves the call before the drop.` },
    ],
  },
  {
    id: 's1b-exit', kind: 'sim', scene: 'building-exit', t0: 25.2, dur: 4.5,
    lowers: [
      { a: 0, b: 4.5, k: 'No freeze', t: `Infinet's call never stopped. Today's phone waited for the Wi-Fi to die, then froze: ${f1(DATA.exit.b1)} s on average.` },
    ],
  },
  // ch2 · seed 21: the copy starts 21.6 and is Blocked at once; the strongest-signal phone freezes 22.6–26.2, then carries its call over the copy
  {
    id: 's2-cafe', kind: 'sim', scene: 'cafe-twin', t0: 18.5, dur: 13,
    vision: [[2.2, 99]],
    lowers: [
      { a: 0, b: 3.2, k: '02 · The fake café Wi-Fi', t: 'Still on the call, now on 5G, walking into a café.' },
      { a: 3.2, b: 8, k: 'Checks before it trusts', t: 'Someone starts a copy of the café Wi-Fi: same name, a different device, no password, far too strong.' },
      { a: 8, b: 13, k: 'Blocked', t: 'Three red flags: Blocked. Nothing goes to the copy. The phone that joins the strongest signal froze, then put its call through it.' },
    ],
  },
  // ch3 · seed 16: low-orbit outage 79.0, both calls freeze 79.3; Infinet live again 85.1, the fixed-timeout tunnel keeps flapping
  {
    id: 's3-desert', kind: 'sim', scene: 'desert-sat', t0: 74, dur: 13,
    vision: [[1.4, 99]],
    lowers: [
      { a: 0, b: 4.8, k: '03 · The desert site', t: 'The only way out is satellite. Infinet learned the low-orbit link\'s 15-second hiccup.' },
      { a: 4.8, b: 10.6, k: 'Patient on satellite', t: 'The low-orbit link is blocked. Both calls freeze while the router falls back to a geostationary satellite (600 ms round trip).' },
      { a: 10.6, b: 13, k: 'Holds the call', t: `Infinet waits it out and the call comes back. A fixed-timeout tunnel calls the link dead about ${Math.round(DATA.falseDeadB3)} times a call.` },
    ],
  },
    ...(cut === 'booth' ? ([
    {
      id: 's4a-hall-drone', kind: 'sim', scene: 'venue-hall', t0: 1, dur: 5.5, vision: [[-1, 99]],
      cam: (u: number) => lerp([40104, -27, 12.2, 40046, 6, 0], [40078, -26, 9.5, 40030, -6, 0], ease(u)),
      lowers: [
        { a: 0, b: 5.5, k: '04 · Our hall, as measured', t: 'This hall, rebuilt from the floor plan. The radio is fitted to our own survey: 27 points, 5 GHz within 3.8 dB.' },
      ],
    },
    {
      id: 's4b-hall', kind: 'sim', scene: 'venue-hall', t0: 5, dur: 9, vision: [[-1, 99]],
      at: [{ t: 2.5, js: 'globalThis.__infinet.driver.signIn()' }],
      lowers: [
        { a: 0, b: 2.6, k: 'Wi-Fi first, checked', t: 'The venue Wi-Fi shows a sign-in page, so the call stays on 4G. Only the sign-in page may open, in a sandbox.' },
        { a: 2.6, b: 9, k: 'Signed in', t: 'Infinet checks it again, then moves the call onto the venue Wi-Fi. About 20 phone hotspots are heard here: never joined.' },
      ],
    },
  ] as Seg[]) : []),
  { id: 'c3-results', kind: 'card', card: 'results', dur: 13, data: DATA },
  { id: 'c4-built', kind: 'card', card: 'built', dur: 7.5, data: BUILT },
  { id: 'c5-end', kind: 'card', card: 'end', dur: 4.5 },
];

// ───────────── capture ─────────────
const STEP = (dt: number) => `(() => { const g = globalThis; const d = g.__infinet.driver; g.__infinetPaused = false; d.tick(${dt}); g.__infinetPaused = true; return d.sim.t; })()`;
const SETTLE = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))`;
const OVERLAY = `(() => {
  const st = document.createElement('style');
  st.textContent = \`
    .hints .row, .jump, .banner, .caption, .help, .perf, .attract { display: none !important; }
    #film-lt { position: fixed; left: 50%; bottom: 58px; width: 900px; transform: translateX(-50%); z-index: 9999; pointer-events: none; }
    #film-lt .box { background: rgba(9, 13, 22, 0.88); border: 1px solid rgba(255, 255, 255, 0.10); border-left: 4px solid #67e8f9;
      border-radius: 14px; padding: 16px 24px 18px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45); }
    #film-lt .k { font: 600 14px/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.16em; color: #67e8f9; text-transform: uppercase; margin-bottom: 9px; }
    #film-lt .t { font: 600 26px/1.32 'Inter', system-ui, sans-serif; color: #eef2f7; }\`;
  document.head.appendChild(st);
  const lt = document.createElement('div'); lt.id = 'film-lt'; lt.innerHTML = '<div class="box"><div class="k"></div><div class="t"></div></div>';
  document.body.appendChild(lt);
  let cur = '';
  globalThis.__film = { lt(k, t, op) {
    if (k + t !== cur) { cur = k + t; lt.querySelector('.k').textContent = k; lt.querySelector('.t').textContent = t; }
    lt.style.opacity = String(op); lt.style.transform = 'translateX(-50%) translateY(' + ((1 - op) * 14) + 'px)';
  } };
})()`;

function visionAt(s: Sim, t: number): number {
  let k = 0;
  for (const [a, b] of s.vision ?? []) k = Math.max(k, Math.min(ease((t - a) / 0.6), 1 - ease((t - b) / 0.6)));
  return k;
}
function lowerAt(s: Sim, t: number): [string, string, number] {
  const l = s.lowers.find((x) => t >= x.a && t < x.b);
  if (!l) return ['', '', 0];
  const first = l === s.lowers[0], last = l === s.lowers[s.lowers.length - 1];
  const fin = first ? ease((t - l.a - 0.35) / 0.4) : 1;  // the first one rises in after the cross-fade
  const fout = last ? 1 : 1 - ease((t - (l.b - 0.3)) / 0.3);
  const fin2 = first ? fin : ease((t - l.a) / 0.3);
  return [l.k, l.t, Math.min(fin2, fout)];
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
const frameDir = (id: string) => join(work, 'frames', id);

async function shootSim(s: Sim, dir: string) {
  const q = `scene=${s.scene}&pause=1&t=${s.t0}${cut === 'public' ? '&public=1' : ''}`;
  await page.goto(`${base}/?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(`!document.querySelector('.loader')`, null, { timeout: 120000 }).catch(() => {});
  await page.evaluate(`(() => { const g = globalThis; g.__infinet.driver.idleS = 1e9; g.__infinetVisionK = ${visionAt(s, 0)};
    g.__infinet.useUi.setState({ vision: ${visionAt(s, 0) > 0.5} }); ${s.cam ? `g.__infinetCam = ${JSON.stringify(s.cam(0))};` : ''} })()`);
  await page.evaluate(OVERLAY);
  await page.waitForTimeout(2500); // the follow camera and the label layer settle
  const n = Math.round(s.dur * fps), todo = [...(s.at ?? [])];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    while (todo.length && todo[0].t <= t) await page.evaluate(todo.shift()!.js);
    const k = visionAt(s, t), [lk, lt, lop] = lowerAt(s, t);
    await page.evaluate(`(() => { const g = globalThis; g.__infinetVisionK = ${k}; if ((${k} > 0.5) !== g.__infinet.useUi.getState().vision) g.__infinet.useUi.setState({ vision: ${k} > 0.5 });
      ${s.cam ? `g.__infinetCam = ${JSON.stringify(s.cam(i / Math.max(1, n - 1)))};` : ''}
      g.__film.lt(${JSON.stringify(lk)}, ${JSON.stringify(lt)}, ${lop}); })()`);
    if (i > 0) await page.evaluate(STEP(1 / fps));
    await page.evaluate(SETTLE);
    await page.screenshot({ path: join(dir, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
    if ((i + 1) % (fps * 4) === 0) console.log(`  ${s.id}  ${i + 1}/${n}  ·  ${((Date.now() - t0) / (i + 1)).toFixed(0)} ms/frame`);
  }
  await page.evaluate(`(() => { delete globalThis.__infinetVisionK; delete globalThis.__infinetCam; })()`);
}

async function shootCard(c: Card, dir: string) {
  if (!page.url().includes('/tools/film/cards.html')) {
    await page.goto(`${base}/tools/film/cards.html`, { waitUntil: 'load' });
    await page.waitForFunction('!!globalThis.__card', null, { timeout: 60000 });
    await page.evaluate('globalThis.__card.ready()');
  }
  await page.evaluate(`globalThis.__card.show(${JSON.stringify(c.card)}, ${JSON.stringify(c.data ?? {})})`);
  await page.evaluate(SETTLE);
  const n = Math.round(c.dur * fps);
  for (let i = 0; i < n; i++) {
    await page.evaluate(`globalThis.__card.render(${i / fps})`);
    await page.screenshot({ path: join(dir, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
  }
}

const segFile = (id: string) => join(work, `${id}.mp4`);
for (const s of SEGS) {
  if (only.length && !only.includes(s.id) && existsSync(segFile(s.id))) continue;
  const dir = frameDir(s.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  if (s.kind === 'sim') await shootSim(s, dir);
  else await shootCard(s, dir);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, '%05d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-preset', 'medium', segFile(s.id)]);
  console.log(`${s.id}: ${readdirSync(dir).length} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();

// ───────────── join: 0.5 s cross-fades, a fade in from black and out to black ─────────────
const durs = SEGS.map((s) => Math.round(s.dur * fps) / fps);
const inputs = SEGS.flatMap((s) => ['-i', segFile(s.id)]);
const parts: string[] = [];
let prev = '[0:v]', acc = durs[0];
for (let i = 1; i < SEGS.length; i++) {
  const off = acc - XF;
  const outL = i === SEGS.length - 1 ? '[x]' : `[v${i}]`;
  parts.push(`${prev}[${i}:v]xfade=transition=fade:duration=${XF}:offset=${off.toFixed(3)}${outL}`);
  prev = outL;
  acc = off + durs[i];
}
// the JPEG frames are full range: convert to TV range, which every player (and PowerPoint) reads the same way
parts.push(`[x]fade=t=in:st=0:d=0.6,fade=t=out:st=${(acc - 0.9).toFixed(3)}:d=0.9,scale=in_range=pc:out_range=tv,format=yuv420p[out]`);
mkdirSync(dirname(outFile), { recursive: true });
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', parts.join(';'), '-map', '[out]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', cut === 'public' ? '23' : '20', '-color_range', 'tv', '-colorspace', 'bt709',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(fps), '-movflags', '+faststart', outFile]);
console.log(`${outFile}: ${acc.toFixed(1)} s, ${(statSync(outFile).size / 1e6).toFixed(1)} MB`);
if (errors.length) { console.log('PAGE ERRORS:\n' + errors.slice(0, 10).join('\n')); process.exitCode = 1; }
