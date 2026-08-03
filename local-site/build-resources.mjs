#!/usr/bin/env node
/**
 * Build the resource libraries and their child pages onto the shared shell.
 *
 * Content is never invented. Every title, link and blurb is read out of the
 * archived DOM at ../medpsycmoss-backup-20260727/backup/pages via a headless
 * browser, because Gator paints these pages with JavaScript and pairs card
 * titles to links only by position on screen.
 *
 * Requires the local server: `node serve.js` in another terminal.
 *
 *   node build-resources.mjs            build everything
 *   node build-resources.mjs --only trauma-resources
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { inventory, REBUILD, ROOT, clean, hasArchive } from './lib-pages.mjs';

const BASE = 'http://localhost:8123';
// page.evaluate(string) in the Node API evaluates the string as an *expression*,
// so a bare arrow function would just return the function object. Strip the
// leading block comment and invoke it.
const EXTRACT = '(' + readFileSync(path.join(ROOT, 'extract-page.js'), 'utf8')
  .replace(/^\s*\/\*[\s\S]*?\*\//, '').trim() + ')()';
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

// ------------------------------------------------------------------ helpers

const esc = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * House rule: no em or en dashes in visible copy (check-dashes.mjs enforces it).
 * Titles come from her site, so normalise rather than drop them.
 */
const dedash = s => String(s || '')
  .replace(/\s+[—–]\s+/g, ', ')
  .replace(/[—–]/g, '-')
  .replace(/\s*,\s*,/g, ',');

const tidy = s => fixTerms(dedash(clean(s)).replace(/\s*\|\s*$/, '').trim());

/**
 * Gator splits headings across positioned text nodes, so stripping its
 * zero-width padding can weld two words together and drop the hyphen between
 * them. Restore her own established spellings rather than ship "Traumainformed".
 */
const TERMS = [
  [/\btrauma[\s-]?informed\b/gi, 'Trauma-Informed'],
  [/\bpatient[\s-]?doctor\b/gi, 'Patient-Doctor'],
  [/\btrauma[\s-]?focus(s?)ed\b/gi, 'Trauma-Focused'],
  [/\bl[gq]btqia\b/gi, 'LGBTQIA'],
  [/\busmle\b/gi, 'USMLE'],
  [/\beras\b/g, 'ERAS'],
  [/\bmcat\b/gi, 'MCAT'],
  [/\bcomlex\b/gi, 'COMLEX'],
  [/\bpt\b/g, 'PT'],
  [/\bmedpsycmoss\b/gi, 'MedPsycMoss'],
];
const fixTerms = s => TERMS.reduce((acc, [re, to]) => acc.replace(re, to), String(s || ''));

/** Sentence-case a shouty title without mangling acronyms. */
function fixCase(s) {
  if (!s) return s;
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length > 6 && letters === letters.toUpperCase()) {
    return s.toLowerCase().replace(/(^|[.:!?]\s+|\s)([a-z])/g,
      (m, p, c) => p + c.toUpperCase());
  }
  return s;
}

/** Human name for a link when the page never gave it one. */
function deriveLabel(e) {
  const u = (() => { try { return new URL(e.href); } catch { return null; } })();
  if (!u) return e.host || 'Link';
  const seg = u.pathname.split('/').filter(Boolean);

  if (/podcasts\.apple\.com/.test(u.hostname)) {
    const i = seg.indexOf('podcast');
    if (i >= 0 && seg[i + 1]) return titleFromSlug(seg[i + 1]);
  }
  if (/open\.spotify\.com/.test(u.hostname) && seg[0] === 'show' && seg[1]) {
    return 'Spotify show';
  }
  if (/youtu\.be|youtube\.com/.test(u.hostname)) {
    if (u.pathname.startsWith('/c/') && seg[1]) return titleFromSlug(seg[1]);
    if (u.pathname.startsWith('/@')) return u.pathname.slice(1);
    return 'Video on YouTube';
  }
  if (/facebook\.com/.test(u.hostname) && seg[0] === 'groups' && seg[1]) {
    return titleFromSlug(seg[1]) + ' (Facebook group)';
  }
  if (/instagram\.com/.test(u.hostname) && seg[0]) return '@' + seg[0];
  if (/bookshop\.org/.test(u.hostname) && seg.includes('lists')) {
    return titleFromSlug(seg[seg.indexOf('lists') + 1] || 'Book list');
  }
  if (seg.length) {
    const last = seg[seg.length - 1].replace(/\.(html?|php|pdf)$/i, '');
    if (last.length > 3 && /[a-z]/i.test(last) && !/^\d+$/.test(last)) {
      return titleFromSlug(last);
    }
  }
  return e.host;
}

