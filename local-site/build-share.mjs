/**
 * Produce a single self-contained HTML file for sending to the client.
 *
 * The served page at /new depends on the local mirror for its fonts, images and
 * internal links.  This build inlines every asset as a data URI and repoints the
 * site links at medpsycmoss.com, so the result opens by double-clicking it,
 * works offline, and survives being emailed as one attachment.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve('rebuild', 'index.html');
const OUT = path.resolve('share', 'medpsycmoss-homepage.html');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

let html = fs.readFileSync(SRC, 'utf8');
const asData = (rel, mime) =>
  `data:${mime};base64,${fs.readFileSync(path.resolve('rebuild', rel)).toString('base64')}`;

// 1. fonts -> data URIs, and drop the preloads (nothing left to preload)
html = html.replace(/^\s*<link rel="preload"[^>]*fonts[^>]*>\s*$/gm, '');
html = html.replace(/url\(\/new\/fonts\/([\w-]+\.woff2)\)/g,
  (_, f) => `url(${asData(path.join('fonts', f), 'font/woff2')})`);

// 2. images -> data URIs.  srcset/sizes go away: with the bytes already in the
//    document there is nothing for the browser to choose between.
html = html.replace(/\n\s*srcset="[^"]*"/g, '').replace(/\n\s*sizes="[^"]*"/g, '');
html = html.replace(/srcset="[^"]*"\s*/g, '').replace(/sizes="\([^"]*"\s*/g, '');
html = html.replace(/src="\/new\/img\/([\w-]+\.webp)"/g,
  (_, f) => `src="${asData(path.join('img', f), 'image/webp')}"`);

// 3. favicon
html = html.replace('href="/new/favicon.svg"',
  `href="${asData('favicon.svg', 'image/svg+xml')}"`);

// 4. site-relative links -> absolute, so they still work from a file:// page
html = html.replace(/href="\/(?!\/)([^"#]*)"/g, (m, p) => `href="https://medpsycmoss.com/${p}"`);

// 5. a short banner so nobody mistakes the preview for the live site
html = html.replace('<body>', `<body>
<!-- Homepage rebuild preview - Stephanie Moss, MD / medpsycmoss.com
     Self-contained: fonts and images are embedded, no network needed.
     Store links point at the current live store; change STORE_BASE at the
     bottom of this file to repoint them at store.medpsycmoss.com. -->`);

const leftovers = html.match(/\/new\//g);
if (leftovers) console.log(`WARNING: ${leftovers.length} unresolved /new/ references`);

fs.writeFileSync(OUT, html);
console.log(`${OUT}\n${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, single file`);
