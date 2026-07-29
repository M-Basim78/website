#!/usr/bin/env node
/**
 * Local deployment of the medpsycmoss.com archive.
 *
 * The backup stores fully-rendered HTML whose asset references are still the
 * original absolute URLs (https://host/path?query), while the files themselves
 * live under backup/assets/<host>/<path>.  Query strings were folded into the
 * filename as `<name>__q<md5(query)[:10]>`.  This server rebuilds that mapping
 * on the fly and rewrites HTML/CSS as it is served, so nothing on disk changes.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = __dirname;
const BACKUP = path.resolve(ROOT, '..', 'medpsycmoss-backup-20260727', 'backup');
const PAGES = path.join(BACKUP, 'pages');
const ASSETS = path.join(BACKUP, 'assets');
const SHOTS = path.join(BACKUP, 'screenshots');
const CACHE = path.join(ROOT, '.cache');
const REBUILD = path.join(ROOT, 'rebuild');

const argv = process.argv.slice(2);
const PORT = Number(pickArg('--port') || 8123);
const ONLINE = !argv.includes('--offline');
const KEEP_ANALYTICS = argv.includes('--keep-analytics');

function pickArg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

// Third-party beacons. Blocked by default so a local copy never writes into the
// real site's analytics; --keep-analytics restores them.
const BLOCKED_HOSTS = new Set([
  'www.googletagmanager.com', 'www.google-analytics.com', 'cdn.segment.com',
  'securepubads.g.doubleclick.net', 'static.doubleclick.net',
  'static.cloudflareinsights.com', 'www.datadoghq-browser-agent.com',
  'cdn-4.convertexperiments.com', 'cdn-cookieyes.com',
]);

// reCAPTCHA refuses to run from a stale snapshot — the archived api.js loads but
// never defines grecaptcha.render, and the resulting uncaught TypeError aborts
// viewer.js mid-render, collapsing /contact.  Always let it come from Google.
const NEVER_LOCAL = [
  'www.google.com/recaptcha/',
  'www.gstatic.com/recaptcha/',
];

// Static assets the crawler missed are still routed through us, so the live
// fallback can fetch and cache them; that is what makes --offline usable later.
// Deliberately excludes .js: third-party SDKs are happier on their own origin.
const PROXYABLE_EXT = /\.(?:css|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|ico)$/i;

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function htmlUnescape(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/* ------------------------------------------------------------------ index -- */

const assetByPath = new Map();   // lowercased "host/path" -> real relative path
const assetByQHash = new Map();  // lowercased "host/path__q<hash>" -> real relative path
const assetByBase = new Map();   // lowercased "host/path" -> [real relative paths]
const assetHosts = new Set();

function indexAssets(dir, rel = '') {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { indexAssets(path.join(dir, e.name), childRel); continue; }
    const key = childRel.toLowerCase();
    assetByPath.set(key, childRel);
    assetHosts.add(childRel.split('/')[0].toLowerCase());
    const m = key.match(/^(.*)__q([0-9a-f]{10})/);
    if (m) {
      assetByQHash.set(`${m[1]}__q${m[2]}`, childRel);
      const list = assetByBase.get(m[1]) || [];
      list.push(childRel);
      assetByBase.set(m[1], list);
    }
  }
}

/** URL (host + path + query) -> real file below backup/assets, or null. */
function resolveAsset(host, pathname, query) {
  host = host.toLowerCase();
  if (!assetHosts.has(host)) return null;

  const bases = new Set();
  for (const p of [pathname, safeDecode(pathname)]) {
    let b = `${host}${p}`;
    if (b.endsWith('/')) b += 'index';
    bases.add(b.toLowerCase());
  }

  if (query) {
    const hash = md5(htmlUnescape(query)).slice(0, 10);
    for (const b of bases) {
      const hit = assetByQHash.get(`${b}__q${hash}`);
      if (hit) return hit;
    }
  }
  for (const b of bases) {
    const hit = assetByPath.get(b);
    if (hit) return hit;
  }
  // Query strings that are pure cache-busters were sometimes dropped by the
  // crawler; accept a lone hashed sibling as the same file.
  for (const b of bases) {
    const sibs = assetByBase.get(b);
    if (sibs && sibs.length === 1) return sibs[0];
  }
  return null;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/* ------------------------------------------------------------------ routes -- */

const routes = new Map();  // "/about-me" -> "about-me.html"
const notFoundPages = new Set();

function loadManifest() {
  const text = fs.readFileSync(path.join(BACKUP, 'manifest.txt'), 'utf8');
  const re = /^(https?:\/\/\S+)\s+(\S+\.html)\s+(\d+)\s+chars(\s+\[404\])?\s*$/;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    let key;
    try { key = new URL(m[1]).pathname; } catch { continue; }
    key = normalizeRoute(key);
    routes.set(key, m[2]);
    if (m[4]) notFoundPages.add(key);
  }
  // Anything on disk the manifest missed.
  for (const f of fs.readdirSync(PAGES)) {
    if (!f.endsWith('.html')) continue;
    const key = normalizeRoute('/' + f.replace(/\.html$/, '').replace(/_/g, '/'));
    if (!routes.has(key)) routes.set(key, f);
  }
}

