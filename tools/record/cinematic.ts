/**
 * Deterministic cinematic capture (plan §0.2 / booth backup video).
 *   npm run dev   (in another terminal)   then
 *   npm run cinematic [-- --fps 30 --scenes building-exit:34,cafe-twin:40,desert-sat:97 --from 0 --out results/cinematic]
 *
 * Each frame steps the SAME per-frame driver logic by exactly 1/fps of real time (so slow-mo plays as slow-mo),
 * waits for the renderer and the label layer, then screenshots. Frames are JPEG; ffmpeg (if on PATH) encodes
 * one MP4 per scene plus infinet-cinematic.mp4. No audio: the voice is a placeholder until the teammate recording.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = arg('url', 'http://localhost:5173');
const out = resolve(arg('out', 'results/cinematic'));
const fps = Number(arg('fps', '30'));
const from = Number(arg('from', '0'));
const extra = arg('query', ''); // e.g. view=truth
const scenes = arg('scenes', 'building-exit:34,cafe-twin:40,desert-sat:97').split(',').map((s) => {
  const [sc, until] = s.split(':');
  return { sc, until: Number(until) };
});

function cachedChromium(): string | undefined {
  const dir = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(dir)) return undefined;
  for (const d of readdirSync(dir).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const exe = join(dir, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const launchArgs = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: launchArgs }).catch(() => chromium.launch({ args: launchArgs, executablePath: cachedChromium() }));
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));

// evaluate takes strings (tsx would inject its __name helper into function bodies)
const STEP = (dt: number) => `(() => {
  const g = globalThis; const d = g.__infinet.driver;
  g.__infinetPaused = false; d.tick(${dt}); g.__infinetPaused = true;
  return d.sim.t;
})()`;
const SETTLE = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))`;

mkdirSync(out, { recursive: true });
const made: string[] = [];
for (const { sc, until } of scenes) {
  const dir = join(out, 'frames', sc);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const q = `scene=${sc}&pause=1${from ? `&t=${from}` : ''}${extra ? `&${extra}` : ''}`;
  await page.goto(`${base}/?${q}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(`(() => { globalThis.__infinet.driver.idleS = 1e9; })()`); // never fall into attract mode
  let n = 0, t = from;
  const t0 = Date.now();
  while (t < until && n < fps * 600) {
    t = (await page.evaluate(STEP(1 / fps))) as number;
    await page.evaluate(SETTLE);
    await page.screenshot({ path: join(dir, `${String(n).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    n++;
    if (n % (fps * 5) === 0) console.log(`${sc}  sim t = ${t.toFixed(1)} s  ·  ${n} frames  ·  ${((Date.now() - t0) / n).toFixed(0)} ms/frame`);
  }
  console.log(`${sc}: ${n} frames`);
  if (hasFfmpeg) {
    const mp4 = join(out, `${sc}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, '%05d.jpg'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', mp4]);
    made.push(mp4);
    console.log('encoded', mp4);
  }
}
await browser.close();

if (hasFfmpeg && made.length > 1) {
  const list = join(out, 'concat.txt');
  writeFileSync(list, made.map((m) => `file '${m}'`).join('\n') + '\n');
  const all = join(out, 'infinet-cinematic.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', all]);
  console.log('encoded', all);
} else if (!hasFfmpeg) {
  console.log(`ffmpeg not found: frames are in ${join(out, 'frames')}. Encode with:\n  ffmpeg -framerate ${fps} -i <scene>/%05d.jpg -c:v libx264 -pix_fmt yuv420p -crf 18 <scene>.mp4`);
}
if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
