#!/usr/bin/env node
/**
 * Build the Free Guides section she asked for:
 *
 *   /free-guides                       hub, the six groups
 *   /free-guides/<group>               group page, its subgroups + every post
 *   /free-guides/<group>/<subgroup>    the posts for that subgroup
 *
 * Posts are her existing blog articles, grouped by her own tags where she has
 * them and by keyword where she does not. See guides-taxonomy.mjs. Nothing is
 * written here that she did not publish; these pages are indexes.
 *
 * The shell is lifted from rebuild/store.html so the nav can never drift.
 */

import fs from 'node:fs';
import path from 'node:path';
import { assign, decode } from './guides-taxonomy.mjs';
import { headerHTML, dockHTML } from './update-nav.mjs';

const R = path.resolve('rebuild');
const ORIGIN = 'https://medpsycmoss.com';

const shellSrc = fs.readFileSync(path.join(R, 'store.html'), 'utf8');
const FOOTER = shellSrc.match(/<footer[\s\S]*?<\/footer>/)[0];

const esc = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// House rule: no em or en dashes in visible copy.
const dedash = s => String(s || '').replace(/\s+[—–]\s+/g, ', ').replace(/[—–]/g, '-');
// decode first: some source text genuinely contains "&amp;", and escaping that
// on output would print "&amp;amp;" to the reader.
const tidy = s => dedash(decode(String(s || '')).replace(/\s+/g, ' ').trim());

const trim = (s, n) => {
  s = tidy(s);
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '...';
};

function page({ url, title, desc, h1, kicker, intro, crumbs, body, ld }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

<title>${esc(title)} | MedPsycMoss</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${ORIGIN}${url}">
<meta name="author" content="Stephanie Moss, MD">
<meta name="theme-color" content="#6E1F35">
<link rel="icon" href="/new/favicon.svg" type="image/svg+xml">

<meta property="og:type" content="website">
<meta property="og:site_name" content="MedPsycMoss | Stephanie Moss, MD">
<meta property="og:url" content="${ORIGIN}${url}">
<meta property="og:title" content="${esc(title)} | MedPsycMoss">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${ORIGIN}/img/moss-doctor.webp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1600">
<meta property="og:image:alt" content="Stephanie Moss, MD.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)} | MedPsycMoss">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${ORIGIN}/img/moss-doctor.webp">

<link rel="preload" href="/new/fonts/bricolage-grotesque-300-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/new/fonts/inter-400-600.woff2" as="font" type="font/woff2" crossorigin>
<script>document.documentElement.classList.add("js")</script>
<link rel="stylesheet" href="/new/css/site.css">
<script src="/new/js/site.js" defer></script>
</head>
<body>

<a class="skip" href="#main">Skip to content</a>

${headerHTML('guides')}

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

</main>

${FOOTER}
${dockHTML('guides')}

<script type="application/ld+json">
${ld}
</script>

</body>
</html>
`;
}

// The category, title and blurb go inside ONE span. .fr is a two column flex,
// content then tag; making them siblings gave each its own column and crushed
// the title to a few characters wide on a phone.
const postRow = (p, cat) => `        <a class="fr" href="${esc(p.url)}">
          <span><span class="cat">${esc(cat)}</span><span class="t">${esc(trim(p.title, 110))}</span><span class="d">${esc(trim(p.desc || '', 150))}</span></span>
          <span class="tagm">READ</span>
        </a>`;

const postList = (posts, cat, id) => `    <div class="free-list reveal" id="${id}">
${posts.map(p => postRow(p, cat)).join('\n')}
    </div>`;

function ld({ url, name, desc, items }) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${ORIGIN}${url}#webpage`,
        url: ORIGIN + url,
        name: tidy(name),
        description: tidy(desc),
        inLanguage: 'en-US',
        isPartOf: { '@id': `${ORIGIN}/#website` },
        author: { '@id': `${ORIGIN}/#person` },
      },
      {
        '@type': 'ItemList',
        name: tidy(name),
        numberOfItems: items.length,
        itemListElement: items.slice(0, 100).map((it, i) => ({
          '@type': 'ListItem', position: i + 1,
          name: tidy(it.name), url: ORIGIN + it.url,
        })),
      },
    ],
  }, null, 2);
}

// ------------------------------------------------------------------ build
const { groups, unassigned, posts } = assign();
let written = 0;
const write = (file, html) => { fs.writeFileSync(path.join(R, file), html); written++; };

const totalPosts = new Set(groups.flatMap(g => g.posts.map(p => p.slug))).size;

