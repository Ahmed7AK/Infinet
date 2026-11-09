/**
 * Booth QA (plan §17), against the production build served locally (npm run build && npm run preview):
 *  1. offline: every request must be to the local server (fonts bundled, no CDN)
 *  2. no page errors
 *  3. Tour runs through all three scenes in order; attract mode starts after idle (shortened via ?idle=)
 *   npm run qa [-- --url http://localhost:4173]
 */
import { launch } from './browser';

const args = process.argv.slice(2);
const base = (() => { const i = args.indexOf('--url'); return i >= 0 ? args[i + 1] : 'http://localhost:4173'; })();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const origin = new URL(base).origin;
const external: string[] = [];
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  external.push(u);
  return route.abort();
});
const page = await ctx.newPage();
const errors: string[] = [];
const missing: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
let ok = true;
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' · ' + detail : ''}`); ok &&= cond; };

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
// string-evaluated (tsx would inject helpers into functions passed to the page)
const fonts = await page.evaluate(`(async () => { const fs = [['600', 'Inter'], ['400', 'Inter'], ['500', 'JetBrains Mono']]; for (const [w, f] of fs) await document.fonts.load(w + ' 20px "' + f + '"'); return fs.map(([w, f]) => document.fonts.check(w + ' 20px "' + f + '"')); })()`) as boolean[];
check('fonts bundled and loaded', fonts.every(Boolean), JSON.stringify(fonts));
const fps = await page.evaluate(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); })`) as number;
check('frame rate (headless, indicative)', fps > 20, `${fps.toFixed(0)} fps`);

// Network Vision: N on, Shift+N cycles the view, N off
const ui = (k: string) => page.evaluate(`globalThis.__infinet.useUi.getState().${k}`);
await page.keyboard.press('KeyN');
await page.waitForTimeout(800);
check('N turns Network Vision on', (await ui('vision')) === true);
await page.keyboard.press('Shift+KeyN');
await page.waitForTimeout(300);
check('Shift+N shows the true signal', (await ui('view')) === 'truth');
await page.keyboard.press('Shift+KeyN');
await page.keyboard.press('Shift+KeyN');
await page.keyboard.press('KeyN');
await page.waitForTimeout(800);
check('N turns it off again', (await ui('vision')) === false && (await ui('view')) === 'belief');

// Tour: T, then scene order
await page.keyboard.press('KeyT');
const sceneAt = async () => page.evaluate(() => (globalThis as any).__infinet.useUi.getState().scenario as string);
const modeAt = async () => page.evaluate(() => (globalThis as any).__infinet.useUi.getState().mode as string);
await page.waitForTimeout(2000);
check('tour starts in the office', (await sceneAt()) === 'building-exit' && (await modeAt()) === 'tour');
// jump the tour forward deterministically
await page.evaluate(() => (globalThis as any).__infinet.driver.fastForward(34.2));
await page.waitForTimeout(1500);
check('tour moves on to the café', (await sceneAt()) === 'cafe-twin');
await page.evaluate(() => (globalThis as any).__infinet.driver.fastForward(40.2));
await page.waitForTimeout(1500);
check('tour moves on to the desert', (await sceneAt()) === 'desert-sat');
await page.evaluate(() => (globalThis as any).__infinet.driver.fastForward(97.2));
await page.waitForTimeout(1500);
if ((await sceneAt()) === 'venue-hall') {
  // booth build: the tour ends in our hall and signs in to the venue Wi-Fi itself
  check('tour moves on to our hall (booth build)', true);
  await page.evaluate(() => (globalThis as any).__infinet.driver.fastForward(14));
  await page.waitForTimeout(500);
  const path = await page.evaluate(`globalThis.__infinet.useUi.getState().snap.policies.infinet.activePath`);
  check('the tour signs in and the call moves onto the venue Wi-Fi', path === 'wifi:venue-free', String(path));
  await page.evaluate(() => (globalThis as any).__infinet.driver.fastForward(30.2));
  await page.waitForTimeout(1500);
}
check('tour ends back in free roam', (await modeAt()) === 'free');

// Attract: shorten the idle timer
await page.evaluate(() => { (globalThis as any).__infinet.driver.idleS = 2; });
await page.waitForTimeout(3500);
check('attract mode after idle', (await modeAt()) === 'attract');
await page.keyboard.press('KeyX');
await page.waitForTimeout(1200);
check('any key leaves attract mode', (await modeAt()) === 'free');

check('every asset loads (no 4xx)', missing.length === 0, missing.slice(0, 5).join(' '));
check('offline: no external requests', external.length === 0, external.slice(0, 5).join(' '));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exitCode = ok ? 0 : 1;
