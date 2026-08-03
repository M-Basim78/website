#!/usr/bin/env node
/**
 * QA sweep across every page in rebuild/, applying the same bar qa.mjs applies
 * to the homepage: no em/en dashes, exactly one h1, no horizontal overflow, tap
 * targets at least 44px on mobile, no console errors or failed requests.
 *
 *   node qa-pages.mjs           all pages
 *   node qa-pages.mjs --new     only the generated resource pages
 */

import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { REBUILD, ROOT } from './lib-pages.mjs';

const BASE = 'http://localhost:8123';
const WIDTHS = [360, 768, 1280];
const ORIGINAL = new Set(['index', 'about-me', 'store', 'podcast', 'blog',
  'resources', 'my-work', 'contact']);

const onlyNew = process.argv.includes('--new');
let slugs = readdirSync(REBUILD).filter(f => f.endsWith('.html'))
  .map(f => f.replace(/\.html$/, ''));
if (onlyNew) slugs = slugs.filter(s => !ORIGINAL.has(s));
slugs.sort();

const problems = [];
const note = (slug, kind, detail) => problems.push({ slug, kind, detail });

const browser = await chromium.launch();
console.log(`checking ${slugs.length} pages at widths ${WIDTHS.join(', ')}`);

for (const [i, slug] of slugs.entries()) {
  const url = `${BASE}/${slug === 'index' ? '' : slug}`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  pg.on('requestfailed', r => {
    const u = r.url();
    // third-party beacons are deliberately blocked by serve.js
    if (/googletagmanager|doubleclick|segment|datadog|cookieyes|cloudflareinsights|convertexperiments/.test(u)) return;
    errs.push('requestfailed ' + u.slice(0, 100));
  });

  try {
    const res = await pg.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    if (!res || res.status() !== 200) note(slug, 'http', String(res && res.status()));

    const info = await pg.evaluate(`(() => {
      const h1 = document.querySelectorAll('h1').length;
      const title = document.title;
      const desc = (document.querySelector('meta[name=description]')||{}).content||'';
      const canon = (document.querySelector('link[rel=canonical]')||{}).href||'';
      const dashes = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n; while ((n = w.nextNode())) {
        if (!/[\\u2013\\u2014]/.test(n.nodeValue)) continue;
        if (n.parentElement.closest('script,style')) continue;
        dashes.push(n.nodeValue.trim().slice(0, 70));
      }
      const bad = [];
      document.querySelectorAll('a[href], button').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        if (r.height < 44 && innerWidth < 780) bad.push((el.textContent||'').trim().slice(0,40) + ' h=' + Math.round(r.height));
      });
      const links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
      return { h1, title, desc, canon, dashes, bad, links,
               overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    })()`);

    if (info.h1 !== 1) note(slug, 'h1', `${info.h1} h1 elements`);
    if (!info.title || info.title.length < 12) note(slug, 'title', info.title);
    if (!info.desc) note(slug, 'meta-description', 'missing');
    if (!info.canon) note(slug, 'canonical', 'missing');
    if (info.dashes.length) note(slug, 'dash', info.dashes[0]);
    if (errs.length) note(slug, 'console', errs[0]);

    for (const w of WIDTHS) {
      await pg.setViewportSize({ width: w, height: 900 });
      await pg.waitForTimeout(180);
      // Same rule qa.mjs applies: every a[href]/button at least 44x44 on
      // mobile, excluding the decorative marquee and the skip link.
      const r = await pg.evaluate(`(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        small: [...document.querySelectorAll('a[href],button')]
          .filter(el => {
            if (el.closest('.marquee') || el.classList.contains('skip')) return false;
            if (getComputedStyle(el).display === 'none') return false;
            const b = el.getBoundingClientRect();
            if (!b.width || !b.height) return false;
            return b.height < 44 || b.width < 44;
          })
          .map(el => (el.textContent||'').trim().slice(0,30) + ' ' +
                     Math.round(el.getBoundingClientRect().width) + 'x' +
                     Math.round(el.getBoundingClientRect().height)).slice(0,3)
      }))()`);
      if (r.overflow) note(slug, 'overflow@' + w, 'horizontal scroll');
      if (w < 780 && r.small.length) note(slug, 'tap@' + w, r.small.join(' | '));
    }
  } catch (err) {
    note(slug, 'load', String(err).slice(0, 110));
  }
  await ctx.close();
  if ((i + 1) % 15 === 0) console.log(`  ...${i + 1}/${slugs.length}`);
}
await browser.close();

mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
writeFileSync(path.join(ROOT, 'reports', 'qa-pages.json'), JSON.stringify(problems, null, 2));

const byKind = {};
for (const p of problems) byKind[p.kind] = (byKind[p.kind] || 0) + 1;

console.log('\n' + '='.repeat(66));
console.log(`pages checked : ${slugs.length}`);
console.log(`problems      : ${problems.length}`);
console.log('='.repeat(66));
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + k.padEnd(22) + v);
}
if (problems.length) {
  console.log('\nfirst 25:');
  for (const p of problems.slice(0, 25)) {
    console.log('  ' + p.slug.padEnd(40) + p.kind.padEnd(16) + String(p.detail).slice(0, 60));
  }
}
console.log(problems.length ? '\nRESULT: FAIL' : '\nRESULT: PASS');
