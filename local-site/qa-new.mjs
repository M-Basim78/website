#!/usr/bin/env node
/**
 * Mobile QA for the pages added in this round: the Free Guides tree, the
 * reworked homepage, and the patient libraries that gained a related-posts
 * band. Same bar as qa.mjs: no dashes, one h1, no horizontal overflow, every
 * tap target at least 44x44 on mobile.
 *
 *   node qa-new.mjs [baseUrl]      default http://localhost:8099
 */

import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8099';
const WIDTHS = [360, 768, 1280];

const sitemap = fs.readFileSync('dist/sitemap.xml', 'utf8');
const all = [...sitemap.matchAll(/<loc>https:\/\/medpsycmoss\.com([^<]*)<\/loc>/g)]
  .map(m => m[1] || '/');

const targets = all.filter(u =>
  u === '/' || u.startsWith('/free-guides') || u === '/resources' ||
  /-resources$/.test(u) || u === '/about-me' || u === '/store' || u === '/podcast');

const problems = [];
const note = (u, k, d) => problems.push({ u, k, d });

const browser = await chromium.launch();
console.log(`checking ${targets.length} pages at ${WIDTHS.join(', ')}`);

for (const u of targets) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  try {
    const res = await pg.goto(BASE + u, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!res || res.status() >= 400) { note(u, 'http', res ? res.status() : 'ERR'); }

    const info = await pg.evaluate(`(() => {
      const dashes = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n; while ((n = w.nextNode())) {
        if (!/[\\u2013\\u2014]/.test(n.nodeValue)) continue;
        if (n.parentElement.closest('script,style')) continue;
        dashes.push(n.nodeValue.trim().slice(0, 60));
      }
      return {
        h1: document.querySelectorAll('h1').length,
        navTabs: document.querySelectorAll('.top-links li').length,
        dock: document.querySelectorAll('.dock a').length,
        dashes,
        title: document.title,
        canon: (document.querySelector('link[rel=canonical]')||{}).href || '',
      };
    })()`);

    if (info.h1 !== 1) note(u, 'h1', info.h1);
    if (info.navTabs !== 5) note(u, 'nav-tabs', info.navTabs);
    if (info.dock !== 5) note(u, 'dock-items', info.dock);
    if (info.dashes.length) note(u, 'dash', info.dashes[0]);

    for (const w of WIDTHS) {
      await pg.setViewportSize({ width: w, height: 900 });
      await pg.waitForTimeout(150);
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
          .map(el => (el.textContent||'').trim().slice(0,26) + ' ' +
            Math.round(el.getBoundingClientRect().width) + 'x' +
            Math.round(el.getBoundingClientRect().height)).slice(0,3)
      }))()`);
      if (r.overflow) note(u, 'overflow@' + w, 'horizontal scroll');
      if (w < 780 && r.small.length) note(u, 'tap@' + w, r.small.join(' | '));
    }
  } catch (e) {
    note(u, 'load', String(e).slice(0, 90));
  }
  await ctx.close();
}
await browser.close();

const byKind = {};
for (const p of problems) byKind[p.k] = (byKind[p.k] || 0) + 1;
console.log('\n' + '='.repeat(64));
console.log('pages checked : ' + targets.length);
console.log('problems      : ' + problems.length);
console.log('='.repeat(64));
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + k.padEnd(18) + v);
}
for (const p of problems.slice(0, 20)) {
  console.log('  ' + p.u.padEnd(38) + p.k.padEnd(14) + String(p.d).slice(0, 52));
}
console.log(problems.length ? '\nRESULT: FAIL' : '\nRESULT: PASS');
