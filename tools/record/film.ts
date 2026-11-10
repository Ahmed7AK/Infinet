/**
 * The judges' film, in the brand's style (Infinet style guide v1.1): about 89 s with our hall (booth cut) or 77 s
 * without it (public cut), 1920 × 1080, 30 fps, no audio, captions burned in, first and last frame the same so it loops.
 *   npm run dev   (in another terminal)   then
 *   npm run film -- --cut booth     → venue-private/media/infinet-film-booth.mp4  (adds the hall; never pushed)
 *   npm run film -- --cut public    → media/infinet-film.mp4                      (three scenes; safe to publish)
 *   options: --board (three stills per shot → results/cinematic/board-<cut>.jpg, no video) · --only id,id · --fps 30
 *            · --url http://localhost:5173
 *
 * The edit is chapters of shots. Each shot loads the app at a scene and sim time, then steps the same per-frame driver
 * logic by exactly 1/fps (deterministic, like cinematic.ts). The film sets the camera (window.__infinetCam: a move
 * computed here from the walker's position at that frame), the lens (window.__infinetFov) and the Network Vision blend
 * (window.__infinetVisionK) itself. The app's HUD is replaced by the film overlay (tools/film/overlay.ts): top bar,
 * chapter card, both phones read live from the sim, captions. Cards (tools/film/cards.ts) are drawn at exact times;
 * every number on them is read from the batch (results/2026-11-10/summary.json). Shots inside a chapter are joined
 * with hard cuts; chapters and cards with a wipe of signal cells.
 */
import { launch } from './browser';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = arg('url', 'http://localhost:5173');
const cut = arg('cut', 'booth') as 'public' | 'booth';
const fps = Number(arg('fps', '30'));
const only = arg('only', '').split(',').filter(Boolean);
const board = args.includes('--board');
const work = resolve(`results/cinematic/film-${cut}`);
const outFile = resolve(cut === 'public' ? 'media/infinet-film.mp4' : 'venue-private/media/infinet-film-booth.mp4');
const FFMPEG = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
const WIPE = 0.7; // the signal-cell wipe between chapters and cards, s

if (cut === 'booth' && !existsSync('venue-private/hall/venue.json')) throw new Error('the booth cut needs venue-private/ (the hall)');

// ───────────── numbers, from the batch ─────────────
const BATCH = 'results/2026-11-10/summary.json';
const S = JSON.parse(readFileSync(BATCH, 'utf8'));
const sc = (id: string, p: string) => S.scenarios[id][p];
const row = (id: string, label: string) => ({
  label,
  b1: sc(id, 'b1').frozenS.mean as number, b1max: sc(id, 'b1').frozenS.max as number,
  inf: sc(id, 'infinet').frozenS.mean as number, infmax: sc(id, 'infinet').frozenS.max as number,
});
const SCENES = ['building-exit', 'cafe-twin', 'desert-sat'];
const DATA = {
  runs: S.runs as number,
  rows: [row('building-exit', 'Leaving the building'), row('cafe-twin', 'Fake café Wi-Fi'), row('desert-sat', 'Desert, satellite only')],
  survB1: SCENES.reduce((a, id) => a + sc(id, 'b1').survived.n, 0), survInf: SCENES.reduce((a, id) => a + sc(id, 'infinet').survived.n, 0),
  survOf: SCENES.reduce((a, id) => a + sc(id, 'infinet').survived.of, 0),
  property: S.property as { runs: number; violations: number; fakeAdmissionFrames: number },
  dupMin: Math.min(...SCENES.map((id) => sc(id, 'infinet').dupExtraPct.mean as number)),
  dupMax: Math.max(...SCENES.map((id) => sc(id, 'infinet').dupExtraPct.mean as number)),
  wronglyBlocked: SCENES.reduce((a, id) => a + (sc(id, 'infinet').wronglyBlocked.mean as number), 0),
};
const lead = S.scenarios['building-exit'].infinet.predLeadS.mean as number;
const falseDeadB3 = S.scenarios['desert-sat'].b3.falseDead.mean as number;
const f1 = (x: number) => x.toFixed(1);