const titleFromSlug = s => tidy(
  decodeURIComponent(s).replace(/[-_+]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

/** Coarse category chip from the destination. */
function categorise(e) {
  const h = e.host || '', u = e.href.toLowerCase();
  if (/podcasts\.apple\.com|open\.spotify\.com|podbean|buzzsprout|transistor/.test(h)) return 'PODCAST';
  if (/youtu\.be|youtube\.com|vimeo/.test(h)) return 'VIDEO';
  if (/facebook\.com\/groups|myendometriosisteam|inspire\.com|reddit/.test(u)) return 'SUPPORT GROUP';
  if (/instagram\.com/.test(h)) return 'INSTAGRAM';
  if (/pubmed|ncbi\.nlm|pnas\.org|jamanetwork|nejm|sciencedirect|springer|wiley|bmj|tandfonline|sagepub|academic\.oup/.test(h)) return 'RESEARCH';
  if (/\.pdf($|\?)/.test(u)) return 'PDF';
  if (/bookshop\.org|amazon\.|goodreads/.test(h)) return 'BOOK';
  if (/eventbrite|conference|training|summit|webinar/.test(u)) return 'TRAINING';
  if (/psychologytoday|pelvicrehab|statusplus|mapotic|therapist|provider|find-a/.test(u)) return 'FIND A PROVIDER';
  return 'WEBSITE';
}

// ------------------------------------------------------------------ template

const PERSON_LD = readFileSync(path.join(REBUILD, 'resources.html'), 'utf8')
  .match(/\{\s*"@type": "Person",[\s\S]*?\n {4}\}/);

function shell({ slug, title, desc, h1, kicker, intro, body, crumbs, ld }) {
  const url = 'https://medpsycmoss.com/' + slug;
  const t = esc(tidy(title));
  const d = esc(tidy(desc));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

<title>${t} | MedPsycMoss</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${url}">
<meta name="author" content="Stephanie Moss, MD">
<meta name="theme-color" content="#6E1F35">
<link rel="icon" href="/new/favicon.svg" type="image/svg+xml">

<meta property="og:type" content="website">
<meta property="og:site_name" content="MedPsycMoss | Stephanie Moss, MD">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${t} | MedPsycMoss">
<meta property="og:description" content="${d}">
<meta property="og:image" content="https://medpsycmoss.com/img/moss-doctor.webp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1600">
<meta property="og:image:alt" content="Stephanie Moss, MD.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t} | MedPsycMoss">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="https://medpsycmoss.com/img/moss-doctor.webp">

<link rel="preload" href="/new/fonts/bricolage-grotesque-300-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/new/fonts/inter-400-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/new/css/site.css">
<script src="/new/js/site.js" defer></script>
</head>
<body>

<a class="skip" href="#main">Skip to content</a>

<header class="top">
  <div class="wrap top-in">
    <a href="/" class="logo"><span class="mp">MedPsyc</span><span class="moss">Moss</span><span class="md">STEPHANIE MOSS, MD</span></a>
    <nav aria-label="Primary">
      <ul class="top-links">
        <li><a href="/store">STORE</a></li>
        <li><a href="/resources" aria-current="page">FREE</a></li>
        <li><a href="/about-me">PATIENT&amp;DOCTOR</a></li>
        <li><a href="/podcast">PODCAST</a></li>
      </ul>
    </nav>
    <a href="/store" class="btn">Browse the store</a>
  </div>
</header>

<main id="main">

<section class="hero" aria-labelledby="pg-title">
  <div class="mesh"></div>
  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>
    <p class="kicker reveal in">${kicker}</p>
    <h1 id="pg-title" class="tight">${esc(h1)}</h1>
    <p class="sub">${intro}</p>
  </div>
</section>

${body}

<section aria-labelledby="note-title">
  <div class="wrap">
    <div class="tint-band">
      <div class="head reveal">
        <span class="vital">Please read</span>
        <h2 id="note-title">Educational content only</h2>
        <p>These resources are shared for education. They are not medical, psychiatric, nor legal advice, and they are not a substitute for care from your own clinician. Links go to organisations Dr. Moss does not control.</p>
      </div>
    </div>
  </div>
</section>

</main>

${FOOTER}
${DOCK}

<script type="application/ld+json">
${ld}
</script>

</body>
</html>
`;
}

// Footer and dock are copied verbatim from the built pages so the shell cannot drift.
function grab(file, startRe, endRe) {
  const html = readFileSync(path.join(REBUILD, file), 'utf8');
  const s = html.search(startRe);
  const e = html.search(endRe);
  if (s < 0 || e < 0) throw new Error('could not lift block from ' + file);
  return html.slice(s, e + html.match(endRe)[0].length);
}
const FOOTER = grab('resources.html', /<footer/, /<\/footer>/);
const DOCK = grab('resources.html', /<nav class="dock"/, /<\/nav>/);

// ------------------------------------------------------------------ bodies

function hubBody(lib, kids, pages) {
  const rows = kids.map((slug, i) => {
    const p = pages[slug];
    const name = tidy(fixCase(p?.title || titleFromSlug(slug)));
    const n = p ? p.entries.length + (p.internal || []).length : 0;
    return `        <a class="fr" href="/${esc(slug)}">
          <span class="cat">${esc(String(i + 1).padStart(2, '0'))}</span>
          <span class="t">${esc(name)}</span>
          <span class="d">${n} link${n === 1 ? '' : 's'} she has collected on this topic.</span>
          <span class="tagm">FREE</span>
        </a>`;
  }).join('\n');

  return `<section id="sections" aria-labelledby="sec-title">
  <div class="wrap">
    <div class="head reveal">
      <span class="vital">${esc(lib.cat || 'Library')}</span>
      <h2 id="sec-title">What is <span class="hl">inside this library</span></h2>
      <p>Every section below is free to read. No email required.</p>
    </div>
    <div class="free-list reveal">
${rows}
    </div>
  </div>
</section>`;
}

function leafBody(page, opts = {}) {
  const skip = new Set(opts.skipInternal || []);
  const groups = new Map();
  for (const e of page.entries) {
    const c = categorise(e);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(e);
  }
  // Her own writing linked from this page. Several posts-* pages are made
  // entirely of these, and would otherwise render as an empty list.
  for (const it of (page.internal || [])) {
    if (skip.has(it.path)) continue;
    const c = /^blog(\/|$)/.test(it.path) ? 'FROM HER BLOG' : 'ON THIS SITE';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push({
      label: it.label || titleFromSlug(it.path.split('/').pop()),
      blurb: '', href: '/' + it.path, host: '', internal: true,
    });
  }
  // Some collection pages are driven by Gator's list widget, which returns 404
  // in production, so the archive captured a page with no items on it. Say so
  // plainly instead of shipping a blank band.
  if (!groups.size) {
    const back = opts.parentSlug
      ? `<p><a class="btn dark" href="/${esc(opts.parentSlug)}">Back to the library</a></p>`
      : '';
    return `<section aria-labelledby="empty-title">
  <div class="wrap">
    <div class="tint-band">
      <div class="head reveal">
        <span class="vital">Nothing captured yet</span>
        <h2 id="empty-title">This list is not available</h2>
        <p>On the current site this page is filled in by a list widget that is not returning any items, so there was nothing to carry over. The content still exists in her account and can be added here once it is exported.</p>
      </div>
      ${back}
    </div>
  </div>
</section>`;
  }

  const order = ['FROM HER BLOG', 'ON THIS SITE', 'SUPPORT GROUP', 'FIND A PROVIDER',
    'WEBSITE', 'RESEARCH', 'PDF', 'BOOK', 'PODCAST', 'VIDEO', 'TRAINING', 'INSTAGRAM'];
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const out = keys.map((k, gi) => {
    const rows = groups.get(k).map(e => {
      const label = tidy(fixCase(e.label || deriveLabel(e)));
      const blurb = tidy(e.blurb || '');
      // Internal links stay same-tab and keep their ranking value.
      const attrs = e.internal ? '' : ' rel="noopener nofollow" target="_blank"';
      return `        <a class="fr" href="${esc(e.href)}"${attrs}>
          <span class="cat">${esc(k)}</span>
          <span class="t">${esc(label)}</span>
          <span class="d">${esc(blurb || e.host)}</span>
          <span class="tagm">${e.internal ? 'READ' : 'OPEN'}</span>
        </a>`;
    }).join('\n');
    return `    <div class="head reveal"${gi ? ' style="margin-top:44px"' : ''}>
      <span class="vital">${esc(k)}</span>
      <h2 id="grp-${gi}">${esc(fixCase(k.toLowerCase()))} (${groups.get(k).length})</h2>
    </div>
    <div class="free-list reveal">
${rows}
    </div>`;
  }).join('\n');

  return `<section id="links" aria-labelledby="grp-0">
  <div class="wrap">
${out}
  </div>
</section>`;
}

function ldFor({ slug, name, desc, items }) {
  const person = PERSON_LD ? PERSON_LD[0] : '{"@type":"Person","name":"Stephanie Moss"}';
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `https://medpsycmoss.com/${slug}#webpage`,
        url: `https://medpsycmoss.com/${slug}`,
        name: tidy(name),
        description: tidy(desc),
        inLanguage: 'en-US',
        isPartOf: { '@id': 'https://medpsycmoss.com/#website' },
        author: { '@id': 'https://medpsycmoss.com/#person' },
        publisher: { '@id': 'https://medpsycmoss.com/#person' },
      },
      JSON.parse(person),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://medpsycmoss.com/' },
          { '@type': 'ListItem', position: 2, name: 'Resources', item: 'https://medpsycmoss.com/resources' },
          { '@type': 'ListItem', position: 3, name: tidy(name), item: `https://medpsycmoss.com/${slug}` },
        ],
      },
      {
        '@type': 'ItemList',
        name: tidy(name),
        numberOfItems: items.length,
        itemListElement: items.slice(0, 100).map((it, i) => ({
          '@type': 'ListItem', position: i + 1, name: tidy(it.name), url: it.url,
        })),
      },
    ],
  }, null, 2);
}

