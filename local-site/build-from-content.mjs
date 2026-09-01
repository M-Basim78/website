/**
 * Rebuild every CMS-editable surface from content/, not from the crawl archive.
 *
 * This is what makes the CMS real: the client edits content/, this regenerates
 * the HTML, and the archive is no longer needed to publish a change.
 *
 * Covers: article pages (content/blog/*.md), store tiles and product pages
 * (content/products.json), the stats strip (content/stats.json) and the
 * testimonial cards (content/testimonials.json).
 */
import fs from 'fs';
import path from 'path';

const R = path.resolve('rebuild');
const C = path.resolve('content');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Inline links inside a paragraph: [her words](https://example.com)
 *
 * Escaping happens FIRST and the anchor is built from the escaped pieces, so a
 * post can never inject markup by containing a stray angle bracket. Only http,
 * https, mailto and site-relative targets are allowed: javascript: in an href
 * is the oldest trick there is, and she pastes links from her own inbox.
 *
 * An external link opens in a new tab with rel="noopener", because sending a
 * reader away from a 20 minute article and losing their place is rude.
 */
const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/))/i;

function inline(text) {
  let out = esc(text);
  // [label](target)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
    const clean = href.replace(/&amp;/g, '&');
    if (!SAFE_HREF.test(clean)) return label;          // keep the words, drop the link
    const external = /^https?:/i.test(clean) && !/medpsycmoss\.com/i.test(clean);
    return `<a href="${esc(clean)}"` +
      (external ? ' target="_blank" rel="noopener noreferrer"' : '') + `>${label}</a>`;
  });
  // A bare URL she pasted on its own, not already inside an anchor.
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (whole, pre, url) => {
    const clean = url.replace(/&amp;/g, '&').replace(/[.,;:]+$/, '');
    const tail = url.slice(clean.length);
    const shown = clean.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `${pre}<a href="${esc(clean)}" target="_blank" rel="noopener noreferrer">${esc(shown)}</a>${tail}`;
  });
  return out;
}

/**
 * The video that belongs to a post.
 *
 * Every one of her posts has a YouTube video, and she wants the thumbnail at
 * the top with a click through to YouTube. Not an iframe: an embed loads
 * YouTube's player, its cookies and about a megabyte of script into a page that
 * is otherwise dependency free, and it would be the slowest thing on the site.
 * A thumbnail and a link cost one image.
 */
function youtubeId(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  const m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(u) ? u : '');
}

function videoCard(url, title) {
  const id = youtubeId(url);
  if (!id) return '';
  const watch = 'https://www.youtube.com/watch?v=' + id;
  // maxresdefault does not exist for every video; hqdefault always does, so the
  // onerror swap means a card never renders as a broken image.
  return `      <a class="ytcard" href="${esc(watch)}" target="_blank" rel="noopener noreferrer">
        <span class="thumb">
          <img src="https://i.ytimg.com/vi/${id}/maxresdefault.jpg"
               onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${id}/hqdefault.jpg'"
               alt="Watch: ${esc(title)}" width="1280" height="720" loading="lazy" decoding="async">
          <span class="play" aria-hidden="true"></span>
        </span>
        <span class="meta"><span class="k">Watch on YouTube</span><span class="t">${esc(title)}</span></span>
      </a>
`;
}


// ---------------------------------------------------------------- helpers --
function frontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

const shellOf = (file) => {
  const s = fs.readFileSync(path.join(R, file), 'utf8');
  return {
    header: s.match(/<header class="top">[\s\S]*?<\/header>/)[0],
    footer: s.match(/<footer>[\s\S]*?<\/footer>/)[0],
    dock: s.match(/<nav class="dock"[\s\S]*?<\/nav>/)[0],
  };
};
const SHELL = shellOf('store.html');

// Pixel sizes recorded when she uploaded each picture. Missing is fine; the
// <img> simply goes out without width and height.
let PIC_SIZES = {};
try {
  PIC_SIZES = JSON.parse(fs.readFileSync(path.join(C, 'uploads', 'sizes.json'), 'utf8'));
} catch { /* no pictures uploaded yet */ }

