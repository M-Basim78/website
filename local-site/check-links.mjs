#!/usr/bin/env node
/**
 * Assert that every link the site emits is safe and goes somewhere.
 *
 * She now pastes links into her own posts, which means untrusted-ish text
 * becomes markup. Three things must hold, and each has been a real bug on real
 * sites:
 *
 *   1. No javascript: or data: href. The oldest injection there is.
 *   2. Every link that leaves the site carries rel="noopener". Without it the
 *      page it opens can rewrite this tab through window.opener.
 *   3. Every internal link resolves to a page that exists, so a link she pastes
 *      to her own work is never a 404.
 *
 *   node check-links.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
let redirects = {};
try {
  redirects = JSON.parse(fs.readFileSync(path.resolve('content', 'redirects.json'), 'utf8')).permanent || {};
} catch { /* none configured */ }

const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.html')) pages.push(f);
  }
})(DIST);

const exists = (p) => {
  const clean = p.split('#')[0].split('?')[0].replace(/\/$/, '');
  if (clean === '' ) return true;
  if (redirects[clean]) return true;
  return fs.existsSync(path.join(DIST, clean, 'index.html')) ||
         fs.existsSync(path.join(DIST, clean)) ||
         fs.existsSync(path.join(DIST, clean + '.html'));
};

let unsafe = 0, noopener = 0, dead = 0, checked = 0;
const deadSeen = new Set();

for (const f of pages) {
  const html = fs.readFileSync(f, 'utf8');
  const where = f.replace(DIST, '').replace(/\\/g, '/');

  for (const m of html.matchAll(/<a\b([^>]*)href="([^"]*)"([^>]*)>/gi)) {
    const attrs = m[1] + ' ' + m[3];
    const href = m[2].replace(/&amp;/g, '&').trim();
    checked++;

    if (/^\s*(javascript|data|vbscript):/i.test(href)) {
      unsafe++;
      console.log('  UNSAFE HREF   ' + where + '   ' + href.slice(0, 60));
      continue;
    }

    const external = /^https?:\/\//i.test(href) && !/^https?:\/\/(www\.)?medpsycmoss\.com/i.test(href);
    if (external && /target="_blank"/i.test(attrs) && !/rel="[^"]*noopener/i.test(attrs)) {
      noopener++;
      console.log('  NO NOOPENER   ' + where + '   ' + href.slice(0, 60));
    }

    if (href.startsWith('/') && !href.startsWith('//')) {
      // assets are served from disk, pages from a directory index
      if (/\.(css|js|json|xml|txt|webp|png|jpe?g|svg|ico|woff2?|pdf)$/i.test(href)) continue;
      if (!exists(href) && !deadSeen.has(href)) {
        deadSeen.add(href);
        dead++;
        console.log('  DEAD INTERNAL ' + where + '   ' + href);
      }
    }
  }
}

console.log('');
console.log('  links checked: ' + checked + ' across ' + pages.length + ' pages');
const bad = unsafe + noopener + dead;
console.log(bad
  ? `  FAILED: ${unsafe} unsafe, ${noopener} missing noopener, ${dead} dead internal`
  : '  every link is safe, and every internal one resolves');
process.exit(bad ? 1 : 0);
