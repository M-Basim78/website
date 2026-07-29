// Contact sheet of a folder of images, for picking one by eye.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const DIR = process.argv[2];
const COLS = Number(process.argv[3] || 6);
const files = fs.readdirSync(DIR)
  .filter(f => /\.(jpg|png|webp)$/i.test(f) && !f.startsWith('sheet')).sort();
const html = `<!doctype html><meta charset=utf-8><style>
 body{margin:0;background:#222;font:11px system-ui;color:#ccc}
 .g{display:grid;grid-template-columns:repeat(${COLS},1fr);gap:6px;padding:6px}
 figure{margin:0;background:#111}
 figcaption{padding:3px 5px;font-family:monospace;font-size:10px}
 img{width:100%;height:170px;object-fit:contain;background:#000;display:block}
</style><div class=g>
${files.map(f => `<figure><img src="${pathToFileURL(path.join(DIR, f)).href}" loading="eager"><figcaption>${f}</figcaption></figure>`).join('')}
</div>`;
const h = path.join(DIR, '_sheet.html');
fs.writeFileSync(h, html);
const b = await chromium.launch({ executablePath: String.raw`C:\Users\Basim\AppData\Local\ms-playwright\chromium-1187\chrome-win\chrome.exe` });
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await p.goto(pathToFileURL(h).href);
await p.waitForTimeout(2500);
await p.screenshot({ path: path.join(DIR, 'sheet.png'), fullPage: true });
await b.close();
console.log('sheet.png with', files.length, 'images');
