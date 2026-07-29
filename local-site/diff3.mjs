// Three-way: local rebuild | live site right now | archived screenshot.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const [localPng, livePng, name, out] = process.argv.slice(2);
const SHOTS = String.raw`c:\Users\Basim\Documents\medpsycmoss\medpsycmoss-backup-20260727\backup\screenshots`;

const browser = await chromium.launch({
  executablePath: String.raw`C:\Users\Basim\AppData\Local\ms-playwright\chromium-1187\chrome-win\chrome.exe`,
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const u = (p) => pathToFileURL(p).href;
const html = `<!doctype html><meta charset=utf-8><style>
  body{margin:0;background:#222;font:12px system-ui;color:#ccc}
  .row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px}
  h3{margin:0;padding:4px;background:#000;text-align:center;font-size:13px}
  img{width:100%;display:block}
</style>
<div class=row><h3>LOCAL REBUILD</h3><h3>LIVE SITE TODAY</h3><h3>ARCHIVE 2026-07-27</h3></div>
<div class=row><img src="${u(localPng)}"><img src="${u(livePng)}"><img src="${u(path.join(SHOTS, name + '.png'))}"></div>`;
const f = path.join(path.dirname(out), `_3way-${name}.html`);
fs.writeFileSync(f, html);
await page.goto(u(f));
await page.waitForTimeout(700);
await page.screenshot({ path: out, fullPage: true });
console.log('wrote', out);
await browser.close();
