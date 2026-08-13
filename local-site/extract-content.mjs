/**
 * Invert the generated HTML back into editable content.
 *
 * Until now every word on the site was baked into HTML by a build script that
 * needed the 2 GB crawl archive, so the client could not change anything without
 * a developer. This pulls the editable surfaces out into content/ as markdown and
 * JSON, which the CMS can then edit and the build reads back.
 *
 * Run once. After this, content/ is the source of truth, not the archive.
 */
import fs from 'fs';
import path from 'path';

const R = path.resolve('rebuild');
const C = path.resolve('content');
fs.mkdirSync(path.join(C, 'blog'), { recursive: true });

const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const dec = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ');
const strip = (s) => dec(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
// YAML-safe scalar. Quote anything that could be misread, escape inner quotes.
const y = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ---------------------------------------------------------------- articles --
let posts = 0;
for (const f of fs.readdirSync(R).filter(x => x.endsWith('.html'))) {
  const html = read(f);
  const art = html.match(/<article class="prose[^"]*">([\s\S]*?)<\/article>/);
  if (!art) continue;

  // The slug must come from the page's own canonical, never from the filename.
  // Underscores in a filename are ambiguous: blog_tag_disability.html is
  // /blog/tag/disability, but blog_failure_identiy.html is /blog/failure_identiy.
  // Deriving it by replacing every underscore broke eight real URLs.
  const canon = (html.match(/<link rel=["']canonical["'] href=["']([^"']+)["']/) || [, ''])[1];
  const slug = canon.replace('https://medpsycmoss.com', '');
  if (!slug) { console.log(`  ! ${f} has no canonical, skipped`); continue; }
  const title = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1]);
  const desc = dec((html.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1]);
  const kind = /BLOG/.test(html.slice(0, 8000)) ? 'blog' : 'interview';

  // <p> and <h2> back to markdown, in order
  const body = [...art[1].matchAll(/<(p|h2)>([\s\S]*?)<\/\1>/g)]
    .map(m => (m[1] === 'h2' ? '## ' : '') + strip(m[2]))
    .filter(Boolean)
    .join('\n\n');

  const md = `---
title: ${y(title)}
slug: ${y(slug)}
kind: ${kind}
description: ${y(desc)}
---

${body}
`;
  fs.writeFileSync(path.join(C, 'blog', f.replace(/\.html$/, '.md')), md);
  posts++;
}

// ---------------------------------------------------------------- products --
// Prices live in the markup today, so a price change in Gator silently disagrees
// with the site. Pulling them out is what closes that gap.
const store = read('store.html');
const products = [];
for (const m of store.matchAll(/<a class="tile([^"]*)"[^>]*data-p="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
  const [, cls, dataP, inner] = m;
  const g = (re) => (inner.match(re) || [, ''])[1];
  products.push({
    id: dataP.split('/')[0],
    store_path: dataP,
    name: strip(g(/<h3>([\s\S]*?)<\/h3>/)),
    description: strip(g(/<p>([\s\S]*?)<\/p>/)),
    price: strip(g(/<span class="price">([\s\S]*?)<\/span>/)),
    chip: strip(g(/<span class="chip">([\s\S]*?)<\/span>/)),
    category: strip(g(/<span class="cat">([\s\S]*?)<\/span>/)),
    cta: strip(g(/<span class="cta">([\s\S]*?)<\/span>/)),
    cover: (inner.match(/src="\/new\/img\/([\w-]+)\.webp"/) || [, ''])[1],
    feature: /\bfeature\b/.test(cls),
  });
}
fs.writeFileSync(path.join(C, 'products.json'), JSON.stringify({ products }, null, 2));

// ------------------------------------------------------------- site copy ----
const home = read('index.html');
const sec = (id) => {
  const m = home.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?<div class="head[^"]*">([\\s\\S]*?)</div>`));
  if (!m) return {};
  return {
    label: strip((m[1].match(/<span class="vital">([\s\S]*?)<\/span>/) || [, ''])[1]),
    heading: strip((m[1].match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [, ''])[1]),
    intro: strip((m[1].match(/<p>([\s\S]*?)<\/p>/) || [, ''])[1]),
  };
};
const site = {
  brand: { name: 'MedPsycMoss', person: 'Stephanie Moss, MD' },
  home: {
    title: dec((home.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]),
    description: dec((home.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1]),
    kicker: [...home.matchAll(/<span>(STATUS|ROLE|SERIES):\s*<b>([\s\S]*?)<\/b><\/span>/g)]
      .map(m => ({ label: m[1], value: strip(m[2]) })),
    hero_sub: strip((home.match(/<p class="sub">([\s\S]*?)<\/p>/) || [, ''])[1]),
    hero_cta: [...home.matchAll(/<a href="(#[\w-]+)" class="btn[^"]*">([^<]+)<\/a>/g)]
      .map(m => ({ href: m[1], label: strip(m[2]) })),
    ecg_tag: strip((home.match(/<span class="tag">([\s\S]*?)<\/span>/) || [, ''])[1]),
    marquee: [...home.matchAll(/<div class="marq-track"[^>]*>([\s\S]*?)<\/div>/g)]
      .flatMap(m => [...m[1].matchAll(/<span>([^<]+)<\/span>/g)].map(s => strip(s[1]))),
    free: sec('free'),
    store: sec('store'),
  },
  footer: {
    bio: strip((home.match(/<p class="foot-bio">([\s\S]*?)<\/p>/) || [, ''])[1]),
    disclaimer: strip((home.match(/<p class="disc">([\s\S]*?)<\/p>/) || [, ''])[1]),
  },
};
fs.writeFileSync(path.join(C, 'site.json'), JSON.stringify(site, null, 2));

// stats and testimonials are already data; move them under content/ so the CMS
// has one place to look
for (const f of ['stats.json', 'testimonials.json']) {
  fs.copyFileSync(path.join(R, 'data', f), path.join(C, f));
}

console.log(`articles  -> content/blog/*.md      ${posts}`);
console.log(`products  -> content/products.json  ${products.length}`);
console.log(`site copy -> content/site.json      ${site.home.marquee.length} marquee, ${site.home.kicker.length} kicker`);
console.log(`stats + testimonials copied to content/`);