// ---- hub
{
  const tiles = groups.map((g, i) => `        <a class="tile" href="/free-guides/${g.key}">
          <span class="num"><span>GUIDE ${String(i + 1).padStart(2, '0')}</span><span class="cat">${g.children.length} SECTION${g.children.length === 1 ? '' : 'S'}</span></span>
          <h3>${esc(g.name)}</h3>
          <p>${esc(g.blurb)}</p>
          <span class="cta">${g.posts.length} free guides</span>
        </a>`).join('\n');

  write('free-guides.html', page({
    url: '/free-guides',
    title: 'Free Guides: Premed, Medical School, USMLE, Residency',
    desc: `Free written guides from Stephanie Moss, MD on premed, medical school, the USMLE exams, disability accommodations, residency applications and psychiatry. ${totalPosts} articles, no email required.`,
    h1: 'Free Guides',
    kicker: '<span>FOR: <b>PREMEDS, STUDENTS &amp; RESIDENTS</b></span>\n      <span>ACCESS: <b>FREE, NO EMAIL REQUIRED</b></span>\n      <span>ARTICLES: <b>' + totalPosts + '</b></span>',
    intro: 'Everything she has written, grouped by where you are in training. Start with the stage you are in, or browse the whole blog.',
    crumbs: '<a href="/">Home</a> <span aria-hidden="true">/</span> <span aria-current="page">Free Guides</span>',
    body: `<section id="groups" aria-labelledby="grp-title">
  <div class="wrap">
    <div class="tint-band">
      <div class="head reveal">
        <span class="vital">Free guides</span>
        <h2 id="grp-title">Start where <span class="hl">you are</span></h2>
        <p>Six stages, from undergrad through residency. Every guide is free to read.</p>
      </div>
      <div class="lib-grid reveal">
${tiles}
      </div>
    </div>
  </div>
</section>`,
    ld: ld({
      url: '/free-guides', name: 'Free Guides',
      desc: 'Free written guides for premeds, medical students and residents.',
      items: groups.map(g => ({ name: g.name, url: '/free-guides/' + g.key })),
    }),
  }));
}

// ---- group pages
for (const g of groups) {
  const secs = g.children.map((c, i) => {
    if (!c.posts.length) return '';
    return `    <div class="head reveal"${i ? ' style="margin-top:44px"' : ''}>
      <span class="vital">${esc(c.name)}</span>
      <h2 id="sec-${c.key}">${esc(c.name)} (${c.posts.length})</h2>
      <p>${esc(c.blurb)} <a class="see-all" href="/free-guides/${g.key}/${c.key}">See all ${c.posts.length}</a></p>
    </div>
${postList(c.posts.slice(0, 6), c.name.toUpperCase(), 'list-' + c.key)}`;
  }).filter(Boolean).join('\n');

  write(`free-guides_${g.key}.html`, page({
    url: `/free-guides/${g.key}`,
    title: `${g.name} Guides`,
    desc: trim(`${g.blurb} ${g.posts.length} free articles from Stephanie Moss, MD.`, 158),
    h1: g.name,
    kicker: `<span>SECTIONS: <b>${g.children.filter(c => c.posts.length).length}</b></span><span>ARTICLES: <b>${g.posts.length}</b></span><span>ACCESS: <b>FREE</b></span>`,
    intro: esc(g.blurb),
    crumbs: `<a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/free-guides">Free Guides</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(g.name)}</span>`,
    body: `<section id="sections" aria-labelledby="sec-${g.children[0].key}">
  <div class="wrap">
${secs}
  </div>
</section>`,
    ld: ld({
      url: `/free-guides/${g.key}`, name: g.name, desc: g.blurb,
      items: g.posts.map(p => ({ name: p.title, url: p.url })),
    }),
  }));

  // ---- subgroup pages
  for (const c of g.children) {
    if (!c.posts.length) continue;
    // A thin section would look broken on its own, so it also offers the rest
    // of its parent group rather than a near-empty page.
    const more = c.posts.length < 4
      ? g.posts.filter(p => !c.posts.some(q => q.slug === p.slug)).slice(0, 8)
      : [];

    const body = `<section id="links" aria-labelledby="sec-title">
  <div class="wrap">
    <div class="head reveal">
      <span class="vital">${esc(g.name)}</span>
      <h2 id="sec-title">${esc(c.name)} (${c.posts.length})</h2>
      <p>${esc(c.blurb)}</p>
    </div>
${postList(c.posts, c.name.toUpperCase(), 'list-main')}
${more.length ? `    <div class="head reveal" style="margin-top:44px">
      <span class="vital">Related</span>
      <h2 id="more-title">More on ${esc(g.name)}</h2>
      <p>She has written less on this one so far. These are the closest guides in the same stage.</p>
    </div>
${postList(more, g.name.toUpperCase(), 'list-more')}` : ''}
  </div>
</section>`;

    write(`free-guides_${g.key}_${c.key}.html`, page({
      url: `/free-guides/${g.key}/${c.key}`,
      title: `${c.name}: ${g.name} Guides`,
      desc: trim(`${c.blurb} ${c.posts.length} free article${c.posts.length === 1 ? '' : 's'} from Stephanie Moss, MD.`, 158),
      h1: c.name,
      kicker: `<span>IN: <b>${esc(g.name.toUpperCase())}</b></span><span>ARTICLES: <b>${c.posts.length}</b></span><span>ACCESS: <b>FREE</b></span>`,
      intro: esc(c.blurb),
      crumbs: `<a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/free-guides">Free Guides</a> <span aria-hidden="true">/</span> <a href="/free-guides/${g.key}">${esc(g.name)}</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(c.name)}</span>`,
      body,
      ld: ld({
        url: `/free-guides/${g.key}/${c.key}`, name: c.name, desc: c.blurb,
        items: c.posts.map(p => ({ name: p.title, url: p.url })),
      }),
    }));
  }
}

console.log(`free guides pages written : ${written}`);
console.log(`groups                    : ${groups.length}`);
console.log(`subgroups with posts      : ${groups.reduce((n, g) => n + g.children.filter(c => c.posts.length).length, 0)}`);
console.log(`distinct posts surfaced   : ${totalPosts} of ${posts.length}`);
console.log(`posts not in any guide    : ${unassigned.length} (patient-side topics, they live under Patient&Doctor)`);
