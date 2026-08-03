/**
 * Render every archived page from the local mirror and compare the full-page
 * height against the screenshot the crawler took of the live site.  Height is a
 * cheap but sharp proxy: a missing image, a dropped section or a font fallback
 * all move it.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BACKUP = String.raw`c:\Users\Basim\Documents\medpsycmoss\medpsycmoss-backup-20260727\backup`;
const SHOTS = path.join(BACKUP, 'screenshots');
const OUT = process.argv[2] || path.join(__dirname ?? '.', 'verify-out');
const CONCURRENCY = Number(process.argv[3] || 4);
const PORT = 8123;

const pngSize = (p) => {
  const b = fs.readFileSync(p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

// Rebuild the route table the same way the server does.
const routes = [];
const seen404 = new Set();
for (const line of fs.readFileSync(path.join(BACKUP, 'manifest.txt'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^(https?:\/\/\S+)\s+(\S+\.html)\s+(\d+)\s+chars(\s+\[404\])?\s*$/);
  if (!m) continue;
  const p = new URL(m[1]).pathname.replace(/\/+$/, '') || '/';
  if (m[4]) { seen404.add(p); continue; }
  routes.push({ route: p, file: m[2] });
}
const unique = [...new Map(routes.map(r => [r.file, r])).values()];
console.log(`checking ${unique.length} pages, concurrency ${CONCURRENCY}`);

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  });

const results = [];
let cursor = 0;

async function worker(id) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  while (cursor < unique.length) {
    const { route, file } = unique[cursor++];
    const name = file.replace(/\.html$/, '');
    const page = await ctx.newPage();
    const missing = new Set();
    page.on('response', r => { if (r.status() >= 400 && r.url().includes('localhost')) missing.add(r.url()); });
    page.on('requestfailed', r => missing.add(r.url()));
    let note = '';
    try {
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) {
      note = 'networkidle-timeout';
    }
    await page.waitForTimeout(1500);
    const shot = path.join(OUT, `${name}.png`);
    try {
      await page.screenshot({ path: shot, fullPage: true });
      const mine = pngSize(shot);
      const refPath = path.join(SHOTS, `${name}.png`);
      const theirs = fs.existsSync(refPath) ? pngSize(refPath) : null;
      const delta = theirs ? mine.h - theirs.h : null;
      results.push({ route, name, mine, theirs, delta, missing: missing.size, note });
      const flag = theirs == null ? '  ?' : Math.abs(delta) <= 4 ? ' ok' : Math.abs(delta) <= 60 ? '  ~' : ' XX';
      console.log(`${flag} ${route.padEnd(52)} ${String(mine.h).padStart(6)} vs ${String(theirs?.h ?? '-').padStart(6)}  ${delta ?? ''} ${note}`);
    } catch (e) {
      results.push({ route, name, error: e.message.split('\n')[0] });
      console.log(` !! ${route}  ${e.message.split('\n')[0]}`);
    }
    await page.close();
  }
  await ctx.close();
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
await browser.close();

fs.writeFileSync(path.join(OUT, '_results.json'), JSON.stringify(results, null, 2));

const ok = results.filter(r => r.delta != null && Math.abs(r.delta) <= 4).length;
const near = results.filter(r => r.delta != null && Math.abs(r.delta) > 4 && Math.abs(r.delta) <= 60).length;
const off = results.filter(r => r.delta != null && Math.abs(r.delta) > 60);
const err = results.filter(r => r.error);
console.log(`\nexact (<=4px): ${ok}   near (<=60px): ${near}   off: ${off.length}   errors: ${err.length}`);
for (const r of off.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 30)) {
  console.log(`  ${String(r.delta).padStart(7)}px  ${r.route}   (missing reqs: ${r.missing})`);
}