const BUILT = {
  built: [
    'The policy engine: see the edge coming, check before trust, one tunnel, patience on satellite',
    'The trust check: six verdicts, weighted red flags, fails closed',
    ...(cut === 'booth' ? ['This hall, rebuilt and fitted to the 27-point Wi-Fi survey we took on set-up day'] : []),
    `${DATA.runs} runs per scene, a ${DATA.property.runs.toLocaleString('en')}-run attack test, 68 automated tests`,
  ],
  simulated: [
    'Radio: 3GPP TR 38.901 path loss, ITU wall losses',
    'Satellite behaviour from published low-orbit and geostationary measurements',
    'The networks, the anchor server and the attacks',
  ],
  next: [
    'A real WireGuard tunnel with handover, on two phones',
    'The trust check on a phone\'s live Wi-Fi scan',
    'A field trial on a site router with satellite backhaul',
  ],
};

// ───────────── shots ─────────────
type V2 = [number, number];
/** camera: [x, y, h, lookX, lookY, lookH] in engine metres (x east, y north, h up) */
type Cam = number[];
type Cap = { a: number; b: number; k: string; t: string };
type Shot = {
  id: string; scene: string; t0: number; dur: number;
  /** Network Vision on over these [from, to] seconds into the shot (eased 0.6 s); [[-1, 99]] = on throughout */
  vision?: Array<[number, number]>;
  /** the camera at u = 0..1 through the shot, given the walker's position at that frame; omit for the app's follow camera */
  cam?: (u: number, p: V2) => Cam;
  fov?: number | ((u: number) => number);
  hud: 'data' | 'clean';
  chapter?: { a: number; b: number; title: string; sub: string; ar?: string };
  caps: Cap[];
  panels?: [number, number];
  trust?: [number, number];
  at?: Array<{ t: number; js: string }>;
  /** load at this sim time instead, run js, then step (unrecorded) to t0: carries a tap from the shot before over the cut */
  warm?: { from: number; js: string };
};
type Chapter = { id: string; kind: 'chapter'; n: number; top: { title: string; sub: string }; shots: Shot[] };
type Card = { id: string; kind: 'card'; card: string; dur: number; data?: unknown };
type Seg = Chapter | Card;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a: number[], b: number[], u: number) => a.map((v, i) => v + (b[i] - v) * u);
const rad = (d: number) => (d * Math.PI) / 180;
/** a camera on a circle around c (radius r, height h, at bearing deg: 0 = east, 90 = north), looking at c at lookH */
const orbit = (c: V2, r: number, h: number, deg: number, lookH = 1.2): Cam => [c[0] + r * Math.cos(rad(deg)), c[1] + r * Math.sin(rad(deg)), h, c[0], c[1], lookH];
/** a move between two fixed cameras */
const move = (a: Cam, b: Cam) => (u: number) => lerp(a, b, smooth(u));
/** a camera that keeps an offset from the walker (offset and look offset ease from a to b) */
const rel = (a: Cam, b: Cam) => (u: number, p: V2): Cam => { const o = lerp(a, b, smooth(u)); return [p[0] + o[0], p[1] + o[1], o[2], p[0] + o[3], p[1] + o[4], o[5]]; };

