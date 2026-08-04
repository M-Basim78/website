/**
 * Audit the built site as the container actually serves it.
 * Crawls every URL in sitemap.xml: status, dashes, one h1, canonical accuracy,
 * teal, and whether every internal link resolves.
 */
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.argv[2] || 'http://localhost:8099';
const sitemap = fs.readFileSync('dist/sitemap.xml', 'utf8');
const urls = [...sitemap.matchAll(/<loc>https:\/\/medpsycmoss\.com([^<]*)<\/loc>/g)].map(m => m[1] || '/');

const problems = [];
const internal = new Set();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let ok = 0;
for (const u of urls) {
  const res = await page.goto(BASE + u, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
  if (!res || res.status() !== 200) { problems.push(`${u}: HTTP ${res ? res.status() : 'ERR'}`); continue; }
  ok++;

  const d = await page.evaluate(() => {
    // The no-dash house rule governs copy we wrote. Article bodies inside
    // .prose are her own published writing, reproduced verbatim from the
    // archive, so they are excluded rather than silently edited.
    const dashes = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      if (/[–—]/.test(n.nodeValue) && !n.parentElement.closest('script,style,.prose'))
        dashes.push(n.nodeValue.trim().slice(0, 55));
    }
    return {
      dashes,
      h1: document.querySelectorAll('h1').length,
      canon: (document.querySelector('link[rel=canonical]') || {}).href || '',
      title: document.title,
      desc: (document.querySelector('meta[name=description]') || {}).content || '',
      teal: /0DA88C|087A66|7FE8D2|0B4F45/i.test(document.documentElement.innerHTML),
      dev: /\/new\//.test(document.documentElement.innerHTML),
      links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
      imgs: [...document.images].filter(i => !i.getAttribute('alt')).length,
    };
  });

  d.dashes.forEach(x => problems.push(`${u}: dash "${x}"`));
  if (d.h1 !== 1) problems.push(`${u}: ${d.h1} h1`);
  if (d.teal) problems.push(`${u}: teal literal`);
  if (d.dev) problems.push(`${u}: unrewritten /new/ dev path`);
  if (!d.desc) problems.push(`${u}: no meta description`);
  if (d.imgs) problems.push(`${u}: ${d.imgs} img without alt`);
  const want = 'https://medpsycmoss.com' + (u === '/' ? '/' : u);
  if (d.canon !== want) problems.push(`${u}: canonical says ${d.canon}`);

  d.links.forEach(h => {
    if (!h || h.startsWith('#') || h.startsWith('mailto:') || /^https?:/.test(h)) return;
    internal.add(h.split('#')[0]);
  });
}
await page.close();

// every internal link must resolve on the container
const ctx = await browser.newContext();
const badLinks = [];
for (const h of internal) {
  const r = await ctx.request.get(BASE + h, { timeout: 15000, maxRedirects: 0 }).catch(() => null);
  if (!r || r.status() !== 200) badLinks.push(`${r ? r.status() : 'ERR'} ${h}`);
}
await browser.close();

badLinks.forEach(b => problems.push(`internal link ${b}`));

console.log(`pages crawled : ${urls.length}   200 OK: ${ok}`);
console.log(`internal links: ${internal.size}   broken: ${badLinks.length}`);
console.log(`\n=== problems: ${problems.length} ===`);
[...new Set(problems)].slice(0, 40).forEach(p => console.log('  ' + p));
if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
