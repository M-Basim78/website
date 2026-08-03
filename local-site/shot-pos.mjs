// Viewport captures at specific scroll positions, to check dock clearance.
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const W = Number(process.argv[2] || 390);
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ });
const p = await b.newPage({ viewport: { width: W, height: 844 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:8123/new', { waitUntil: 'networkidle' });
await p.evaluate(() => {
  document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
  document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; });
});
await p.evaluate(() => Promise.all([...document.images].filter(i => !i.complete)
  .map(i => new Promise(r => { i.onload = i.onerror = r; }))));

for (const [name, fn] of [
  ['01-initial', () => 0],
  ['02-bottom', () => document.documentElement.scrollHeight],
]) {
  await p.evaluate((f) => window.scrollTo({ top: eval(f)(), behavior: 'instant' }), fn.toString());
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, `${W}-${name}.png`) });
}
console.log('ok', OUT);
await b.close();