const N = cut === 'booth' ? 4 : 3;
const chapterNo = (n: number) => `${String(n).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;

const ch1: Chapter = {
  id: 'ch1-exit', kind: 'chapter', n: 1, top: { title: 'Leaving the building', sub: 'Feature 1 · Sees the drop coming' },
  shots: [
    // demo seed 26: edge seen 17.0, 5G checked 17.1, switch 18.9 (auto slow-mo for 1 s), done 21.0; today's phone frozen 25.9–28.4
    {
      id: 'ch1a', scene: 'building-exit', t0: 12.6, dur: 4.2, vision: [[-1, 99]], hud: 'clean',
      cam: move([24, -16, 34, -10, 12, 0], [17, -9, 21, -6, 11, 0]), fov: 46,
      chapter: { a: 0.15, b: 3.3, title: 'Leaving<br>the building', sub: 'Sees the drop coming.' },
      caps: [],
    },
    {
      id: 'ch1b', scene: 'building-exit', t0: 16.8, dur: 6.8, vision: [[-1, 99]], hud: 'data',
      cam: rel([-9.5, -4.5, 5.2, 4, 1, 0.8], [-7.5, -7.5, 4.2, 4, -1, 0.9]), fov: 50,
      panels: [0.3, 99],
      caps: [{ a: 0.4, b: 6.8, k: 'Sees the drop coming', t: `The Wi-Fi edge is on Infinet's map (${f1(lead)} s early on average). It checks 5G first, then moves the call before the drop.` }],
    },
    {
      id: 'ch1c', scene: 'building-exit', t0: 25.3, dur: 4.6, hud: 'data',
      cam: rel([2.6, -7.5, 1.25, 0, 0, 1.45], [2.2, -5.6, 1.35, 0, 0, 1.5]), fov: 34,
      panels: [-1, 99],
      caps: [{ a: 0.2, b: 4.6, k: 'No freeze', t: `Today's phone waits for the Wi-Fi to die, then freezes: ${f1(DATA.rows[0].b1)} s on average. Infinet's call never stopped.` }],
    },
  ],
};

const ch2: Chapter = {
  id: 'ch2-cafe', kind: 'chapter', n: 2, top: { title: 'The fake café Wi-Fi', sub: 'Feature 2 · Checks before it trusts' },
  shots: [
    // seed 21: the copy starts 21.6 and is Blocked at once; the strongest-signal phone freezes 22.6–26.2, then carries its call over the copy
    {
      id: 'ch2a', scene: 'cafe-twin', t0: 17.2, dur: 4.0, hud: 'clean',
      cam: move([21.5, -119, 2.1, 1, -130, 2.2], [21.5, -124.5, 2.1, 0, -131, 2.0]), fov: 40,
      chapter: { a: 0.15, b: 3.2, title: 'The fake<br>café Wi-Fi', sub: 'We check before we trust.', ar: 'نفحص قبل أن نثق' },
      caps: [],
    },
    {
      id: 'ch2b', scene: 'cafe-twin', t0: 21.0, dur: 6.2, vision: [[-1, 99]], hud: 'data',
      cam: move([15, -114, 14, -1, -133, 0], [17, -122, 10.5, -1, -133, 0.3]), fov: 46,
      panels: [0.2, 99], trust: [0.5, 99],
      caps: [
        { a: 0.3, b: 2.6, k: 'A copy appears', t: 'Someone starts a copy of the café Wi-Fi: same name, a different device, no password, far too strong.' },
        { a: 2.6, b: 6.2, k: 'Blocked', t: 'Three red flags: Blocked. Infinet sends it nothing. The strongest-signal phone freezes, then joins it.' },
      ],
    },
    {
      id: 'ch2c', scene: 'cafe-twin', t0: 27.2, dur: 4.2, vision: [[-1, 99]], hud: 'data',
      cam: rel([-6.5, -2.2, 1.9, 2, 0.5, 1.1], [-5, -3.2, 2.3, 2, 0, 1.0]), fov: 42,
      panels: [-1, 99], trust: [-1, 99],
      caps: [{ a: 0.2, b: 4.2, k: 'Nothing sent', t: 'The strongest-signal phone now sends the call through the copy. Infinet stays on checked 5G.' }],
    },
  ],
};

