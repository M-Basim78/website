/**
 * Stage 2 integration audit across the whole rebuilt site.
 *   dashes, teal, one h1, shell drift vs the homepage, link resolution,
 *   duplicate CSS selectors, per-page SEO tags.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:8123';
const PAGES = ['/', '/about-me', '/store', '/podcast', '/blog', '/resources', '/my-work', '/contact'];
const problems = [];
const note = (s) => problems.push(s);

// ---- duplicate CSS selectors ------------------------------------------------
const css = fs.readFileSync(path.resolve('rebuild/css/site.css'), 'utf8');
const sels = [...css.matchAll(/^\s*([.#][\w.\-#\s,:>()\[\]="']+?)\s*\{/gm)].map(m => m[1].trim());
const dupes = Object.entries(sels.reduce((a, s) => (a[s] = (a[s] || 0) + 1, a), {}))
  .filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
console.log(`css: ${sels.length} rules, ${dupes.length} selectors declared more than once`);
dupes.slice(0, 12).forEach(([s, n]) => console.log(`   ${n}x  ${s.slice(0, 70)}`));

const browser = await chromium.launch({ });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let shellRef = null;
const allLinks = new Set();
const seo = [];

for (const p of PAGES) {
  const res = await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (!res || res.status() !== 200) { note(`${p}: HTTP ${res && res.status()}`); continue; }

  const d = await page.evaluate(() => {
    const dashes = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      if (/[\u2013\u2014]/.test(n.nodeValue) && !n.parentElement.closest('script,style'))
        dashes.push(n.nodeValue.trim().slice(0, 60));
    }
    const norm = (el) => el ? el.outerHTML.replace(/\s+/g, ' ')
      .replace(/ aria-current="page"| class="on"/g, '').trim() : '';
    return {
      dashes,
      h1: document.querySelectorAll('h1').length,
      title: document.title,
      desc: document.querySelector('meta[name=description]')?.content || '',
      canon: document.querySelector('link[rel=canonical]')?.href || '',
      og: !!document.querySelector('meta[property="og:title"]'),
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].length,
      header: norm(document.querySelector('header.top')),
      footer: norm(document.querySelector('footer')),
      dock: norm(document.querySelector('nav.dock')),
      links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
      teal: /0DA88C|087A66|7FE8D2|0B4F45/i.test(document.documentElement.innerHTML),
    };
  });

  d.dashes.forEach(x => note(`${p}: dash "${x}"`));
  if (d.h1 !== 1) note(`${p}: ${d.h1} h1 elements`);
  if (d.teal) note(`${p}: teal literal present`);
  if (!d.desc) note(`${p}: no meta description`);
  if (!d.canon) note(`${p}: no canonical`);
  if (!d.og) note(`${p}: no og:title`);
  if (!d.ld) note(`${p}: no JSON-LD`);
  seo.push({ p, title: d.title, canon: d.canon.replace('https://medpsycmoss.com', ''), ld: d.ld });

  if (!shellRef) shellRef = d;
  else {
    for (const part of ['header', 'footer', 'dock']) {
      if (d[part] !== shellRef[part]) note(`${p}: ${part} differs from homepage shell`);
    }
  }
  d.links.forEach(h => { if (h && !h.startsWith('#') && !h.startsWith('mailto:')) allLinks.add(h); });
  console.log(`${p.padEnd(12)} h1:${d.h1}  dashes:${d.dashes.length}  ld:${d.ld}  links:${d.links.length}`);
}

// ---- link resolution --------------------------------------------------------
console.log(`\nchecking ${allLinks.size} unique links...`);
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (link-audit)' });
const bad = [];
for (const href of allLinks) {
  const url = href.startsWith('http') ? href : BASE + href;
  try {
    const r = await ctx.request.get(url, { timeout: 25000, maxRedirects: 5 });
    if (r.status() >= 400) bad.push(`${r.status()} ${href}`);
  } catch (e) { bad.push(`ERR ${href}`); }
}
await browser.close();

console.log('\n--- SEO ---');
seo.forEach(s => console.log(`${s.p.padEnd(12)} ld:${s.ld}  canon:${s.canon.padEnd(16)} ${s.title.slice(0, 58)}`));

console.log(`\n--- broken links: ${bad.length} ---`);
bad.forEach(b => console.log('   ' + b));
bad.filter(b => !b.includes('open.spotify')).forEach(b => note(`link ${b}`));

console.log(`\n=== problems: ${problems.length} ===`);
[...new Set(problems)].forEach(p => console.log('  ' + p));
