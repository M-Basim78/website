/**
 * Stage 0B. Split the homepage into a shared shell every page consumes:
 *   css/site.css   all design tokens and component styles
 *   js/site.js     store links, ECG, marquee, reveals, dock
 *   partials/*.html  head boilerplate, header, footer, dock
 * The homepage is rewritten to link them, so it stays the reference page.
 */
import fs from 'fs';
import path from 'path';

const R = path.resolve('rebuild');
const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
fs.mkdirSync(path.join(R, 'css'), { recursive: true });
fs.mkdirSync(path.join(R, 'js'), { recursive: true });
fs.mkdirSync(path.join(R, 'partials'), { recursive: true });

// ---- css -------------------------------------------------------------------
const style = html.match(/<style>([\s\S]*?)<\/style>/);
if (!style) throw new Error('no <style> block found');
fs.writeFileSync(path.join(R, 'css', 'site.css'),
  `/* MedPsycMoss shared stylesheet. Single source of truth for every page.\n` +
  `   See design-system.md. Do not fork this file per page. */\n` +
  style[1].replace(/^\n/, ''));

// ---- js --------------------------------------------------------------------
const scripts = [...html.matchAll(/<script(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)];
const behaviour = scripts.find(s => s[1].includes('STORE_BASE'));
if (!behaviour) throw new Error('no behaviour script found');
fs.writeFileSync(path.join(R, 'js', 'site.js'),
  `/* MedPsycMoss shared behaviour. Loaded by every page with <script src="/new/js/site.js" defer>.\n` +
  `   Guards mean a page can omit any component without erroring. */\n` +
  behaviour[1].replace(/^\n/, ''));

// ---- partials --------------------------------------------------------------
const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.log(`  ! could not extract ${name}`); return ''; }
  fs.writeFileSync(path.join(R, 'partials', `${name}.html`), m[0].trim() + '\n');
  return m[0];
};
const header = grab(/<header class="top">[\s\S]*?<\/header>/, 'header');
const footer = grab(/<footer>[\s\S]*?<\/footer>/, 'footer');
const dock = grab(/<nav class="dock"[\s\S]*?<\/nav>/, 'dock');

fs.writeFileSync(path.join(R, 'partials', 'head.html'), `<!-- Paste inside <head> on every page. Replace TITLE / DESCRIPTION / SLUG. -->
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

<title>TITLE | MedPsycMoss</title>
<meta name="description" content="DESCRIPTION">
<link rel="canonical" href="https://medpsycmoss.com/SLUG">
<meta name="author" content="Stephanie Moss, MD">
<meta name="theme-color" content="#6E1F35">
<link rel="icon" href="/new/favicon.svg" type="image/svg+xml">

<meta property="og:type" content="website">
<meta property="og:site_name" content="MedPsycMoss | Stephanie Moss, MD">
<meta property="og:url" content="https://medpsycmoss.com/SLUG">
<meta property="og:title" content="TITLE | MedPsycMoss">
<meta property="og:description" content="DESCRIPTION">
<meta property="og:image" content="https://medpsycmoss.com/img/moss-doctor.webp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1600">
<meta property="og:image:alt" content="Stephanie Moss, MD.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="TITLE | MedPsycMoss">
<meta name="twitter:description" content="DESCRIPTION">
<meta name="twitter:image" content="https://medpsycmoss.com/img/moss-doctor.webp">

<link rel="preload" href="/new/fonts/bricolage-grotesque-300-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/new/fonts/inter-400-600.woff2" as="font" type="font/woff2" crossorigin>
<script>document.documentElement.classList.add("js")</script>
<link rel="stylesheet" href="/new/css/site.css">
<script src="/new/js/site.js" defer></script>
`);

// ---- rewrite the homepage to consume the shell -----------------------------
let out = html
  .replace(/<style>[\s\S]*?<\/style>/, '<script>document.documentElement.classList.add("js")</script>
<link rel="stylesheet" href="/new/css/site.css">')
  .replace(behaviour[0], '<script src="/new/js/site.js" defer></script>');

// the preloads must stay ahead of the stylesheet; move the link after them
fs.writeFileSync(path.join(R, 'index.html'), out);

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1) + ' KB';
console.log('css/site.css      ', kb(path.join(R, 'css', 'site.css')));
console.log('js/site.js        ', kb(path.join(R, 'js', 'site.js')));
for (const p of ['head', 'header', 'footer', 'dock']) {
  const f = path.join(R, 'partials', `${p}.html`);
  if (fs.existsSync(f)) console.log(`partials/${p}.html`.padEnd(18), kb(f));
}
console.log('index.html        ', kb(path.join(R, 'index.html')));
