// Capture the duality panel alone and report how well the two halves balance.
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ });

for (const w of [390, 768, 1280, 1920]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  await p.goto('http://localhost:8123/new', { waitUntil: 'networkidle' });
  await p.evaluate(() => {
    document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
    document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; });
  });
  await p.evaluate(() => Promise.all([...document.images].filter(i => !i.complete)
    .map(i => new Promise(r => { i.onload = i.onerror = r; }))));
  await p.waitForTimeout(500);

  const el = await p.$('.dual-panel');
  await el.screenshot({ path: path.join(OUT, `duality-${w}.png`) });
  const a = await (await p.$('.half.pt')).boundingBox();
  const c = await (await p.$('.half.dr')).boundingBox();
  console.log(`${String(w).padStart(4)}px  sideA ${Math.round(a.height)}  sideB ${Math.round(c.height)}  imbalance ${Math.round(Math.abs(a.height - c.height))}px`);
  await p.close();
}
await b.close();