// ------------------------------------------------------------------ main

const inv = inventory();
const wanted = only
  ? [only]
  : [...inv.libs.map(l => l.slug), ...inv.leaves, 'events', 'interviews', 'vlogs'];

const pages = {};
const weak = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const pg = await ctx.newPage();

console.log('extracting %d pages from the archive', wanted.length);
for (const [i, slug] of wanted.entries()) {
  if (!hasArchive(slug)) { console.log('  [%d] SKIP (not archived) %s', i + 1, slug); continue; }
  try {
    await pg.goto(`${BASE}/${slug}?old=1`, { waitUntil: 'networkidle', timeout: 60000 });
    await pg.waitForTimeout(1400);
    // Scroll the whole page so lazy content paints before we measure geometry.
    await pg.evaluate(`(async()=>{const s=Math.round(innerHeight*0.85);
      for(let y=0;y<document.body.scrollHeight;y+=s){scrollTo(0,y);
        await new Promise(r=>setTimeout(r,110));} scrollTo(0,0);
      await new Promise(r=>setTimeout(r,250));})()`);
    const data = await pg.evaluate(EXTRACT);
    pages[slug] = data;
    const noLabel = data.entries.filter(e => !e.label).length;
    if (noLabel) weak.push({ slug, noLabel, total: data.entries.length });
    console.log(`  [${String(i + 1).padStart(3)}/${wanted.length}] ` +
      slug.padEnd(44) + String(data.entries.length).padStart(3) + ' links' +
      (noLabel ? `  (${noLabel} unnamed)` : ''));
  } catch (err) {
    console.log('  [%d] FAILED %s :: %s', i + 1, slug, String(err).slice(0, 90));
  }
}
await browser.close();

