/**
 * Emit a deployable static site into dist/.
 *
 * Each page is written to the directory its own <link rel="canonical"> claims,
 * as index.html, so slugs containing a slash (/blog/tag/disability) resolve on a
 * real host instead of 404ing. That is the fix for next-steps.md item 2b, with
 * no content dropped.
 *
 * Asset paths move from the dev prefix (/new/...) to production roots (/...).
 * dist/ has no dependency on the 2 GB archive; it is the whole shippable site.
 */
import fs from 'fs';
import path from 'path';

const R = path.resolve('rebuild');
const OUT = path.resolve('dist');
const ORIGIN = 'https://medpsycmoss.com';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// The dev server mounts everything under /new/. Production serves from the root,
// so that prefix has to go from HTML, CSS and JS alike. Doing it as a blanket
// replace rather than a quote-anchored one matters: the second entry of every
// srcset is preceded by a space, and site.css carries the @font-face urls, so a
// narrower pattern silently shipped 404ing fonts and 450w images.
const deprefix = (s) => s.split('/new/').join('/');
const TEXT = /\.(css|js|json|svg|xml|txt)$/i;

const copyDir = (from, to) => {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) { n += copyDir(s, d); continue; }
    if (TEXT.test(e.name)) fs.writeFileSync(d, deprefix(fs.readFileSync(s, 'utf8')));
    else fs.copyFileSync(s, d);
    n++;
  }
  return n;
};

// ---- assets -----------------------------------------------------------------
let assets = 0;
for (const dir of ['css', 'js', 'img', 'fonts', 'data', 'admin', 'partials']) {
  if (dir === 'partials') continue;                 // build-time only
  assets += copyDir(path.join(R, dir), path.join(OUT, dir));
}
for (const f of ['favicon.svg']) {
  if (fs.existsSync(path.join(R, f))) { fs.copyFileSync(path.join(R, f), path.join(OUT, f)); assets++; }
}

// ---- pages ------------------------------------------------------------------
const urls = [];
const collisions = new Map();

for (const f of fs.readdirSync(R).filter(x => x.endsWith('.html'))) {
  let html = fs.readFileSync(path.join(R, f), 'utf8');
  const m = html.match(/<link rel=["']canonical["'] href=["']([^"']+)["']/);
  if (!m) { console.log(`  ! ${f} has no canonical, skipped`); continue; }

  const url = m[1].replace(ORIGIN, '') || '/';
  // a slug with a space has no clean URL on a static host; /blog covers it
  // alternation, not a character class: [\s%20] also matches "2" and "0", which
  // wrongly dropped /blog/step2 and /malikiya-m2-one-hand
  if (/%20|\s/.test(url)) { console.log(`  ~ ${f} skipped, slug contains a space (${url})`); continue; }
  if (collisions.has(url)) console.log(`  ! ${f} and ${collisions.get(url)} both claim ${url}`);
  collisions.set(url, f);

  html = deprefix(html);        // dev asset prefix -> production root

  // Tag and pagination listings are not built: they are Gator list widgets fed
  // by the fetchContent endpoint that 404s in production, and their archived
  // shells are corrupt. /blog owns that content, so point their links there
  // rather than shipping links to pages that do not exist.
  html = html.replace(/href=(["'])\/blog\/(tag|page)\/[^"']*\1/g, 'href="/blog"');
  // one archived slug carries a literal space, so no clean URL exists for it
  html = html.replace(/href=(["'])\/blog\/personal(%20|\s)statement2\1/g, 'href="/blog"');

  const rel = url === '/' ? 'index.html' : path.join(url.replace(/^\//, ''), 'index.html');
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
  urls.push(url);
}

// ---- 404 --------------------------------------------------------------------
// Built from the real shell so a wrong URL still lands on her site, not nginx's
// default page. Not in the sitemap, and not a canonical URL.
{
  const src = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
  const grab = (re) => (src.match(re) || [''])[0];
  const head = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Page not found | MedPsycMoss</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#6E1F35">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/bricolage-grotesque-300-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/inter-400-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css">
<script src="/js/site.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${grab(/<header class="top">[\s\S]*?<\/header>/).replace(/\/new\//g, '/')}
<main id="main">
  <section class="hero">
    <div class="mesh"></div>
    <div class="wrap">
      <p class="kicker in"><span>ERROR: <b>404</b></span><span>STATUS: <b>PAGE NOT FOUND</b></span></p>
      <h1>Not<br>found</h1>
      <p class="sub">That page does not exist, or it has moved. The links below cover everything on the site.</p>
      <div class="hero-cta">
        <a href="/" class="btn">Back to the homepage</a>
        <a href="/resources" class="btn dark">Free resources</a>
      </div>
    </div>
  </section>
</main>
${grab(/<footer>[\s\S]*?<\/footer>/).replace(/\/new\//g, '/')}
${grab(/<nav class="dock"[\s\S]*?<\/nav>/).replace(/\/new\//g, '/')}
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, '404.html'), head);
}

// ---- sitemap and robots -----------------------------------------------------
const today = fs.statSync(path.join(R, 'index.html')).mtime.toISOString().slice(0, 10);
const priority = (u) => u === '/' ? '1.0'
  : ['/store', '/about-me', '/resources', '/podcast', '/blog'].includes(u) ? '0.9' : '0.7';

fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.sort().map(u =>
    `  <url>\n    <loc>${ORIGIN}${u === '/' ? '/' : u}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority(u)}</priority>\n  </url>`
  ).join('\n') + `\n</urlset>\n`);

fs.writeFileSync(path.join(OUT, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);

// ---- report -----------------------------------------------------------------
const nested = urls.filter(u => (u.match(/\//g) || []).length > 1);
const size = (d) => {
  let s = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    s += e.isDirectory() ? size(p) : fs.statSync(p).size;
  }
  return s;
};
console.log(`pages written : ${urls.length}`);
console.log(`  nested slugs: ${nested.length}  ${nested.slice(0, 4).join(', ')}${nested.length > 4 ? ' ...' : ''}`);
console.log(`assets copied : ${assets}`);
console.log(`sitemap urls  : ${urls.length}`);
console.log(`dist size     : ${(size(OUT) / 1024 / 1024).toFixed(1)} MB`);
