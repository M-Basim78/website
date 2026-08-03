/**
 * Quality gate for the rebuilt homepage: screenshots at each required
 * breakpoint, console errors, and a resolve check on every link.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const URL = 'http://localhost:8123/new';
const OUT = process.argv[2];
const WIDTHS = [360, 390, 768, 1280];
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  });

const problems = [];
for (const w of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') problems.push(`console@${w}: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror@${w}: ${e.message}`));
  page.on('requestfailed', r => problems.push(`reqfailed@${w}: ${r.url()}`));
  page.on('response', r => { if (r.status() >= 400) problems.push(`http${r.status()}@${w}: ${r.url()}`); });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  // Force reveals in and eager-load the lazy images so the shot is complete.
  await page.evaluate(() => {
    document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
    document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; });
  });
  await page.evaluate(() => Promise.all(
    [...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; }))));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `w${w}.png`), fullPage: true });

  // horizontal overflow is the classic responsive failure
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) problems.push(`h-overflow@${w}: ${overflow}px`);

  const h1s = await page.locator('h1').count();
  if (w === 1280 && h1s !== 1) problems.push(`h1 count: ${h1s}`);
  console.log(`${w}px  ok  (overflow ${overflow}px)`);
  await page.close();
}

// --- link check ------------------------------------------------------------
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle' });
const links = await page.$$eval('a[href]', as => as.map(a => ({ href: a.href, text: a.textContent.trim().slice(0, 44) })));
await page.close();

const seen = new Map();
for (const l of links) if (!seen.has(l.href)) seen.set(l.href, l.text);
console.log(`\nchecking ${seen.size} unique links…`);

const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (link-check)' });
const results = [];
for (const [href, text] of seen) {
  if (href.startsWith('http://localhost:8123/new#')) { results.push([200, href, text, 'anchor']); continue; }
  try {
    const r = await ctx.request.get(href, { timeout: 30000, maxRedirects: 5 });
    results.push([r.status(), href, text, '']);
  } catch (e) {
    results.push([0, href, text, e.message.split('\n')[0].slice(0, 60)]);
  }
}
await browser.close();

// in-page anchors must exist as ids
const ids = ['store', 'story', 'pod', 'free', 'main'];
const html = fs.readFileSync(path.resolve('rebuild', 'index.html'), 'utf8');
for (const id of ids) if (!html.includes(`id="${id}"`)) problems.push(`missing anchor target #${id}`);

console.log('');
for (const [st, href, text, note] of results) {
  const flag = st >= 200 && st < 400 ? ' ok ' : ' XX ';
  if (flag === ' XX ') problems.push(`link ${st}: ${href}`);
  console.log(`${flag} ${String(st).padStart(3)}  ${href.slice(0, 92)}  ${note}`);
}

console.log(`\n=== problems: ${problems.length} ===`);
problems.forEach(p => console.log('  ' + p));
