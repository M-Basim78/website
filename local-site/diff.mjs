// Build a side-by-side image of the local rebuild vs. the archived screenshot.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const LOCAL_DIR = process.argv[2];
const OUT_DIR = process.argv[3];
const NAMES = process.argv.slice(4);
const SHOTS = String.raw`c:\Users\Basim\Documents\medpsycmoss\medpsycmoss-backup-20260727\backup\screenshots`;

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: String.raw`C:\Users\Basim\AppData\Local\ms-playwright\chromium-1187\chrome-win\chrome.exe`,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

for (const name of NAMES) {
  const a = pathToFileURL(path.join(LOCAL_DIR, `${name}.png`)).href;
  const b = pathToFileURL(path.join(SHOTS, `${name}.png`)).href;
  const html = `<!doctype html><meta charset=utf-8><style>
    body{margin:0;background:#222;font:12px system-ui;color:#ccc}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:4px}
    h3{margin:0;padding:4px;background:#000;text-align:center;font-size:13px}
    img{width:100%;display:block}
  </style>
  <div class=row><h3>LOCAL REBUILD</h3><h3>LIVE SITE (archived screenshot)</h3></div>
  <div class=row><img src="${a}"><img src="${b}"></div>`;
  const f = path.join(OUT_DIR, `${name}.html`);
  fs.writeFileSync(f, html);
  await page.goto(pathToFileURL(f).href);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, `diff-${name}.png`), fullPage: true });
  console.log('wrote', path.join(OUT_DIR, `diff-${name}.png`));
}
await browser.close();