const DESERT: V2 = [12004, -1];
const ch3: Chapter = {
  id: 'ch3-desert', kind: 'chapter', n: 3, top: { title: 'The desert site', sub: 'Satellite only · patient, not panicked' },
  shots: [
    // seed 16: low-orbit outage 79.0, both calls freeze 79.3; Infinet live again 85.1, the fixed-timeout tunnel keeps flapping
    {
      id: 'ch3a', scene: 'desert-sat', t0: 73.6, dur: 4.0, hud: 'clean',
      cam: move([12016.5, -13.5, 1.8, 12001, 2, 2.3], [12013.5, -16, 2.3, 12001, 1, 2.1]), fov: 40,
      chapter: { a: 0.15, b: 3.2, title: 'The desert<br>site', sub: 'Satellite is the only way out.' },
      caps: [],
    },
    {
      id: 'ch3b', scene: 'desert-sat', t0: 77.6, dur: 4.6, vision: [[-1, 99]], hud: 'data',
      cam: (u) => orbit(DESERT, 17 - 2 * smooth(u), 7.5, 292 + 26 * smooth(u), 1.0), fov: 48,
      panels: [0.2, 99],
      caps: [{ a: 0.3, b: 4.6, k: 'The link drops', t: 'The low-orbit satellite link is blocked. Both calls freeze while the router falls back to a geostationary one.' }],
    },
    {
      id: 'ch3c', scene: 'desert-sat', t0: 82.2, dur: 5.0, vision: [[-1, 99]], hud: 'data',
      cam: (u, p) => orbit(p, 9.5 - 1.5 * smooth(u), 4.2 - 0.8 * smooth(u), 18 + 30 * smooth(u), 1.6), fov: 42,
      panels: [-1, 99],
      caps: [{ a: 0.2, b: 5.0, k: 'Patient on satellite', t: `A 600 ms round trip is normal on this link, so Infinet holds the call. The fixed-timeout tunnel calls it dead about ${Math.round(falseDeadB3)} times a call.` }],
    },
  ],
};

const ch4: Chapter = {
  id: 'ch4-hall', kind: 'chapter', n: 4, top: { title: 'This hall', sub: 'Measured on set-up day' },
  shots: [
    // hall, seed 5: sign-in tapped at 7.5 (the tour's moment), trust.tunnel 8.3, switch 10.3, done 12.7
    {
      id: 'ch4a', scene: 'venue-hall', t0: 1, dur: 4.0, vision: [[-1, 99]], hud: 'clean',
      cam: move([40104, -27, 12.2, 40046, 6, 0], [40084, -27, 9.8, 40034, -4, 0]), fov: 50,
      chapter: { a: 0.15, b: 3.2, title: 'This hall,<br>as measured', sub: 'Rebuilt from the floor plan, fitted to our own Wi-Fi survey.' },
      caps: [],
    },
    {
      id: 'ch4b', scene: 'venue-hall', t0: 5.0, dur: 4.4, vision: [[-1, 99]], hud: 'data',
      at: [{ t: 2.5, js: 'globalThis.__infinet.driver.signIn()' }],
      cam: rel([-3.5, 5.5, 5.8, 5, -2, 0.6], [-4, 4.5, 4.8, 5, -2.5, 0.7]), fov: 50,
      panels: [0.2, 99], trust: [0.4, 99],
      caps: [
        { a: 0.3, b: 2.6, k: 'Wi-Fi first, checked', t: 'The venue Wi-Fi shows a sign-in page, so the call stays on 4G. Only that page may open, in a sandbox.' },
        { a: 2.6, b: 4.4, k: 'Signed in', t: 'Infinet checks the network again before it trusts it.' },
      ],
    },
    {
      id: 'ch4c', scene: 'venue-hall', t0: 9.4, dur: 4.6, vision: [[-1, 99]], hud: 'data',
      warm: { from: 7.5, js: 'globalThis.__infinet.driver.signIn()' },
      cam: (u, p) => orbit(p, 13, 8 - 1.5 * smooth(u), 300 + 25 * smooth(u), 0.8), fov: 46,
      panels: [-1, 99], trust: [-1, 99],
      caps: [{ a: 0.2, b: 4.6, k: 'Moves the call', t: 'The call moves onto the venue Wi-Fi. The 20 or so phone hotspots heard here are never joined.' }],
    },
  ],
};

