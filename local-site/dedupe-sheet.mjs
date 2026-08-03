/**
 * Deduplicate a folder of client screenshots by content hash, then emit
 * numbered contact sheets so each one can be read and transcribed by eye.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';

const DIR = process.argv[2];
const OUT = process.argv[3];
const PER_SHEET = Number(process.argv[4] || 6);
const COLS = Number(process.argv[5] || 3);
fs.mkdirSync(OUT, { recursive: true });

const seen = new Map();
const files = fs.readdirSync(DIR).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();
for (const f of files) {
  const buf = fs.readFileSync(path.join(DIR, f));
  const h = crypto.createHash('md5').update(buf).digest('hex');
  if (seen.has(h)) { console.log(`dup  ${f}  == ${seen.get(h)}`); continue; }
  seen.set(h, f);
}
const uniq = [...seen.values()];
console.log(`\n${files.length} files, ${uniq.length} unique`);
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(uniq, null, 2));

const b = await chromium.launch({ });
const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });

for (let i = 0, n = 0; i < uniq.length; i += PER_SHEET, n++) {
  const batch = uniq.slice(i, i + PER_SHEET);
  const html = `<!doctype html><meta charset=utf-8><style>
    body{margin:0;background:#111;font:12px system-ui;color:#ddd}
    .g{display:grid;grid-template-columns:repeat(${COLS},1fr);gap:8px;padding:8px}
    figure{margin:0;background:#000;border:1px solid #444}
    figcaption{padding:4px 6px;font-family:monospace;font-size:11px;background:#222;color:#7fe}
    img{width:100%;height:620px;object-fit:contain;display:block;background:#fff}
  </style><div class=g>${batch.map((f, k) =>
    `<figure><figcaption>[${i + k}] ${f}</figcaption><img src="${pathToFileURL(path.join(DIR, f)).href}"></figure>`).join('')}</div>`;
  const h = path.join(OUT, `_s${n}.html`);
  fs.writeFileSync(h, html);
  await p.goto(pathToFileURL(h).href);
  await p.waitForTimeout(900);
  await p.screenshot({ path: path.join(OUT, `sheet${String(n).padStart(2, '0')}.png`), fullPage: true });
  console.log(`sheet${String(n).padStart(2, '0')}.png  ->  [${i}..${i + batch.length - 1}]`);
}
await b.close();
