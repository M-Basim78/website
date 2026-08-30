/**
 * Build a page for every archived article: blog posts, interview episodes and
 * vlog pages. The blog index and podcast page link to these, so without them the
 * site ships ~190 dead internal links.
 *
 * Content comes from the archived rendered DOM. Only the article body is taken;
 * the Gator chrome is dropped and our own shell is wrapped around it. Nothing is
 * written that is not in the archive.
 */
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const R = path.resolve('rebuild');
const BACKUP = path.resolve('..', 'medpsycmoss-backup-20260727', 'backup');
const PAGES = path.join(BACKUP, 'pages');

const shell = fs.readFileSync(path.join(R, 'store.html'), 'utf8');
const HEADER = shell.match(/<header class="top">[\s\S]*?<\/header>/)[0];
const FOOTER = shell.match(/<footer>[\s\S]*?<\/footer>/)[0];
const DOCK = shell.match(/<nav class="dock"[\s\S]*?<\/nav>/)[0];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (s) => (s || '')
  .replace(/[-]/g, '')          // Gator icon-font private use area
  .replace(/​|⁠|﻿/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// Which archived pages are articles we want. The manifest is the authority on
// what actually exists and what was a 404.
const manifest = fs.readFileSync(path.join(BACKUP, 'manifest.txt'), 'utf8');
const rows = [...manifest.matchAll(/^(https?:\/\/\S+)\s+(\S+\.html)\s+(\d+)\s+chars(\s+\[404\])?\s*$/gm)]
  .filter(m => !m[4])
  .map(m => ({ url: new URL(m[1]).pathname.replace(/\/+$/, '') || '/', file: m[2], chars: +m[3] }));

// pages already built by hand or by the resource generator
const existing = new Set(fs.readdirSync(R).filter(f => f.endsWith('.html'))
  .map(f => '/' + f.replace(/\.html$/, '').replace(/_/g, '/')));

// Any archived page with real content that nothing has built yet. Tag and
// pagination listings are excluded: they are Gator list widgets whose content
// comes from the broken fetchContent endpoint, and /blog already owns that
// content. Their archived shells are also corrupt, with every nav link rewritten
// against a /view/tag/... base.
const wanted = rows.filter(r =>
  r.chars > 800 &&
  !existing.has(r.url.toLowerCase()) &&
  !/\/(tag|page)\//.test(r.url) &&
  !/^\/store\//.test(r.url) &&
  r.url !== '/'
);

// de-duplicate case-variant urls (the crawler saved both /blog/X and /blog/x)
const seen = new Map();
for (const w of wanted) if (!seen.has(w.url.toLowerCase())) seen.set(w.url.toLowerCase(), w);
const list = [...seen.values()];

console.log(`archived articles to build: ${list.length}`);

let built = 0, skipped = 0;
for (const item of list) {
  const src = path.join(PAGES, item.file);
  if (!fs.existsSync(src)) { skipped++; continue; }

  const dom = new JSDOM(fs.readFileSync(src, 'utf8'));
  const doc = dom.window.document;

  // title: the biggest heading that is not site chrome
  const CHROME = /^(medicine|psychiatry|moss|home|about me|blog|podcast|store|resources|my work|contact|subscribe|tags|explore|connect|popular resources)$/i;
  let title = '';
  for (const h of doc.querySelectorAll('h1,h2,h3')) {
    const t = clean(h.textContent);
    if (t.length > 8 && !CHROME.test(t)) { title = t; break; }
  }
  if (!title) title = clean(doc.title) || item.url.split('/').pop().replace(/[-_]/g, ' ');

  // body: paragraphs and list items, in document order, minus chrome and nav
  // Gator renders body copy as nested <div>s, not <p>, so restricting the query
  // to paragraphs silently skipped whole pages. Take any leaf-ish block that
  // carries its own text and no block children of its own.
  const seenText = new Set();
  const blocks = [];
  const BLOCK = 'P,LI,H2,H3,H4,BLOCKQUOTE,DIV';
  for (const el of doc.querySelectorAll('p, li, h2, h3, h4, blockquote, div')) {
    if (el.closest('nav, footer, header, .dock')) continue;
    if (el.tagName === 'DIV' && el.querySelector(BLOCK)) continue;   // not a leaf
    const t = clean(el.textContent);
    if (t.length < 25 || CHROME.test(t)) continue;
    if (t === title || seenText.has(t)) continue;
    // skip a block that merely repeats text already captured
    if ([...seenText].some(s => s.includes(t))) continue;
    seenText.add(t);
    const tag = el.tagName.toLowerCase();
    blocks.push(/^h[234]$/.test(tag) ? `<h2>${esc(t)}</h2>` : `<p>${esc(t)}</p>`);
  }
  if (blocks.length < 1) { skipped++; continue; }

  const desc = clean(blocks.find(b => b.startsWith('<p>'))?.replace(/<[^>]+>/g, '') || title).slice(0, 155);
  const isInterview = !/^\/blog\//.test(item.url);
  const kind = isInterview ? 'Interview' : 'Blog';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

<title>${esc(title.slice(0, 62))} | MedPsycMoss</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="https://medpsycmoss.com${item.url}">
<meta name="author" content="Stephanie Moss, MD">
<meta name="theme-color" content="#6E1F35">
<link rel="icon" href="/new/favicon.svg" type="image/svg+xml">

<meta property="og:type" content="article">
<meta property="og:site_name" content="MedPsycMoss | Stephanie Moss, MD">
<meta property="og:url" content="https://medpsycmoss.com${item.url}">
<meta property="og:title" content="${esc(title.slice(0, 62))} | MedPsycMoss">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://medpsycmoss.com/img/moss-doctor.webp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1600">
<meta property="og:image:alt" content="Stephanie Moss, MD.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title.slice(0, 62))} | MedPsycMoss">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://medpsycmoss.com/img/moss-doctor.webp">

<link rel="preload" href="/new/fonts/bricolage-grotesque-300-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/new/fonts/inter-400-600.woff2" as="font" type="font/woff2" crossorigin>
<script>document.documentElement.classList.add("js")</script>
<link rel="stylesheet" href="/new/css/site.css">
<script src="/new/js/site.js" defer></script>
</head>
<body>

<a class="skip" href="#main">Skip to content</a>

${HEADER}

<main id="main">

<section class="hero" aria-labelledby="a-title">
  <div class="mesh"></div>
  <div class="wrap">
    <p class="kicker in"><span>${kind.toUpperCase()}</span><span>BY <b>STEPHANIE MOSS, MD</b></span></p>
    <h1 id="a-title">${esc(title)}</h1>
  </div>
</section>

<section aria-labelledby="a-title">
  <div class="wrap">
    <article class="prose reveal">
${blocks.map(b => '      ' + b).join('\n')}
    </article>
    <div class="store-more reveal">
      <a class="btn dark" href="${isInterview ? '/podcast' : '/blog'}">Back to ${isInterview ? 'the podcast' : 'the blog'}</a>
    </div>
  </div>
</section>

</main>

${FOOTER}

${DOCK}

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": ${JSON.stringify(title.slice(0, 110))},
  "description": ${JSON.stringify(desc)},
  "author": { "@type": "Person", "name": "Stephanie Moss", "honorificSuffix": "MD" },
  "publisher": { "@type": "Person", "name": "Stephanie Moss, MD" },
  "mainEntityOfPage": "https://medpsycmoss.com${item.url}"
}
</script>
</body>
</html>
`;

  const file = item.url.slice(1).replace(/\//g, '_') + '.html';
  fs.writeFileSync(path.join(R, file), html);
  built++;
}

console.log(`built: ${built}   skipped (too thin or missing): ${skipped}`);