const SEGS: Seg[] = [
  { id: 'c1-title', kind: 'card', card: 'title', dur: 4.5 },
  { id: 'c2-idea', kind: 'card', card: 'idea', dur: 8.5 },
  ch1, ch2, ch3,
  ...(cut === 'booth' ? [ch4] : []),
  { id: 'c3-results', kind: 'card', card: 'results', dur: 11.5, data: DATA },
  { id: 'c4-built', kind: 'card', card: 'built', dur: 7, data: BUILT },
  { id: 'c5-end', kind: 'card', card: 'end', dur: 6 },
  // back to the title card at rest: the last frame is the first frame, so the booth screen loops without a jump
  { id: 'c6-loop', kind: 'card', card: 'title', dur: 1.2, data: { hold: true } },
];

// ───────────── capture ─────────────
const STEP = (dt: number) => `(() => { const g = globalThis; const d = g.__infinet.driver; g.__infinetPaused = false; d.tick(${dt}); g.__infinetPaused = true; return d.snap.player.pos; })()`;
const POS = `globalThis.__infinet.driver.snap.player.pos`;
const SETTLE = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))`;

function visionAt(s: Shot, t: number): number {
  let k = 0;
  for (const [a, b] of s.vision ?? []) k = Math.max(k, Math.min(smooth((t - a) / 0.6), 1 - smooth((t - b) / 0.6)));
  return k;
}
const fovAt = (s: Shot, u: number) => (typeof s.fov === 'function' ? s.fov(u) : s.fov ?? 52);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shotPng = (dir: string, i: number) => join(dir, `${String(i).padStart(5, '0')}.png`);

/** frames to keep: all of them, or three per shot for the storyboard */
const keepFrame = (i: number, n: number) => !board || i === 0 || i === Math.floor(n / 2) || i === n - 1;

async function shootShot(ch: Chapter, s: Shot, dir: string) {
  const q = `scene=${s.scene}&pause=1&t=${s.warm?.from ?? s.t0}${cut === 'public' ? '&public=1' : ''}`;
  await page.goto(`${base}/?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(`!document.querySelector('.loader')`, null, { timeout: 120000 }).catch(() => {});
  const k0 = visionAt(s, 0);
  await page.evaluate(`(() => { const g = globalThis; g.__infinet.driver.idleS = 1e9; g.__infinetVisionK = ${k0}; g.__infinetFov = ${fovAt(s, 0)};
    g.__infinet.useUi.setState({ vision: ${k0 > 0.5} }); })()`);
  if (s.warm) {
    await page.evaluate(s.warm.js);
    for (let i = Math.round((s.t0 - s.warm.from) * fps); i > 0; i--) await page.evaluate(STEP(1 / fps));
  }
  await page.addScriptTag({ type: 'module', url: `${base}/tools/film/overlay.ts` });
  await page.waitForFunction('!!globalThis.__film', null, { timeout: 60000 });
  const setup = {
    hud: s.hud, caps: s.caps, panels: s.panels, trust: s.trust,
    top: { n: String(ch.n).padStart(2, '0'), title: ch.top.title, sub: ch.top.sub },
    chapter: s.chapter ? { ...s.chapter, n: chapterNo(ch.n) } : undefined,
  };
  await page.evaluate(`globalThis.__film.setup(${JSON.stringify(setup)})`);
  const n = Math.round(s.dur * fps), todo = [...(s.at ?? [])];
  let p = (await page.evaluate(POS)) as V2;
  if (s.cam) await page.evaluate(`globalThis.__infinetCam = ${JSON.stringify(s.cam(0, p))}`);
  await page.waitForTimeout(2500); // the label layer and shadows settle
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = i / fps, u = i / Math.max(1, n - 1);
    while (todo.length && todo[0].t <= t) await page.evaluate(todo.shift()!.js);
    if (i > 0) p = (await page.evaluate(STEP(1 / fps))) as V2;
    const k = visionAt(s, t);
    await page.evaluate(`(() => { const g = globalThis; g.__infinetVisionK = ${k}; g.__infinetFov = ${fovAt(s, u)};
      if ((${k} > 0.5) !== g.__infinet.useUi.getState().vision) g.__infinet.useUi.setState({ vision: ${k} > 0.5 });
      ${s.cam ? `g.__infinetCam = ${JSON.stringify(s.cam(u, p))};` : ''} g.__film.frame(${t}); })()`);
    if (!keepFrame(i, n)) continue;
    await page.evaluate(SETTLE);
    await page.screenshot({ path: shotPng(dir, i), type: 'png' });
    if ((i + 1) % (fps * 3) === 0) console.log(`  ${s.id}  ${i + 1}/${n}  ·  ${((Date.now() - t0) / (i + 1)).toFixed(0)} ms/frame`);
  }
  await page.evaluate(`(() => { delete globalThis.__infinetVisionK; delete globalThis.__infinetCam; delete globalThis.__infinetFov; })()`);
}

