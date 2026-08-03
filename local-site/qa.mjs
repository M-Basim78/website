/**
 * Full QA sweep for the rebuilt homepage.
 *   - no em/en dash anywhere in rendered text
 *   - no horizontal scrolling at any width
 *   - every tap target at least 44px on mobile
 *   - the fixed dock never covers an interactive element, including at the
 *     very bottom of the page
 *   - no console errors, no failed requests
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const URL = 'http://localhost:8123/new';
const OUT = process.argv[2];
const WIDTHS = [360, 390, 430, 768, 1024, 1280];
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const browser = await chromium.launch({ });

for (const w of WIDTHS) {
  const mobile = w < 780;
  const page = await browser.newPage({ viewport: { width: w, height: mobile ? 844 : 900 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') problems.push(`console@${w}: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror@${w}: ${e.message}`));
  page.on('requestfailed', r => problems.push(`reqfailed@${w}: ${r.url()}`));
  page.on('response', r => { if (r.status() >= 400) problems.push(`http${r.status()}@${w}: ${r.url()}`); });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => {
    document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
    document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; });
  });
  await page.evaluate(() => Promise.all([...document.images].filter(i => !i.complete)
    .map(i => new Promise(r => { i.onload = i.onerror = r; }))));
  await page.waitForTimeout(400);

  // --- dashes in rendered text -------------------------------------------
  const dashes = await page.evaluate(() => {
    const bad = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      if (!/[\u2013\u2014]/.test(n.nodeValue)) continue;
      const el = n.parentElement;
      if (el.closest('script,style')) continue;
      bad.push(`<${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}> ${n.nodeValue.trim().slice(0, 70)}`);
    }
    return bad;
  });
  dashes.forEach(d => problems.push(`dash@${w}: ${d}`));

  // --- horizontal overflow ------------------------------------------------
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) problems.push(`h-overflow@${w}: ${overflow}px`);

  // --- tap targets --------------------------------------------------------
  let small = [];
  if (mobile) {
    small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('a[href], button')) {
        if (el.closest('.marquee') || el.classList.contains('skip')) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;                       // hidden
        if (getComputedStyle(el).display === 'none') continue;
        if (r.height < 44 || r.width < 44) {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] || '-'} ${Math.round(r.width)}x${Math.round(r.height)} "${el.textContent.trim().slice(0, 30)}"`);
        }
      }
      return out;
    });
    small.forEach(s => problems.push(`tap@${w}: ${s}`));
  }

  // --- dock overlap, at top, mid and very bottom of the page --------------
  let overlaps = [];
  if (mobile) {
    for (const pos of ['top', 'mid', 'bottom']) {
      // scroll-behavior:smooth animates, so jump instantly or we measure mid-flight
      await page.evaluate((p) => {
        const h = document.documentElement.scrollHeight;
        const y = p === 'top' ? 0 : p === 'mid' ? Math.round(h / 2) : h;
        window.scrollTo({ top: y, behavior: 'instant' });
      }, pos);
      await page.waitForTimeout(350);
      const hits = await page.evaluate(() => {
        const dock = document.querySelector('.dock');
        if (!dock) return [];
        const d = dock.getBoundingClientRect();
        const out = [];
        for (const el of document.querySelectorAll('a[href], button, .disc, footer p, .fr, .qc')) {
          if (el.closest('.dock')) continue;
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) continue;   // offscreen
          const ox = Math.min(r.right, d.right) - Math.max(r.left, d.left);
          const oy = Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top);
          if (ox <= 0 || oy <= 0) continue;
          // A tall element merely reaching under the dock is fine; what matters is
          // a meaningful share of it being covered, or a small control disappearing.
          const covered = (ox * oy) / (r.width * r.height);
          if (covered > 0.35 || r.height < 120) {
            out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] || '-'} ${Math.round(covered * 100)}% covered "${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 34)}"`);
          }
        }
        return out;
      });
      hits.forEach(h => overlaps.push(`dock-overlap@${w}/${pos}: ${h}`));
    }
    overlaps.forEach(o => problems.push(o));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
  }

  await page.screenshot({ path: path.join(OUT, `w${w}.png`), fullPage: true });
  console.log(`${String(w).padStart(4)}px  overflow ${overflow}px  dashes ${dashes.length}  smallTaps ${small.length}  dockOverlaps ${overlaps.length}`);
  await page.close();
}

// one h1, heading order
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle' });
const heads = await page.evaluate(() => ({
  h1: document.querySelectorAll('h1').length,
  order: [...document.querySelectorAll('h1,h2,h3')].map(h => h.tagName).join(','),
}));
if (heads.h1 !== 1) problems.push(`h1 count: ${heads.h1}`);
await page.close();
await browser.close();

console.log(`\n=== problems: ${problems.length} ===`);
[...new Set(problems)].forEach(p => console.log('  ' + p));
