#!/usr/bin/env node
/**
 * Pull the real resource entries out of the archived DOM.
 *
 * The resource pages are link directories. In Gator's markup an entry is
 * sometimes a plain <a>text</a>, and sometimes a card where the <a> wraps only
 * an image and the visible title sits in a sibling node. The markdown export
 * loses that pairing, so we read the saved DOM and rebuild it here.
 *
 * Output: rebuild/data/resources.json  (consumed by build-resources.mjs)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PAGES = path.resolve(ROOT, '..', 'medpsycmoss-backup-20260727', 'backup', 'pages');
const OUT = path.join(ROOT, 'rebuild', 'data', 'resources.json');

const NAV = new Set(['home', 'about me', 'blog', 'podcast', 'store', 'resources',
  'my work', 'contact', 'about', 'workbooks & courses', 'all resources',
  'residency personal statement examples', 'mock interview prep',
  'leave of absence guide', 'usmle accommodations help', 'instagram', 'youtube',
  'more', 'button', 'title', 'psychiatry', 'medicine', 'moss',
  'psychiatry resident', 'medical doctor (m.d)', 'lived experience']);

const SKIP_HOST = /(^|\.)(medpsycmoss\.com|gator\.com|mywebsitebuilder\.com)$/i;

const clean = s => (s || '')
  .replace(/[​-‏﻿⁠]/g, '')
  .replace(/[-]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Best human label for an anchor, trying progressively wider context. */
function labelFor(a, doc) {
  const own = clean(a.textContent);
  if (own && !NAV.has(own.toLowerCase())) return own;

  const img = a.querySelector('img');
  if (img) {
    const alt = clean(img.getAttribute('alt'));
    if (alt && !NAV.has(alt.toLowerCase())) return alt;
  }
  // Walk up a few levels and take the first sensible text that is not the link itself.
  let node = a.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const heading = node.querySelector('h1,h2,h3,h4,h5,h6');
    if (heading) {
      const t = clean(heading.textContent);
      if (t && !NAV.has(t.toLowerCase())) return t;
    }
    const t = clean(node.textContent);
    if (t && t.length < 120 && !NAV.has(t.toLowerCase())) return t;
  }
  try {
    return new URL(a.href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The page's own title: the first big heading that is not chrome. */
function pageTitle(doc) {
  for (const h of doc.querySelectorAll('h1,h2,h3')) {
    const t = clean(h.textContent);
    if (t && !NAV.has(t.toLowerCase()) && t.length > 3) return t;
  }
  return clean(doc.title);
}

export function extract(slug) {
  const file = path.join(PAGES, slug.replace(/\//g, '_') + '.html');
  if (!existsSync(file)) return null;

  const dom = new JSDOM(readFileSync(file, 'utf8'));
  const doc = dom.window.document;

  const title = pageTitle(doc);
  const seen = new Set();
  const entries = [];

  for (const a of doc.querySelectorAll('a[href]')) {
    let href = a.getAttribute('href') || '';
    if (!/^https?:/i.test(href)) continue;
    let host;
    try { host = new URL(href).hostname; } catch { continue; }
    if (SKIP_HOST.test(host)) continue;

    const label = labelFor(a, doc);
    if (!label || NAV.has(label.toLowerCase())) continue;

    const key = href.replace(/[#?].*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({ label, href, host: host.replace(/^www\./, '') });
  }

  // Internal links to other archived pages, so hubs can list their children.
  const children = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    let u;
    try { u = new URL(href, 'https://medpsycmoss.com/'); } catch { continue; }
    if (!/medpsycmoss\.com$/i.test(u.hostname)) continue;
    const rel = u.pathname.replace(/^\/|\/$/g, '');
    if (!rel || NAV.has(rel.toLowerCase())) continue;
    if (['about-me', 'blog', 'podcast', 'store', 'resources', 'my-work',
      'contact', 'about'].includes(rel)) continue;
    if (!children.includes(rel)) children.push(rel);
  }

  return { slug, title, entries, children };
}

// ---------------------------------------------------------------- main
const HUBS = ['trauma-resources', 'websites-for-trauma', 'pelvic-pain-resources',
  'mental-health-resources', 'sexual-health-resources', 'endometriosis-resources',
  'infertility-resources', 'menopause-resources', 'disabilities-resources',
  'lqbtqia-resources'];

const EXTRA = ['events', 'interviews', 'vlogs'];

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1].endsWith('extract-resources.mjs')) {
  const out = {};
  const queue = [...HUBS, ...EXTRA];
  const done = new Set();

  while (queue.length) {
    const slug = queue.shift();
    if (done.has(slug)) continue;
    done.add(slug);
    const r = extract(slug);
    if (!r) { console.log('  MISSING  ' + slug); continue; }
    out[slug] = r;
    // one level down from the hubs
    if (HUBS.includes(slug)) {
      for (const c of r.children) if (!done.has(c)) queue.push(c);
    }
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2));

  const pages = Object.keys(out);
  console.log('pages extracted : ' + pages.length);
  console.log('total entries   : ' +
    pages.reduce((n, k) => n + out[k].entries.length, 0));
  console.log('\nthin pages (fewer than 3 entries):');
  for (const k of pages) {
    if (out[k].entries.length < 3) {
      console.log('  %s  %d  "%s"', k.padEnd(44), out[k].entries.length, out[k].title);
    }
  }
  console.log('\nwrote ' + path.relative(ROOT, OUT));
}
