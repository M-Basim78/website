/**
 * The page inventory for the rebuild, derived from the archive rather than
 * hand-listed, so nothing is missed.
 *
 * `/resources` already carries an approved name + description for all 17
 * libraries; those are parsed straight out of it instead of being rewritten.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const BACKUP = path.resolve(ROOT, '..', 'medpsycmoss-backup-20260727', 'backup');
export const PAGES = path.join(BACKUP, 'pages');
export const REBUILD = path.join(ROOT, 'rebuild');

export const clean = s => (s || '')
  .replace(/[\u200B-\u200F\uFEFF\u2060]/g, '')
  .replace(/[\uE000-\uF8FF]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const archivePath = slug =>
  path.join(PAGES, slug.replace(/\//g, '_') + '.html');

export const hasArchive = slug => existsSync(archivePath(slug));

/** The 17 libraries, with the names and blurbs already approved on /resources. */
export function libraries() {
  const html = readFileSync(path.join(REBUILD, 'resources.html'), 'utf8');
  const doc = new JSDOM(html).window.document;
  const out = [];
  const seen = new Set();
  // Patient libraries render as .tile cards; provider libraries as .fr rows.
  for (const a of doc.querySelectorAll('a.tile[href], a.fr[href]')) {
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/')) continue;
    const slug = href.replace(/^\/|\/$/g, '');
    if (!slug || seen.has(slug)) continue;

    const isTile = a.classList.contains('tile');
    const nameEl = isTile ? a.querySelector('h3') : a.querySelector('.t');
    const descEl = isTile ? a.querySelector('p') : a.querySelector('.d');
    const catEl = a.querySelector('.cat');
    if (!nameEl) continue;

    seen.add(slug);
    out.push({
      slug,
      name: clean(nameEl.textContent),
      desc: clean(descEl ? descEl.textContent : ''),
      cat: clean(catEl ? catEl.textContent : ''),
      audience: isTile ? 'patients' : 'providers',
    });
  }
  return out;
}

/** Internal pages a given archived page links to (its children). */
export function childrenOf(slug) {
  if (!hasArchive(slug)) return [];
  const doc = new JSDOM(readFileSync(archivePath(slug), 'utf8')).window.document;
  const skip = new Set(['', 'about-me', 'blog', 'podcast', 'store', 'resources',
    'my-work', 'contact', 'about', 'index']);
  const kids = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    let u;
    try { u = new URL(a.getAttribute('href') || '', 'https://medpsycmoss.com/'); }
    catch { continue; }
    if (!/(^|\.)medpsycmoss\.com$/i.test(u.hostname)) continue;
    const rel = decodeURIComponent(u.pathname).replace(/^\/|\/$/g, '');
    if (!rel || skip.has(rel.toLowerCase())) continue;
    if (rel.startsWith('store/') || rel.startsWith('products/')) continue;
    if (!kids.includes(rel)) kids.push(rel);
  }
  return kids;
}

/** Full inventory: every library plus every child page beneath it. */
export function inventory() {
  const libs = libraries();
  const hubs = libs.map(l => l.slug);
  const tree = {};
  const leaves = new Set();

  for (const l of libs) {
    const kids = childrenOf(l.slug).filter(k => !hubs.includes(k) && hasArchive(k));
    tree[l.slug] = kids;
    kids.forEach(k => leaves.add(k));
  }
  return { libs, hubs, tree, leaves: [...leaves].sort() };
}
