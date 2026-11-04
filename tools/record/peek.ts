/** Quick look while building: npx tsx tools/record/peek.ts <out-dir> <query> [<query>...]  (HUD hidden with hud=0 in the query) */
import { join } from 'node:path';
import { launch } from './browser';
const [out, ...qs] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`); });
let i = 0;
for (const q of qs) {
  await page.goto(`http://localhost:5173/?${q}&pause=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  if (q.includes('hud=0')) await page.addStyleTag({ content: '.stage{display:none!important}' });
  await page.waitForTimeout(300);
  const f = join(out, `${String(++i).padStart(2, '0')}.png`);
  await page.screenshot({ path: f });
  console.log(f, q);
}
await browser.close();
console.log([...new Set(errs)].slice(0, 20).join('\n'));