// ---- render
mkdirSync(REBUILD, { recursive: true });
let written = 0;

for (const lib of inv.libs) {
  if (only && lib.slug !== only) continue;
  const kids = (inv.tree[lib.slug] || []).filter(k => pages[k]);
  const self = pages[lib.slug];
  const own = self ? self.entries : [];

  // On a hub, the child pages are already listed as sections, so they must not
  // be repeated in the link list below.
  const selfPage = { entries: own, internal: (self && self.internal) || [] };
  const extra = selfPage.entries.length + selfPage.internal.filter(i => !kids.includes(i.path)).length;
  const body = kids.length
    ? hubBody(lib, kids, pages) + (extra ? leafBody(selfPage, { skipInternal: kids }) : '')
    : leafBody(selfPage);

  const items = kids.length
    ? kids.map(k => ({ name: tidy(fixCase(pages[k]?.title || k)), url: 'https://medpsycmoss.com/' + k }))
    : own.map(e => ({ name: tidy(e.label || deriveLabel(e)), url: e.href }));

  const html = shell({
    slug: lib.slug,
    title: lib.name,
    desc: lib.desc,
    h1: tidy(lib.name),
    kicker: `<span>FOR: <b>${lib.audience === 'providers' ? 'HEALTH CARE PROVIDERS' : 'PATIENTS'}</b></span>
      <span>ACCESS: <b>FREE, NO EMAIL REQUIRED</b></span>
      <span>LINKS: <b>${kids.length ? kids.length + ' SECTIONS' : own.length + ' RESOURCES'}</b></span>`,
    intro: esc(tidy(lib.desc)),
    body,
    crumbs: `<a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/resources">Resources</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(tidy(lib.name))}</span>`,
    ld: ldFor({ slug: lib.slug, name: lib.name, desc: lib.desc, items }),
  });
  writeFileSync(path.join(REBUILD, lib.slug + '.html'), html);
  written++;
}

