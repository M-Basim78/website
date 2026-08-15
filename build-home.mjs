#!/usr/bin/env node
/**
 * Rework the homepage per her review: lead with the free guides, not the paid
 * products.
 *
 *   - the `#free` band now shows the six Free Guides groups and links into
 *     /free-guides, replacing the mixed list of patient resources
 *   - `#free` is moved above `#store`, so the first thing below the credentials
 *     strip is free content
 *   - the store band stays, just lower down; she likes the storefront
 *
 * Idempotent: running it twice produces the same file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { assign } from './guides-taxonomy.mjs';

const FILE = path.resolve('rebuild', 'index.html');
const esc = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Whole <section ...> ... </section> block containing a marker. */
function section(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.lastIndexOf('<section', i);
  const end = html.indexOf('</section>', i);
  if (start < 0 || end < 0) return null;
  return { start, end: end + '</section>'.length };
}

let html = fs.readFileSync(FILE, 'utf8');

const { groups } = assign();
const total = new Set(groups.flatMap(g => g.posts.map(p => p.slug))).size;

// cat/t/d inside one span: .fr is a two column flex, content then tag.
const rows = groups.map(g => `        <a class="fr" href="/free-guides/${g.key}">
          <span><span class="cat">${esc(g.name.toUpperCase())}</span><span class="t">${esc(g.name)}</span><span class="d">${esc(g.blurb)}</span></span>
          <span class="tagm">FREE</span>
        </a>`).join('\n');

const freeBand = `<section id="free" aria-labelledby="free-title">
  <div class="wrap">
    <div class="head reveal">
      <span class="vital">Free guides</span>
      <h2 id="free-title">Start here. <span class="hl">No cost, no catch.</span></h2>
      <p>${total} free guides on getting into medical school, getting through it, the USMLE exams, accommodations and the residency match. No email required.</p>
    </div>
    <div class="free-list reveal">
${rows}
    </div>
    <div class="hero-cta" style="margin-top:26px">
      <a href="/free-guides" class="btn">Browse all free guides</a>
      <a href="/resources" class="btn dark">Patient &amp; doctor resources</a>
    </div>
  </div>
</section>`;

// ---- replace the free band
const free = section(html, 'id="free"');
if (!free) { console.error('could not find the #free section'); process.exit(1); }
html = html.slice(0, free.start) + freeBand + html.slice(free.end);

// ---- move it above the store band
const store = section(html, 'id="store"');
const free2 = section(html, 'id="free"');
if (store && free2 && free2.start > store.start) {
  const freeBlock = html.slice(free2.start, free2.end);
  // cut the free band out, then insert it before the store band
  let rest = html.slice(0, free2.start).replace(/\s*$/, '\n\n') + html.slice(free2.end);
  const store2 = section(rest, 'id="store"');
  rest = rest.slice(0, store2.start) + freeBlock + '\n\n' + rest.slice(store2.start);
  html = rest;
  console.log('moved #free above #store');
} else {
  console.log('#free already sits above #store');
}

fs.writeFileSync(FILE, html);

const order = [...html.matchAll(/<section[^>]*id="(free|store)"/g)].map(m => m[1]);
console.log('homepage band order : ' + order.join(' then '));
console.log('guide groups listed : ' + groups.length);
console.log('free guides counted : ' + total);
