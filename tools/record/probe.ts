/** npx tsx tools/record/probe.ts "<query>" "<js expression>" : evaluate in the running app (dev aid) */
import { launch } from './browser';
const [q, expr] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`http://localhost:5173/?${q}&pause=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
await browser.close();
