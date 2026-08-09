#!/usr/bin/env node
/**
 * Restructure the primary navigation, per her review.
 *
 * Before:  STORE | FREE (-> patient resources) | PATIENT&DOCTOR (-> the About
 *          page) | PODCAST
 * After:   FREE GUIDES | PATIENT&DOCTOR | PODCAST | STORE | ABOUT
 *
 * Two of the old tabs pointed at the wrong thing: FREE went to the patient
 * resource libraries, and PATIENT&DOCTOR went to the About page. Free Guides is
 * now her blog-based guides, Patient&Doctor owns the resource libraries, and
 * About has its own tab.
 *
 * The shell is inlined in every page rather than included at runtime, so this
 * rewrites all of them and re-derives aria-current from each page's canonical.
 */

import fs from 'node:fs';
import path from 'node:path';

const R = path.resolve('rebuild');

export const NAV = [
  { key: 'guides', label: 'FREE GUIDES', href: '/free-guides' },
  { key: 'patients', label: 'PATIENT&amp;DOCTOR', href: '/resources' },
  { key: 'podcast', label: 'PODCAST', href: '/podcast' },
  { key: 'store', label: 'STORE', href: '/store' },
  { key: 'about', label: 'ABOUT', href: '/about-me' },
];

const DOCK_ITEMS = [
  { key: 'guides', label: 'Guides', href: '/free-guides',
    svg: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 16.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5z"/>' },
  { key: 'patients', label: 'Patients', href: '/resources',
    svg: '<path d="M12 20s-7-4.35-7-9a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 4.65-7 9-7 9z"/>' },
  { key: 'podcast', label: 'Podcast', href: '/podcast',
    svg: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>' },
  { key: 'store', label: 'Store', href: '/store',
    svg: '<path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>' },
  { key: 'about', label: 'About', href: '/about-me',
    svg: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>' },
];

/** Which nav item a page belongs under, from its canonical path. */
export function sectionFor(urlPath) {
  const p = (urlPath || '').replace(/\/$/, '') || '/';
  if (p === '/about-me') return 'about';
  if (p === '/podcast') return 'podcast';
  if (p === '/store' || p.startsWith('/store/') || p.startsWith('/products')) return 'store';
  if (p === '/free-guides' || p.startsWith('/free-guides/')) return 'guides';
  if (p.startsWith('/blog')) return 'guides';
  if (p === '/') return null;
  // everything else is a resource library or one of its child pages
  return 'patients';
}

export function headerHTML(current) {
  const links = NAV.map(n =>
    `        <li><a href="${n.href}"${n.key === current ? ' aria-current="page"' : ''}>${n.label}</a></li>`
  ).join('\n');
  return `<header class="top">
  <div class="wrap top-in">
    <a href="/" class="logo"><span class="mp">MedPsyc</span><span class="moss">Moss</span><span class="md">STEPHANIE MOSS, MD</span></a>
    <nav aria-label="Primary">
      <ul class="top-links">
${links}
      </ul>
    </nav>
    <a href="/store" class="btn">Browse the store</a>
  </div>
</header>`;
}

export function dockHTML(current) {
  const items = DOCK_ITEMS.map(d =>
    `  <a href="${d.href}"${d.key === current ? ' aria-current="page"' : ''}>
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d.svg}</svg>
    ${d.label}
  </a>`).join('\n');
  return `<nav class="dock" aria-label="Quick navigation">\n${items}\n</nav>`;
}

// ---------------------------------------------------------------- apply
if (process.argv[1] && process.argv[1].endsWith('update-nav.mjs')) {
  const files = fs.readdirSync(R).filter(f => f.endsWith('.html'));
  let changed = 0, noHeader = 0, noDock = 0;

  for (const f of files) {
    const p = path.join(R, f);
    let html = fs.readFileSync(p, 'utf8');
    const before = html;

    const canon = html.match(/<link rel=["']canonical["'] href=["']([^"']+)["']/);
    const urlPath = canon ? canon[1].replace('https://medpsycmoss.com', '') : '/';
    const current = sectionFor(urlPath);

    if (/<header class="top">[\s\S]*?<\/header>/.test(html)) {
      html = html.replace(/<header class="top">[\s\S]*?<\/header>/, headerHTML(current));
    } else noHeader++;

    if (/<nav class="dock"[\s\S]*?<\/nav>/.test(html)) {
      html = html.replace(/<nav class="dock"[\s\S]*?<\/nav>/, dockHTML(current));
    } else if (html.includes('</body>')) {
      // 79 generated pages shipped with no dock at all: build-resources.mjs
      // lifted it with a search that matched the header's </nav> first. The CSS
      // still reserves padding-bottom for it, so those pages had a dead gap and
      // no bottom navigation on mobile. Insert it.
      html = html.replace('</body>', dockHTML(current) + '\n\n</body>');
      noDock++;
    }

    if (html !== before) { fs.writeFileSync(p, html); changed++; }
  }

  // Keep the partials in step; they are the documented source of the shell.
  fs.writeFileSync(path.join(R, 'partials', 'header.html'), headerHTML(null) + '\n');
  fs.writeFileSync(path.join(R, 'partials', 'dock.html'), dockHTML(null) + '\n');

  console.log(`pages rewritten : ${changed} / ${files.length}`);
  if (noHeader) console.log(`  without a header block : ${noHeader}`);
  if (noDock) console.log(`  without a dock block   : ${noDock}`);
  console.log('partials/header.html and partials/dock.html updated');
}
