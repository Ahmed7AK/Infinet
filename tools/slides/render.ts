// Renders a slide file in tools/slides/ to PNGs (3840 × 2160, one per slide) and one PDF.
// Usage: node_modules/.bin/tsx tools/slides/render.ts [deck | judges-extra]   (default: judges-extra)
//   deck          → results/slides/deck/        (the full deck, PNG names from each slide's data-name)
//   judges-extra  → results/slides/             (the three extra slides)
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../record/browser';

const which = process.argv[2] ?? 'judges-extra';
const src = pathToFileURL(resolve(`tools/slides/${which}.html`)).href;
const out = resolve(which === 'deck' ? 'results/slides/deck' : 'results/slides');
const pdfName = which === 'deck' ? 'infinet-deck.pdf' : 'infinet-extra-slides.pdf';
const fallbackNames = ['a-related-work', 'b-qos-guidelines', 'c-ai-use'];
mkdirSync(out, { recursive: true });

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await page.goto(src);
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));
});

const slides = await page.$$('section.slide');
for (const [i, el] of slides.entries()) {
  const name = (await el.getAttribute('data-name')) ?? fallbackNames[i] ?? String(i + 1);
  await el.screenshot({ path: `${out}/slide-${name}.png` });
}
await page.pdf({ path: `${out}/${pdfName}`, width: '1920px', height: '1080px', printBackground: true });
await browser.close();
console.log(`wrote ${slides.length} slides to ${out}`);
