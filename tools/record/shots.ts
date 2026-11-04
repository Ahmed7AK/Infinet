/**
 * Visual verification (plan §0.2): deterministic screenshots of the key beats at 1920 × 1080.
 *   npm run dev   (in another terminal)   then   npm run shots [-- --url http://localhost:5173 --out results/shots]
 * Each shot loads ?scene=…&t=… which fast-forwards the same per-frame logic, then pauses.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const base = arg('url', 'http://localhost:5173');
const out = arg('out', 'results/shots');
const only = arg('only', '');
mkdirSync(out, { recursive: true });

const SHOTS: Array<{ name: string; q: string }> = [
  { name: '01-exit-start', q: 'scene=building-exit&t=4' },
  { name: '02-exit-edge', q: 'scene=building-exit&t=15.5' },
  { name: '03-exit-switch', q: 'scene=building-exit&t=17.5' },
  { name: '04-exit-outside', q: 'scene=building-exit&t=27' },
  { name: '05-exit-truth', q: 'scene=building-exit&t=15.5&view=truth' },
  { name: '06-exit-stale', q: 'scene=building-exit&t=17&stale=0.8' },
  { name: '07-cafe-copy', q: 'scene=cafe-twin&t=22.6' },
  { name: '08-cafe-blocked', q: 'scene=cafe-twin&t=26&view=truth' },
  { name: '09-cafe-shield', q: 'scene=cafe-twin&t=32&app=4' },
  { name: '10-desert-pattern', q: 'scene=desert-sat&t=70&app=0' },
  { name: '11-desert-geo', q: 'scene=desert-sat&t=88' },
  { name: '12-phone-home', q: 'scene=building-exit&t=6&app=home' },
  { name: '13-lab', q: 'scene=building-exit&t=6&app=5' },
  { name: '14-error-view', q: 'scene=building-exit&t=6&view=error&stale=0.6' },
];

/** Use Playwright's own browser if present, else any Chromium already in the Playwright cache (no download). */
function cachedChromium(): string | undefined {
  const dir = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(dir)) return undefined;
  for (const d of readdirSync(dir).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const exe = join(dir, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}
const launchArgs = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: launchArgs }).catch(() => chromium.launch({ args: launchArgs, executablePath: cachedChromium() }));
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
for (const s of SHOTS) {
  if (only && !s.name.includes(only)) continue;
  await page.goto(`${base}/?${s.q}&pause=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${s.name}.png`) });
  console.log('shot', s.name);
}
await browser.close();
if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
