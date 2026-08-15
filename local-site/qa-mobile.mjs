#!/usr/bin/env node
/**
 * Phone layout audit.
 *
 * The bugs this exists to catch are the ones a 360px screen produces and a
 * desktop never shows: a flex column squeezed so narrow that words break apart
 * mid-word, text overlapping its neighbour, and anything spilling past the
 * viewport.
 *
 *   node qa-mobile.mjs [baseUrl]     default http://localhost:8099
 */

import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8099';
const WIDTHS = [360, 390];

const sitemap = fs.readFileSync('dist/sitemap.xml', 'utf8');
const all = [...sitemap.matchAll(/<loc>https:\/\/medpsycmoss\.com([^<]*)<\/loc>/g)].map(m => m[1] || '/');

// One of each kind of page, plus everything that carries .fr rows.
const sample = all.filter(u =>
  u === '/' || u === '/resources' || u === '/store' || u === '/about-me' ||
  u === '/blog' || u === '/podcast' || u === '/contact' || u === '/my-work' ||
  u.startsWith('/free-guides') || /-resources$/.test(u) ||
  ['/trauma-informed-care', '/podcasts-trauma', '/providers-pelvic-pain',
   '/support-groups-endometriosis', '/vlogs', '/events', '/interviews'].includes(u) ||
  u.startsWith('/products/') || u === '/blog/mcat');

const problems = [];
const note = (u, w, kind, detail) => problems.push({ u, w, kind, detail });

const browser = await chromium.launch();
console.log(`checking ${sample.length} pages at ${WIDTHS.join(' and ')}px`);

for (const u of sample) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  try {
    const res = await pg.goto(BASE + u, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!res || res.status() !== 200) { note(u, '-', 'http', res ? res.status() : 'ERR'); await ctx.close(); continue; }

    for (const w of WIDTHS) {
      await pg.setViewportSize({ width: w, height: 780 });
      await pg.waitForTimeout(160);

      const r = await pg.evaluate(`(() => {
        const out = { overflow: 0, narrow: [], overlap: [], entities: [] };

        if (document.documentElement.scrollWidth > window.innerWidth + 1)
          out.overflow = document.documentElement.scrollWidth - window.innerWidth;

        // A text column narrower than ~90px cannot fit a normal word, which is
        // what produced "Pre / me / d" on a phone.
        document.querySelectorAll('.fr .t, .fr .d, .tile h3, .tile p').forEach(el => {
          const b = el.getBoundingClientRect();
          const txt = (el.textContent || '').trim();
          if (!txt || b.width < 1) return;
          if (b.width < 90 && txt.length > 12)
            out.narrow.push(Math.round(b.width) + 'px "' + txt.slice(0, 26) + '"');
        });

        // Text boxes that visually intersect a sibling.
        const boxes = [...document.querySelectorAll('.fr .cat, .fr .t')].map(el => ({
          el, b: el.getBoundingClientRect(), t: (el.textContent || '').trim()
        })).filter(x => x.b.width > 1 && x.b.height > 1);
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i].b, c = boxes[j].b;
            const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
            const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
            if (ox > 6 && oy > 6) {
              out.overlap.push('"' + boxes[i].t.slice(0, 18) + '" over "' + boxes[j].t.slice(0, 18) + '"');
              i = boxes.length; break;
            }
          }
        }

        // Entities that survived into visible text.
        const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n; while ((n = w2.nextNode())) {
          if (n.parentElement.closest('script,style')) continue;
          const m = n.nodeValue.match(/&(amp|lt|gt|quot|nbsp|#\\d+);/);
          if (m) out.entities.push(n.nodeValue.trim().slice(0, 50));
        }
        return out;
      })()`);

      if (r.overflow) note(u, w, 'overflow', r.overflow + 'px past the viewport');
      if (r.narrow.length) note(u, w, 'crushed column', r.narrow.slice(0, 2).join(' | '));
      if (r.overlap.length) note(u, w, 'overlapping text', r.overlap[0]);
      if (r.entities.length) note(u, w, 'raw entity', r.entities[0]);
    }
  } catch (e) {
    note(u, '-', 'load', String(e).slice(0, 80));
  }
  await ctx.close();
}
await browser.close();

const byKind = {};
for (const p of problems) byKind[p.kind] = (byKind[p.kind] || 0) + 1;

console.log('\n' + '='.repeat(70));
console.log('pages checked : ' + sample.length);
console.log('problems      : ' + problems.length);
console.log('='.repeat(70));
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log('  ' + k.padEnd(20) + v);
for (const p of problems.slice(0, 25)) {
  console.log('  ' + String(p.u).padEnd(40) + String(p.w).padEnd(5) + p.kind.padEnd(18) + String(p.detail).slice(0, 52));
}
console.log(problems.length ? '\nRESULT: FAIL' : '\nRESULT: PASS');
