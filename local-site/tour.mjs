// Grab an above-the-fold view of several pages and tile them into one image.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const OUT = process.argv[2];
const PAGES = [
  ['/', 'Home'], ['/about-me', 'About Me'], ['/store', 'Store'],
  ['/podcast', 'Podcast'], ['/resources', 'Resources'], ['/my-work', 'My Work'],
];
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });

const tiles = [];
for (const [route, label] of PAGES) {
  const page = await ctx.newPage();
  await page.goto(`http://localhost:8123${route}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const f = path.join(OUT, `tour-${label.replace(/\W+/g, '-')}.png`);
  await page.screenshot({ path: f });          // viewport only, above the fold
  tiles.push({ f, label, route });
  await page.close();
  console.log('captured', route);
}

const html = `<!doctype html><meta charset=utf-8><style>
  body{margin:0;background:#1a1a1a;font:13px system-ui;color:#ddd}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px}
  figure{margin:0}
  figcaption{padding:5px 8px;background:#000;font-weight:600}
  img{width:100%;display:block;border:1px solid #444;border-top:0}
</style><div class=grid>
${tiles.map(t => `<figure><figcaption>${t.label} &nbsp;<span style="opacity:.5;font-weight:400">localhost:8123${t.route}</span></figcaption><img src="${pathToFileURL(t.f).href}"></figure>`).join('\n')}
</div>`;
const f = path.join(OUT, '_tour.html');
fs.writeFileSync(f, html);
const p = await ctx.newPage();
await p.setViewportSize({ width: 1600, height: 1000 });
await p.goto(pathToFileURL(f).href);
await p.waitForTimeout(800);
await p.screenshot({ path: path.join(OUT, 'tour.png'), fullPage: true });
console.log('wrote', path.join(OUT, 'tour.png'));
await browser.close();