const parentOf = {};
for (const [hub, kids] of Object.entries(inv.tree)) for (const k of kids) parentOf[k] = hub;
const libBySlug = Object.fromEntries(inv.libs.map(l => [l.slug, l]));

for (const slug of [...inv.leaves, 'events', 'interviews', 'vlogs']) {
  if (only && slug !== only) continue;
  const p = pages[slug];
  if (!p) continue;
  const name = tidy(fixCase(p.title || titleFromSlug(slug)));
  const parent = libBySlug[parentOf[slug]];
  const desc = `${name}. Free resources collected by Stephanie Moss, MD.`;

  const crumbs = parent
    ? `<a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/resources">Resources</a> <span aria-hidden="true">/</span> <a href="/${esc(parent.slug)}">${esc(tidy(parent.name))}</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(name)}</span>`
    : `<a href="/">Home</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(name)}</span>`;

  const html = shell({
    slug,
    title: name,
    desc,
    h1: name,
    kicker: `<span>ACCESS: <b>FREE</b></span><span>LINKS: <b>${p.entries.length}</b></span>`,
    // No inline anchor here: the tap-target floor applies to every a[href], and
    // the breadcrumb above already links back to the parent library.
    intro: `Every link below is free to open.${parent ? ` Part of the ${esc(tidy(parent.name))} library.` : ''}`,
    body: leafBody(p, { parentSlug: parent ? parent.slug : 'resources' }),
    crumbs,
    ld: ldFor({
      slug, name, desc,
      items: p.entries.map(e => ({ name: tidy(e.label || deriveLabel(e)), url: e.href })),
    }),
  });
  writeFileSync(path.join(REBUILD, slug.replace(/\//g, '_') + '.html'), html);
  written++;
}

console.log('\nwrote %d pages into rebuild/', written);
if (weak.length) {
  console.log('\npages with links the archive never named (fallback label derived from URL):');
  for (const w of weak.sort((a, b) => b.noLabel - a.noLabel).slice(0, 20)) {
    console.log('   ' + w.slug.padEnd(44) + `${w.noLabel} of ${w.total}`);
  }
}
writeFileSync(path.join(ROOT, 'reports', 'resource-build.json'),
  JSON.stringify({ pages, weak }, null, 2));
