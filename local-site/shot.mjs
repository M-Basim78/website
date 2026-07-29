import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { PNG_SIZE } from './png-size.mjs';

const OUT = process.argv[2];
const PAGES = process.argv.slice(3);
const PORT = 8123;
const SHOTS = String.raw`c:\Users\Basim\Documents\medpsycmoss\medpsycmoss-backup-20260727\backup\screenshots`;

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: String.raw`C:\Users\Basim\AppData\Local\ms-playwright\chromium-1187\chrome-win\chrome.exe`,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

for (const p of PAGES) {
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  const name = (p === '/' ? 'index' : p.replace(/^\//, '').replace(/\//g, '_'));
  try {
    await page.goto(`http://localhost:${PORT}${p}`, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    console.log(`${p}: nav ${e.message.split('\n')[0]}`);
  }
  await page.waitForTimeout(2500);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });

  const mine = PNG_SIZE(fs.readFileSync(file));
  let theirs = null;
  const ref = path.join(SHOTS, `${name}.png`);
  if (fs.existsSync(ref)) theirs = PNG_SIZE(fs.readFileSync(ref));
  console.log(`${p}\n   local  ${mine.w}x${mine.h}\n   archive ${theirs ? theirs.w + 'x' + theirs.h : 'n/a'}\n   failed reqs: ${failed.length}`);
  for (const f of [...new Set(failed)].slice(0, 12)) console.log(`      ${f}`);
  await page.close();
}
await browser.close();