function normalizeRoute(p) {
  p = p.replace(/\/+$/, '');
  return (p === '' ? '/' : p).toLowerCase();
}

/* ----------------------------------------------------------------- rewrite -- */

const TRAILING_JUNK = /(?:&quot;|&#0*34;|&apos;|&#0*39;|&gt;|&lt;|&amp;quot;|\\|,|\.)+$/;

function splitUrl(raw) {
  const q = raw.indexOf('?');
  return q === -1
    ? { pathname: raw, query: '' }
    : { pathname: raw.slice(0, q), query: raw.slice(q + 1) };
}

/**
 * Rewrite every archived-origin URL in a text response to a local one.
 * Unresolvable URLs are left untouched so genuine outbound links keep working.
 */
function rewrite(text) {
  // 1. The site's own image proxy: /x/cdn/?<absolute url>
  text = text.replace(
    /(?:https?:)?(?:\/\/medpsycmoss\.com)?\/x\/cdn\/\?([^"'()\s<>]+)/gi,
    (full, query) => {
      const trimmed = query.replace(TRAILING_JUNK, '');
      const tail = query.slice(trimmed.length);
      const hit = resolveAsset('medpsycmoss.com', '/x/cdn/', trimmed);
      return hit ? `/_a/${hit}${tail}` : full;
    }
  );

  // 2. Absolute URLs on any host we archived.
  text = text.replace(
    /(?:https?:)?\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(\/[^"'()\s<>]*)?/gi,
    (full, host, rest) => {
      const raw = (rest || '/').replace(TRAILING_JUNK, '');
      const tail = (rest || '/').slice(raw.length);
      const { pathname, query } = splitUrl(raw);

      if (host.toLowerCase() === 'medpsycmoss.com') {
        const route = normalizeRoute(pathname);
        if (routes.has(route)) return route + tail;
      }
      const bare = `${host.toLowerCase()}${pathname}`;
      if (NEVER_LOCAL.some((p) => bare.startsWith(p))) return full;

      const hit = resolveAsset(host, pathname || '/', query);
      if (hit) return `/_a/${hit}${tail}`;
      if (ONLINE && assetHosts.has(host.toLowerCase()) && PROXYABLE_EXT.test(pathname)) {
        return `/_a/${host}${pathname}${query ? '?' + query : ''}${tail}`;
      }
      return full;
    }
  );

  return text;
}

/* ------------------------------------------------------------------ serving -- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.pdf': 'application/pdf', '.mp4': 'video/mp4',
};

/** Extension-less CDN files need their type sniffed from the magic bytes. */
function sniff(buf) {
  if (buf.length < 12) return 'application/octet-stream';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  const head = buf.slice(0, 400).toString('utf8').trimStart();
  if (/^<svg/i.test(head)) return 'image/svg+xml';
  if (/^<(!doctype|html)/i.test(head)) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function contentType(file, buf) {
  const ext = path.extname(file).toLowerCase();
  return MIME[ext] || sniff(buf);
}

const pageCache = new Map();
const MAX_CACHED_PAGES = 30;
const misses = new Map();

const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml)|image\/svg)/;

/**
 * Gzip text responses.  A real host does this; without it a local Lighthouse run
 * reports "enable text compression" for a problem that would not exist in prod.
 */
function send(res, status, type, body, extra = {}, req = null) {
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra };
  const accepts = req && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (accepts && COMPRESSIBLE.test(type) && body && body.length > 1024) {
    body = zlib.gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  res.writeHead(status, headers);
  res.end(body);
}

function servePage(res, file, req) {
  let html = pageCache.get(file);
  if (html === undefined) {
    html = rewrite(fs.readFileSync(path.join(PAGES, file), 'utf8'));
    if (pageCache.size >= MAX_CACHED_PAGES) pageCache.delete(pageCache.keys().next().value);
    pageCache.set(file, html);
  }
  send(res, 200, MIME['.html'], html, {}, req);
}

function serveAsset(res, rel, req) {
  const abs = path.join(ASSETS, rel);
  const buf = fs.readFileSync(abs);
  const type = contentType(abs, buf);
  if (type.startsWith('text/css') || type.startsWith('text/html')) {
    send(res, 200, type, rewrite(buf.toString('utf8')), {}, req);
  } else {
    send(res, 200, type, buf, {}, req);
  }
}

/**
 * The site's widgets (blog list, app market, forms) POST to live JSON endpoints
 * on medpsycmoss.com.  Those must be forwarded verbatim — answering them from
 * the archive hands the widget HTML where it expects JSON, and it then blanks
 * out the very content the archived DOM already had.
 */
const API_PREFIXES = ['/services/', '/appmarket/', '/api/', '/x/api/'];

function isApiCall(req, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return true;
  return API_PREFIXES.some((p) => pathname.toLowerCase().startsWith(p));
}

async function passthrough(req, res, pathname, query) {
  const url = `https://medpsycmoss.com${pathname}${query ? '?' + query : ''}`;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const headers = { 'User-Agent': req.headers['user-agent'] || 'archive-mirror', 'Origin': 'https://medpsycmoss.com', 'Referer': 'https://medpsycmoss.com/' };
  for (const h of ['content-type', 'accept', 'accept-language']) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }

  const r = await fetch(url, { method: req.method, headers, body, redirect: 'follow' });
  const buf = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, {
    'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

/** Last resort when a file was never captured: pull it from the live origin. */
async function proxy(res, host, pathname, query) {
  const url = `https://${host}${pathname}${query ? '?' + htmlUnescape(query) : ''}`;
  const key = md5(url);
  const cached = path.join(CACHE, key);
  try {
    const buf = fs.readFileSync(cached);
    return send(res, 200, contentType(cached, buf), buf);
  } catch { /* not cached yet */ }

  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (archive-mirror)' } });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cached, buf);
  send(res, 200, r.headers.get('content-type') || sniff(buf), buf);
}

/* ------------------------------------------------------------------ compare -- */

function comparePage(target) {
  const file = routes.get(normalizeRoute(target)) || 'index.html';
  const shot = file.replace(/\.html$/, '.png');
  const options = [...routes.entries()]
    .filter(([, f]) => !notFoundPages.has(normalizeRoute('/' + f)))
    .sort()
    .map(([r]) => `<option value="${r}"${r === target ? ' selected' : ''}>${r}</option>`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>compare ${target}</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body { margin:0; font:14px/1.4 system-ui,sans-serif; background:#111; color:#eee;
         display:flex; flex-direction:column; height:100vh }
  header { display:flex; gap:12px; align-items:center; padding:10px 14px; background:#1b1b1b;
           border-bottom:1px solid #333; flex:0 0 auto }
  select { background:#222; color:#eee; border:1px solid #444; padding:5px 8px; border-radius:6px }
  a { color:#7cc0ff }
  main { flex:1 1 auto; display:grid; grid-template-columns:1fr 1fr; gap:1px; background:#333; min-height:0 }
  section { display:flex; flex-direction:column; background:#111; min-height:0 }
  h2 { margin:0; padding:6px 10px; font-size:12px; letter-spacing:.08em; text-transform:uppercase;
       color:#9a9a9a; background:#161616 }
  .pane { flex:1 1 auto; overflow:auto; min-height:0 }
  iframe { width:100%; height:100%; border:0; background:#fff }
  img { width:100%; display:block }
</style>
<header>
  <strong>local vs. archived screenshot</strong>
  <select onchange="location.search='?p='+encodeURIComponent(this.value)">${options}</select>
  <a href="${target}" target="_blank">open local page &rarr;</a>
  <a href="https://medpsycmoss.com${target === '/' ? '' : target}" target="_blank">open live site &rarr;</a>
</header>
<main>
  <section><h2>local rebuild</h2><div class="pane"><iframe src="${target}"></iframe></div></section>
  <section><h2>screenshot of live site (2026-07-27)</h2><div class="pane"><img src="/__shot/${shot}"></div></section>
</main>`;
}

/* -------------------------------------------------------------------- main -- */

const server = http.createServer(async (req, res) => {
  let pathname, search;
  try {
    const u = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(u.pathname);
    search = u.search.slice(1);
  } catch {
    return send(res, 400, 'text/plain', 'bad request');
  }

  try {
    // The rebuilt homepage, served verbatim — no archive rewriting applies here.
    if (pathname === '/new' || pathname.startsWith('/new/')) {
      const rel = pathname === '/new' ? 'index.html' : pathname.slice('/new/'.length);
      const abs = path.join(REBUILD, rel);
      if (!abs.startsWith(REBUILD)) return send(res, 403, 'text/plain', 'nope');
      const buf = fs.readFileSync(abs);
      return send(res, 200, contentType(abs, buf), buf,
        rel.startsWith('fonts/') || rel.startsWith('img/')
          ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {}, req);
    }

    if (pathname === '/__compare') {
      const p = new URL(req.url, 'http://localhost').searchParams.get('p') || '/';
      return send(res, 200, MIME['.html'], comparePage(p), {}, req);
    }

    if (pathname.startsWith('/__shot/')) {
      const file = path.basename(pathname.slice('/__shot/'.length));
      return send(res, 200, 'image/png', fs.readFileSync(path.join(SHOTS, file)));
    }

    // Rewritten asset URLs: /_a/<host>/<path>
    if (pathname.startsWith('/_a/')) {
      const rel = pathname.slice('/_a/'.length);
      const host = rel.split('/')[0];
      if (!KEEP_ANALYTICS && BLOCKED_HOSTS.has(host.toLowerCase())) {
        return send(res, 200, MIME['.js'], '/* blocked by local mirror */');
      }
      const real = assetByPath.get(rel.toLowerCase());
      if (real) return serveAsset(res, real, req);
      const alt = resolveAsset(host, '/' + rel.split('/').slice(1).join('/'), search);
      if (alt) return serveAsset(res, alt, req);
      return await missing(res, host, '/' + rel.split('/').slice(1).join('/'), search);
    }

    if (ONLINE && isApiCall(req, pathname)) return await passthrough(req, res, pathname, search);

    const route = normalizeRoute(pathname);

    // Page?
    const file = routes.get(route);
    if (file && !notFoundPages.has(route)) return servePage(res, file, req);

    // Same-origin asset that was never rewritten (e.g. /rss.xml, /x/cdn/?...).
    const own = resolveAsset('medpsycmoss.com', pathname, search);
    if (own) return serveAsset(res, own, req);

    if (file) return servePage(res, file, req);  // archived 404 page — show it as-is
    return await missing(res, 'medpsycmoss.com', pathname, search);
  } catch (err) {
    console.error(`  ! ${req.url} :: ${err.message}`);
    if (!res.headersSent) send(res, 500, 'text/plain', String(err.message));
  }
});

async function missing(res, host, pathname, query) {
  const url = `https://${host}${pathname}${query ? '?' + query : ''}`;
  misses.set(url, (misses.get(url) || 0) + 1);
  if (ONLINE) {
    try { return await proxy(res, host, pathname, query); }
    catch (e) { console.error(`  ! upstream miss ${url} :: ${e.message}`); }
  }
  send(res, 404, 'text/plain', `not in archive: ${url}`);
}

process.on('SIGINT', () => {
  if (misses.size) {
    console.log(`\n${misses.size} URL(s) were not in the archive:`);
    for (const [u, n] of [...misses].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`  ${String(n).padStart(3)}x  ${u}`);
    }
  }
  process.exit(0);
});

console.log('indexing archive…');
indexAssets(ASSETS);
loadManifest();
server.listen(PORT, () => {
  console.log(`
  medpsycmoss.com — local mirror
  ------------------------------
  assets indexed : ${assetByPath.size}
  pages routed   : ${routes.size} (${notFoundPages.size} archived 404s)
  live fallback  : ${ONLINE ? 'on (use --offline to disable)' : 'off'}
  analytics      : ${KEEP_ANALYTICS ? 'enabled' : 'blocked'}

  archive  http://localhost:${PORT}/
  rebuild  http://localhost:${PORT}/new
  compare  http://localhost:${PORT}/__compare?p=/
`);
});