// ------------------------------------------------------------- articles ----
let posts = 0;
for (const f of fs.readdirSync(path.join(C, 'blog')).filter(x => x.endsWith('.md'))) {
  const { data, body } = frontmatter(fs.readFileSync(path.join(C, 'blog', f), 'utf8'));
  if (!data.title || !data.slug) { console.log(`  ! ${f} missing title or slug, skipped`); continue; }

  const blocks = body.trim().split(/\n{2,}/).map(b => {
    const t = b.trim();
    if (!t) return '';
    // A picture on its own line: ![description](/uploads/name.jpg)
    const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) {
      const alt = esc(img[1]);
      const src = img[2];
      // width/height reserve the space, so the page does not jump on load
      const d = PIC_SIZES[src.replace(/^\/uploads\//, '')];
      const dims = d ? ` width="${d.w}" height="${d.h}"` : '';
      return `<figure class="post-img"><img src="${esc(src)}" alt="${alt}"${dims} loading="lazy" decoding="async">` +
             (alt ? `<figcaption>${alt}</figcaption>` : '') + `</figure>`;
    }
    return t.startsWith('## ') ? `<h2>${inline(t.slice(3))}</h2>` : `<p>${inline(t)}</p>`;
  }).filter(Boolean);

  const isInterview = data.kind === 'interview';
  const desc = data.description || blocks.find(b => b.startsWith('<p>'))?.replace(/<[^>]+>/g, '').slice(0, 155) || data.title;
  const t62 = data.title.slice(0, 62);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

<title>${esc(t62)} | MedPsycMoss</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="https://medpsycmoss.com${data.slug}">
<meta name="author" content="Stephanie Moss, MD">
<meta name="theme-color" content="#6E1F35">
<link rel="icon" href="/new/favicon.svg" type="image/svg+xml">

<meta property="og:type" content="article">
<meta property="og:site_name" content="MedPsycMoss | Stephanie Moss, MD">
<meta property="og:url" content="https://medpsycmoss.com${data.slug}">
<meta property="og:title" content="${esc(t62)} | MedPsycMoss">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://medpsycmoss.com/img/moss-doctor.webp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1600">
<meta property="og:image:alt" content="Stephanie Moss, MD.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(t62)} | MedPsycMoss">
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

${SHELL.header}

<main id="main">

<section class="hero" aria-labelledby="a-title">
  <div class="mesh"></div>
  <div class="wrap">
    <p class="kicker in"><span>${isInterview ? 'INTERVIEW' : 'BLOG'}</span><span>BY <b>STEPHANIE MOSS, MD</b></span></p>
    <h1 id="a-title">${esc(data.title)}</h1>
  </div>
</section>

<section aria-labelledby="a-title">
  <div class="wrap">
${videoCard(data.video, data.title)}    <article class="prose reveal">
${blocks.map(b => '      ' + b).join('\n')}
    </article>
    <div class="store-more reveal">
      <a class="btn dark" href="${isInterview ? '/podcast' : '/blog'}">Back to ${isInterview ? 'the podcast' : 'the blog'}</a>
    </div>
  </div>
</section>

</main>

${SHELL.footer}

${SHELL.dock}

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": ${JSON.stringify(data.title.slice(0, 110))},
  "description": ${JSON.stringify(desc)},
  "author": { "@type": "Person", "name": "Stephanie Moss", "honorificSuffix": "MD" },
  "publisher": { "@type": "Person", "name": "Stephanie Moss, MD" },
  "mainEntityOfPage": "https://medpsycmoss.com${data.slug}"
}
</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(R, f.replace(/\.md$/, '.html')), html);
  posts++;
}

// ------------------------------------------------------------- products ----
// Rewrites the name, description, price, chip and category inside each existing
// store tile and product page, keyed on data-buy. Everything else in the markup
// is left untouched, so the layout the designers built survives an edit.
//
// This used to key on data-p, which the shop rewrite removed from every page.
// The result was silent and dangerous: a price edit updated nothing on screen
// while checkout, which reads products.json server side, charged the new amount.
// The site would advertise one price and take another.
const { products } = JSON.parse(fs.readFileSync(path.join(C, 'products.json'), 'utf8'));
const byId = new Map(products.map(p => [p.id, p]));