async function shootCard(c: Card, dir: string) {
  if (!page.url().includes('/tools/film/cards.html')) {
    await page.goto(`${base}/tools/film/cards.html`, { waitUntil: 'load' });
    await page.waitForFunction('!!globalThis.__card', null, { timeout: 60000 });
    await page.evaluate('globalThis.__card.ready()');
  }
  await page.evaluate(`globalThis.__card.show(${JSON.stringify(c.card)}, ${JSON.stringify({ ...((c.data as object) ?? {}), cut, N })})`);
  await page.evaluate(SETTLE);
  const n = Math.round(c.dur * fps);
  for (let i = 0; i < n; i++) {
    if (!keepFrame(i, n)) continue;
    await page.evaluate(`globalThis.__card.render(${i / fps}, ${c.dur})`);
    await page.screenshot({ path: shotPng(dir, i), type: 'png' });
  }
}

/** encode a folder of PNG frames: BT.709, TV range, so every player reads the colours the same way */
function encode(dir: string, out: string) {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, '%05d.png'),
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-crf', '12', '-preset', 'medium',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', out]);
}

const segFile = (id: string) => join(work, `${id}.mp4`);
type Unit = { seg: Seg; shot?: Shot };
const units: Unit[] = SEGS.flatMap((g): Unit[] => (g.kind === 'chapter' ? g.shots.map((shot) => ({ seg: g, shot })) : [{ seg: g }]));
const boardTiles: string[] = [];
for (const { seg, shot } of units) {
  const id = shot ? shot.id : seg.id;
  const picked = only.includes(id) || only.includes(seg.id);
  if (!board && only.length && !picked && existsSync(segFile(id))) continue;
  if (board && only.length && !picked) continue;
  const dir = join(work, 'frames', id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  if (shot) await shootShot(seg as Chapter, shot, dir);
  else await shootCard(seg as Card, dir);
  if (board) { for (const f of readdirSync(dir).sort()) boardTiles.push(join(dir, f)); console.log(`${id}: stills`); continue; }
  encode(dir, segFile(id));
  console.log(`${id}: ${readdirSync(dir).length} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].slice(0, 10).join('\n'));

if (board) {
  // a contact sheet, three stills per shot (start, middle, end), 640 px wide each
  const sheet = resolve(`results/cinematic/board-${cut}${only.length ? '-' + only.join('_') : ''}.jpg`);
  const ins = boardTiles.flatMap((f) => ['-i', f]);
  const layout = boardTiles.map((_, i) => `${(i % 3) * 640}_${Math.floor(i / 3) * 360}`).join('|');
  const scaled = boardTiles.map((_, i) => `[${i}:v]scale=640:360[s${i}]`).join(';');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...ins, '-filter_complex',
    `${scaled};${boardTiles.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${boardTiles.length}:layout=${layout}:fill=black[o]`,
    '-map', '[o]', '-frames:v', '1', '-q:v', '3', sheet]);
  console.log(`board: ${sheet}`);
  process.exit(0);
}

// ───────────── join ─────────────
// shots inside a chapter: hard cuts (concat). Chapters and cards: a wipe of signal cells with a Violet edge, made as
// its own short clip (the last WF frames of one part over the first WF of the next), then everything is concatenated.
const frames = (d: number) => Math.round(d * fps);
const WF = frames(WIPE);
const ff = (a: string[]) => execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...a]);
const TAGS = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
const parts: Array<{ file: string; n: number }> = [];
for (const g of SEGS) {
  if (g.kind === 'card') { parts.push({ file: segFile(g.id), n: frames(g.dur) }); continue; }
  const list = join(work, `${g.id}.txt`);
  writeFileSync(list, g.shots.map((s) => `file '${segFile(s.id)}'`).join('\n'));
  const out = segFile(g.id);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  parts.push({ file: out, n: g.shots.reduce((a, s) => a + frames(s.dur), 0) });
}
// the wipe's masks, once: 48 px cells switch over left to right with some scatter; the cells at the edge show Violet
const CELL = 48;
const cx = `floor(X/${CELL})`, cy = `floor(Y/${CELL})`, hs = `sin(${cx}*12.9898+${cy}*78.233)*43758.5453`;
const TH = `(0.7*${cx}/${1920 / CELL}+0.3*(${hs}-floor(${hs})))`, Q = `(N/${WF - 1}*1.16-0.08)`;
const maskFile = join(work, 'wipe-mask.mkv'), edgeFile = join(work, 'wipe-edge.mkv');
for (const [file, e] of [[maskFile, `if(gt(${Q},${TH}),255,0)`], [edgeFile, `if(gt(${Q},${TH}-0.08)*lte(${Q},${TH}),255,0)`]]) {
  ff(['-f', 'lavfi', '-i', `color=c=black:s=1920x1080:r=${fps}:d=${WIPE},format=gray`, '-vf', `geq=lum='${e}'`, '-frames:v', String(WF), '-c:v', 'ffv1', file]);
}
const wipes: string[] = [];
for (let i = 1; i < parts.length; i++) {
  const out = join(work, `wipe-${i}.mp4`);
  ff(['-i', parts[i - 1].file, '-i', parts[i].file, '-i', maskFile, '-i', edgeFile, '-filter_complex',
    `[0:v]trim=start_frame=${parts[i - 1].n - WF},setpts=PTS-STARTPTS,format=gbrp[a];[1:v]trim=end_frame=${WF},setpts=PTS-STARTPTS,format=gbrp[b];` +
    `[2:v]format=gbrp[m];[3:v]format=gbrp[e];color=c=0x730FFF:s=1920x1080:r=${fps}:d=${WIPE},format=gbrp[v];` +
    `[a][b][m]maskedmerge[ab];[ab][v][e]maskedmerge,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[o]`,
    '-map', '[o]', '-frames:v', String(WF), '-c:v', 'libx264', '-crf', '12', '-preset', 'medium', ...TAGS, out]);
  wipes.push(out);
}
// everything in order: part 0, wipe 1, part 1, wipe 2 … each part trimmed where its wipes take over
const ins = [...parts.map((p) => p.file), ...wipes].flatMap((f) => ['-i', f]);
const fg: string[] = [];
const order: string[] = [];
parts.forEach((p, i) => {
  const a = i > 0 ? WF : 0, b = p.n - (i < parts.length - 1 ? WF : 0);
  fg.push(`[${i}:v]trim=start_frame=${a}:end_frame=${b},setpts=PTS-STARTPTS[p${i}]`);
  if (i > 0) { fg.push(`[${parts.length + i - 1}:v]setpts=PTS-STARTPTS[w${i}]`); order.push(`[w${i}]`); }
  order.push(`[p${i}]`);
});
fg.push(`${order.join('')}concat=n=${order.length}:v=1:a=0,format=yuv420p[out]`);
mkdirSync(dirname(outFile), { recursive: true });
ff([...ins, '-filter_complex', fg.join(';'), '-map', '[out]', '-c:v', 'libx264', '-preset', 'slow', '-crf', cut === 'public' ? '21' : '18',
  ...TAGS, '-r', String(fps), '-movflags', '+faststart', outFile]);
const total = (parts.reduce((a, p) => a + p.n, 0) - (parts.length - 1) * WF) / fps;
console.log(`${outFile}: ${total.toFixed(1)} s, ${(statSync(outFile).size / 1e6).toFixed(1)} MB`);
if (errors.length) process.exitCode = 1;
