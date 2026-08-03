#!/usr/bin/env node
/**
 * Generate rebuild/sitemap.xml from the pages that actually exist in rebuild/,
 * so the sitemap can never claim a page we did not ship.
 *
 * Priority follows depth: the homepage, then the top nav, then the libraries,
 * then their child pages.
 */

import { readdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { REBUILD, ROOT, inventory } from './lib-pages.mjs';

const TOP = ['index', 'about-me', 'store', 'podcast', 'blog', 'resources',
  'my-work', 'contact'];

const inv = inventory();
const hubs = new Set(inv.libs.map(l => l.slug));

const files = readdirSync(REBUILD)
  .filter(f => f.endsWith('.html'))
  .map(f => f.replace(/\.html$/, ''));

const today = statSync(path.join(REBUILD, 'index.html')).mtime
  .toISOString().slice(0, 10);

function priority(slug) {
  if (slug === 'index') return '1.0';
  if (TOP.includes(slug)) return '0.9';
  if (hubs.has(slug)) return '0.7';
  return '0.5';
}

function loc(slug) {
  return 'https://medpsycmoss.com/' + (slug === 'index' ? '' : slug);
}

// Stable, human-readable order.
const rank = s => (s === 'index' ? 0 : TOP.includes(s) ? 1 : hubs.has(s) ? 2 : 3);
files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

const urls = files.map(slug => `  <url>
    <loc>${loc(slug)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${rank(slug) <= 1 ? 'weekly' : 'monthly'}</changefreq>
    <priority>${priority(slug)}</priority>
  </url>`).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

writeFileSync(path.join(REBUILD, 'sitemap.xml'), xml);

const robots = `User-agent: *
Allow: /

Sitemap: https://medpsycmoss.com/sitemap.xml
`;
writeFileSync(path.join(REBUILD, 'robots.txt'), robots);

console.log('sitemap.xml : ' + files.length + ' urls');
console.log('  homepage        1');
console.log('  top nav         ' + files.filter(f => rank(f) === 1).length);
console.log('  libraries       ' + files.filter(f => rank(f) === 2).length);
console.log('  child pages     ' + files.filter(f => rank(f) === 3).length);
console.log('robots.txt  : written');