let tiles = 0;
for (const f of fs.readdirSync(R).filter(x => x.endsWith('.html'))) {
  const file = path.join(R, f);
  let html = fs.readFileSync(file, 'utf8');
  let touched = false;

  html = html.replace(/<a class="tile([^"]*)"([^>]*?)data-buy="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g,
    (whole, cls, pre, dp, post, inner) => {
      const p = byId.get(dp);
      if (!p) return whole;
      let out = inner;
      // A FUNCTION replacer, never a string. Her prices start "$1", and in a
      // string replacement "$1" means backreference to group 1, so "$135.00"
      // silently spliced the matched markup back in and left "35.00" behind.
      const sub = (re, to) => { if (re.test(out)) { out = out.replace(re, () => to); touched = true; } };
      sub(/<h3>[\s\S]*?<\/h3>/, `<h3>${esc(p.name)}</h3>`);
      sub(/<p>[\s\S]*?<\/p>/, `<p>${esc(p.description)}</p>`);
      sub(/<span class="price">[\s\S]*?<\/span>/, `<span class="price">${esc(p.price)}</span>`);
      // build-store.mjs renders the price as the first span inside .num.
      // Rebuilt by hand rather than with $1/$2, for the same reason as above.
      if (/<span class="num"><span>[^<]*<\/span>/.test(out)) {
        out = out.replace(/<span class="num"><span>[^<]*<\/span>/,
          () => `<span class="num"><span>${esc(p.price)}</span>`);
        touched = true;
      }
      if (p.chip) sub(/<span class="chip">[\s\S]*?<\/span>/, `<span class="chip">${esc(p.chip)}</span>`);
      if (p.category) sub(/<span class="cat">[\s\S]*?<\/span>/, `<span class="cat">${esc(p.category)}</span>`);
      return `<a class="tile${cls}"${pre}data-buy="${dp}"${post}>${out}</a>`;
    });

  // The /products/* pages carry the price in the buy button rather than a tile,
  // so the tile rewrite above misses them. Without this a price edit updates the
  // store and the homepage but leaves the product page advertising the old
  // figure, which is the exact drift this whole exercise exists to prevent.
  html = html.replace(/(<a class="btn"[^>]*?data-buy="([^"]+)"[^>]*>)([\s\S]*?)(<\/a>)/g,
    (whole, open, dp, label, close) => {
      const p = byId.get(dp);
      if (!p) return whole;
      const next = label.replace(/\$[0-9]+(?:\.[0-9]{2})?/, () => p.price);
      if (next === label) return whole;
      touched = true;
      return open + next + close;
    });

  if (touched) { fs.writeFileSync(file, html); tiles++; }
}

// ---------------------------------------------------- stats + testimonials --
const { stats } = JSON.parse(fs.readFileSync(path.join(C, 'stats.json'), 'utf8'));
const T = JSON.parse(fs.readFileSync(path.join(C, 'testimonials.json'), 'utf8'));

const statsHtml = stats.map(s =>
  `      <div class="stat"><span class="n">${esc(s.value)}</span><span class="l">${esc(s.label)}</span></div>`).join('\n');

const quoteCard = (q) => `      <figure class="qc">
        <span class="mark" aria-hidden="true">&ldquo;</span>
        <blockquote>${esc(q.quote)}</blockquote>
        <figcaption class="by">${esc(q.attribution)}${q.context ? ' &middot; ' + esc(q.context) : ''}</figcaption>
      </figure>`;
const quotesHtml = T.featured.map(quoteCard).join('\n');

let patched = 0;
for (const f of fs.readdirSync(R).filter(x => x.endsWith('.html'))) {
  const file = path.join(R, f);
  let html = fs.readFileSync(file, 'utf8');
  const before = html;
  html = html.replace(/(<div class="stats-panel[^"]*">)[\s\S]*?(<\/div>\s*<\/div>)/,
    (m, a, b) => `${a}\n${statsHtml}\n    ${b}`);
  html = html.replace(/(<div class="quotes[^"]*">)[\s\S]*?(\n\s*<\/div>)/,
    (m, a, b) => `${a}\n${quotesHtml}${b}`);
  if (html !== before) { fs.writeFileSync(file, html); patched++; }
}

console.log(`articles rebuilt from markdown : ${posts}`);
console.log(`pages with product tiles updated: ${tiles}`);
console.log(`pages with stats/quotes updated : ${patched}`);
