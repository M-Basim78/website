// Section-by-section capture of the rebuilt page at a given width, tiled for review.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const W = Number(process.argv[2] || 390);
const H = Number(process.argv[3] || 844);
const OUT = process.argv[4];
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: String.raw`C:\Users\Basim\AppData\Local\ms-playwright\chromium-1187\chrome-win\chrome.exe` });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await p.goto('http://localhost:8123/new', { waitUntil: 'networkidle' });
await p.evaluate(() => {
  document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
  document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; });
});
await p.evaluate(() => Promise.all([...document.images].filter(i => !i.complete)
  .map(i => new Promise(r => { i.onload = i.onerror = r; }))));

const total = await p.evaluate(() => document.body.scrollHeight);
const shots = [];
for (let y = 0, n = 0; y < total; y += H, n++) {
  await p.evaluate(v => window.scrollTo(0, v), y);
  await p.waitForTimeout(320);
  const f = path.join(OUT, `s${String(n).padStart(2, '0')}.png`);
  await p.screenshot({ path: f });
  shots.push(f);
}

const html = `<!doctype html><meta charset=utf-8><style>
 body{margin:0;background:#181818;font:11px system-ui;color:#bbb}
 .g{display:grid;grid-template-columns:repeat(${W > 500 ? 3 : 5},1fr);gap:8px;padding:8px}
 img{width:100%;display:block;border:1px solid #444}
</style><div class=g>${shots.map(s => `<img src="${pathToFileURL(s).href}">`).join('')}</div>`;
const h = path.join(OUT, '_tiles.html');
fs.writeFileSync(h, html);
await p.setViewportSize({ width: W > 500 ? 1500 : 1500, height: 900 });
await p.goto(pathToFileURL(h).href);
await p.waitForTimeout(700);
await p.screenshot({ path: path.join(OUT, 'tiles.png'), fullPage: true });
await b.close();
console.log('sections:', shots.length, '->', path.join(OUT, 'tiles.png'));
