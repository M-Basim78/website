#!/usr/bin/env node
/**
 * MedPsycMoss CMS and web server.
 *
 * One process serves the public site out of dist/ and the editor at /admin.
 * The editor has its own username and password: no GitHub account, no OAuth,
 * no third party. Saving writes to content/, and Publish runs the same two build
 * scripts a developer would, so her change goes live without anyone's help.
 *
 * No dependencies beyond Node itself.
 *
 * Env:
 *   CMS_USER            login name           (default "stephanie")
 *   CMS_PASSWORD        plain password, hashed at boot. Use this OR the hash.
 *   CMS_PASSWORD_HASH   scrypt hash from `node cms/hash-password.js <pw>`
 *   SESSION_SECRET      cookie signing key. Generated at boot if unset, which
 *                       logs everyone out on restart, so set it in production.
 *   PORT                default 8080
 */
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Store, fromCents, verifySignature } = require('./store.js');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CONTENT = path.join(ROOT, 'content');
const BLOG = path.join(CONTENT, 'blog');
const UI = path.join(__dirname, 'public');

// All inside content/, which is the Docker volume, so uploads, deleted posts and
// previous versions survive a redeploy exactly like her words do.
const UPLOADS = path.join(CONTENT, 'uploads');
const TRASH = path.join(CONTENT, '.trash');
const HISTORY = path.join(CONTENT, '.history');
for (const d of [UPLOADS, TRASH, HISTORY]) fs.mkdirSync(d, { recursive: true });

// The shop. ORIGIN is what Stripe redirects back to, so it must be the public
// address, not the loopback port the container listens on.
const ORIGIN = process.env.SITE_ORIGIN || 'https://medpsycmoss.com';
const store = new Store({ contentDir: CONTENT, origin: ORIGIN });

// Pictures she can upload. No SVG: it can carry script, and nothing here needs it.
const IMAGE_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};
const MAX_UPLOAD = 8 * 1024 * 1024;   // 8 MB
const KEEP_VERSIONS = 10;             // previous versions kept per post

const PORT = Number(process.env.PORT || 8080);
const USER = process.env.CMS_USER || 'stephanie';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_HOURS = 12;

const scrypt = (pw, salt) =>
  crypto.scryptSync(pw, salt, 64).toString('hex');

let PASSWORD_HASH = process.env.CMS_PASSWORD_HASH || '';
if (!PASSWORD_HASH && process.env.CMS_PASSWORD) {
  const salt = crypto.randomBytes(16).toString('hex');
  PASSWORD_HASH = `${salt}:${scrypt(process.env.CMS_PASSWORD, salt)}`;
}
if (!PASSWORD_HASH) {
  console.error('No CMS_PASSWORD or CMS_PASSWORD_HASH set. The editor is disabled.');
}

/* ------------------------------------------------------------- sessions -- */
// Signed cookie, no server-side store, so a restart does not lose logins as long
// as SESSION_SECRET is stable.
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function makeToken() {
  const body = `${USER}.${Date.now() + SESSION_HOURS * 3600e3}`;
  return `${body}.${sign(body)}`;
}
function validToken(tok) {
  if (!tok) return false;
  const i = tok.lastIndexOf('.');
  if (i < 0) return false;
  const body = tok.slice(0, i), sig = tok.slice(i + 1);
  if (!crypto.timingSafeEqual(Buffer.from(sign(body)), Buffer.from(sig))) return false;
  const exp = Number(body.split('.')[1]);
  return Number.isFinite(exp) && Date.now() < exp;
}
const cookies = (req) => Object.fromEntries(
  (req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('=');
    return i < 0 ? ['', ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));

function checkPassword(pw) {
  if (!PASSWORD_HASH) return false;
  const [salt, want] = PASSWORD_HASH.split(':');
  if (!salt || !want) return false;
  const got = scrypt(pw, salt);
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* --------------------------------------------------------------- helpers -- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const send = (res, code, type, body, extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, ...extra });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, MIME['.json'], JSON.stringify(obj));
const readBody = (req, limit = 2 * 1024 * 1024) => new Promise((ok, bad) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > limit) { bad(new Error('too large')); req.destroy(); } chunks.push(c); });
  req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
  req.on('error', bad);
});

// Never let a request escape its directory.
function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  return p.startsWith(base) ? p : null;
}

// Raw binary body, for uploads. readBody() decodes to utf8 and would corrupt them.
const readBuffer = (req, limit) => new Promise((ok, bad) => {
  let n = 0; const chunks = [];
  req.on('data', c => {
    n += c.length;
    if (n > limit) { bad(new Error('too large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => ok(Buffer.concat(chunks)));
  req.on('error', bad);
});

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * Minimal ustar writer, so the backup needs no dependency.
 *
 * A tar is 512-byte header blocks, each followed by the file padded to a 512
 * boundary, then two zero blocks. `tar xf` and every desktop archiver read it.
 */
function buildTar(files) {
  const blocks = [];
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8');
    if (name.length > 100) continue;                    // long paths do not occur here
    const h = Buffer.alloc(512);
    const put = (s, off, len) => h.write(String(s).slice(0, len - 1), off, len - 1, 'utf8');
    const oct = (n, off, len) => h.write(n.toString(8).padStart(len - 1, '0') + '\0', off, len, 'utf8');

    put(f.path, 0, 100);
    oct(0o644, 100, 8);
    oct(0, 108, 8);
    oct(0, 116, 8);
    oct(f.data.length, 124, 12);
    oct(Math.floor(Date.now() / 1000), 136, 12);
    h.write('        ', 148, 8, 'utf8');                // checksum placeholder: spaces
    h.write('0', 156, 1, 'utf8');                       // regular file
    h.write('ustar\0', 257, 6, 'utf8');
    h.write('00', 263, 2, 'utf8');

    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');

    blocks.push(h, f.data);
    const pad = (512 - (f.data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));                      // end of archive
  return Buffer.concat(blocks);
}

/**
 * Pixel sizes of uploaded pictures, kept beside them in the volume.
 *
 * The build reads this to put width and height on each <img>, which reserves
 * the right space and stops the page shifting as pictures load.
 */
const SIZES = path.join(UPLOADS, 'sizes.json');
async function noteSize(name, w, h) {
  let all = {};
  try { all = JSON.parse(await fsp.readFile(SIZES, 'utf8')); } catch { /* first one */ }
  all[name] = { w, h };
  await fsp.writeFile(SIZES, JSON.stringify(all, null, 2) + '\n');
}

/** Keep the previous version of a post before overwriting or deleting it. */
async function keepVersion(file, name) {
  if (!fs.existsSync(file)) return;
  const dir = path.join(HISTORY, name);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.copyFile(file, path.join(dir, `${stamp()}.md`));
  const kept = (await fsp.readdir(dir)).sort().reverse();
  for (const old of kept.slice(KEEP_VERSIONS)) {
    await fsp.unlink(path.join(dir, old)).catch(() => {});
  }
}

/* -------------------------------------------------- frontmatter for posts -- */
function parsePost(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { title: '', slug: '', kind: 'blog', description: '', body: src };
  const d = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    d[kv[1]] = v;
  }
  return { title: d.title || '', slug: d.slug || '', kind: d.kind || 'blog',
           description: d.description || '', body: m[2] };
}
const yq = (s) => `"${String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const serializePost = (p) =>
  `---\ntitle: ${yq(p.title)}\nslug: ${yq(p.slug)}\nkind: ${p.kind === 'interview' ? 'interview' : 'blog'}\n` +
  `description: ${yq(p.description)}\n---\n\n${(p.body || '').trim()}\n`;

/* --------------------------------------------------------------- publish -- */
let publishing = false;
let lastPublish = null;
function publish() {
  if (publishing) return Promise.resolve({ ok: false, error: 'A publish is already running.' });
  publishing = true;
  const run = (script) => new Promise((ok, bad) =>
    execFile(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, timeout: 300000 },
      (err, so, se) => err ? bad(new Error(`${script}: ${se || err.message}`)) : ok(so)));
  return run('build-from-content.mjs')
    .then(() => run('build-static.mjs'))
    .then((out) => {
      lastPublish = new Date().toISOString();
      return { ok: true, at: lastPublish, detail: out.trim().split('\n').slice(-3).join(' | ') };
    })
    .catch((e) => ({ ok: false, error: e.message.slice(0, 500) }))
    .finally(() => { publishing = false; });
}

/* ---------------------------------------------------------------- routes -- */
const DATA_FILES = { products: 'products.json', stats: 'stats.json',
                     testimonials: 'testimonials.json', site: 'site.json' };

/**
 * Read and parse a JSON request body.
 *
 * Returns a sentinel rather than throwing, so a truncated upload or a client
 * bug produces a clear 400 instead of a 500 or, before the await fix above, a
 * dead process.
 */
const BAD_JSON = Symbol('bad json');
async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return BAD_JSON; }
}

async function api(req, res, url, authed) {
  const p = url.pathname.replace(/^\/admin\/api/, '');

  if (p === '/login' && req.method === 'POST') {
    const body = await readJson(req);
    if (body === BAD_JSON) return json(res, 400, { error: 'Could not read that request.' });
    const { password } = body;
    if (!checkPassword(password || '')) return json(res, 401, { error: 'Wrong password.' });
    const tok = makeToken();
    return json(res, 200, { ok: true, user: USER }, );
    // cookie set below via header, see wrapper
  }
  if (p === '/logout' && req.method === 'POST') return json(res, 200, { ok: true });
  if (p === '/me') return json(res, 200, { authed, user: authed ? USER : null, lastPublish });

  if (!authed) return json(res, 401, { error: 'Not signed in.' });

  // ---- posts
  if (p === '/posts' && req.method === 'GET') {
    const files = (await fsp.readdir(BLOG)).filter(f => f.endsWith('.md'));
    const list = await Promise.all(files.map(async f => {
      const d = parsePost(await fsp.readFile(path.join(BLOG, f), 'utf8'));
      return { file: f, title: d.title, slug: d.slug, kind: d.kind };
    }));
    list.sort((a, b) => a.title.localeCompare(b.title));
    return json(res, 200, list);
  }
  const post = p.match(/^\/posts\/([\w.-]+\.md)$/);
  if (post) {
    const file = safeJoin(BLOG, post[1]);
    if (!file) return json(res, 400, { error: 'Bad name.' });
    if (req.method === 'GET') {
      if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found.' });
      return json(res, 200, { file: post[1], ...parsePost(await fsp.readFile(file, 'utf8')) });
    }
    if (req.method === 'PUT') {
      const body = await readJson(req);
      if (body === BAD_JSON) return json(res, 400, { error: 'That change could not be read. Please try again.' });
      if (!body.title || !/^\/[a-z0-9/_-]+$/i.test(body.slug || ''))
        return json(res, 400, { error: 'A title and a valid web address are required.' });
      await keepVersion(file, post[1]);       // so an edit can be undone
      await fsp.writeFile(file, serializePost(body));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      // Move to the bin rather than unlink, so a mis-click is recoverable.
      if (fs.existsSync(file)) {
        await keepVersion(file, post[1]);
        await fsp.rename(file, path.join(TRASH, `${stamp()}__${post[1]}`));
      }
      return json(res, 200, { ok: true });
    }
  }
  if (p === '/posts' && req.method === 'POST') {
    const body = await readJson(req);
    if (body === BAD_JSON) return json(res, 400, { error: 'That post could not be read. Please try again.' });
    const name = (body.slug || '').replace(/^\//, '').replace(/[^\w-]+/g, '_');
    if (!name || !body.title) return json(res, 400, { error: 'A title and web address are required.' });
    const file = safeJoin(BLOG, `${name}.md`);
    if (!file) return json(res, 400, { error: 'Bad name.' });
    if (fs.existsSync(file)) return json(res, 409, { error: 'A post with that web address already exists.' });
    await fsp.writeFile(file, serializePost(body));
    return json(res, 200, { ok: true, file: `${name}.md` });
  }

  // ---- json collections
  const dm = p.match(/^\/data\/(\w+)$/);
  if (dm && DATA_FILES[dm[1]]) {
    const file = path.join(CONTENT, DATA_FILES[dm[1]]);
    if (req.method === 'GET') return json(res, 200, JSON.parse(await fsp.readFile(file, 'utf8')));
    if (req.method === 'PUT') {
      const body = await readBody(req);
      try { JSON.parse(body); } catch { return json(res, 400, { error: 'That is not valid data.' }); }
      await fsp.writeFile(file, JSON.stringify(JSON.parse(body), null, 2) + '\n');
      return json(res, 200, { ok: true });
    }
  }

  // ---- pictures
  if (p === '/uploads' && req.method === 'GET') {
    const files = (await fsp.readdir(UPLOADS)).filter(f => IMAGE_TYPES[path.extname(f).toLowerCase()]);
    const list = await Promise.all(files.map(async f => {
      const st = await fsp.stat(path.join(UPLOADS, f));
      return { name: f, url: '/uploads/' + f, bytes: st.size, at: st.mtime.toISOString() };
    }));
    list.sort((a, b) => b.at.localeCompare(a.at));
    return json(res, 200, list);
  }
  if (p === '/uploads' && req.method === 'POST') {
    // The browser sends the file as the raw body, with its name in a header.
    // That avoids hand-rolling a multipart parser for a single-file upload.
    const raw = decodeURIComponent(req.headers['x-filename'] || '');
    const ext = path.extname(raw).toLowerCase();
    if (!IMAGE_TYPES[ext])
      return json(res, 400, { error: 'Pictures must be JPG, PNG, WEBP or GIF.' });

    let buf;
    try { buf = await readBuffer(req, MAX_UPLOAD); }
    catch { return json(res, 413, { error: 'That picture is larger than 8 MB.' }); }
    if (!buf.length) return json(res, 400, { error: 'That file was empty.' });

    // Keep her filename, made safe, and never overwrite an existing picture.
    let base = path.basename(raw, ext).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'picture';
    let name = base + ext;
    for (let i = 2; fs.existsSync(path.join(UPLOADS, name)); i++) name = `${base}-${i}${ext}`;

    const dest = safeJoin(UPLOADS, name);
    if (!dest) return json(res, 400, { error: 'Bad name.' });
    await fsp.writeFile(dest, buf);

    // Remember the pixel size, so the build can put width and height on the
    // <img> and the page does not jump while the picture loads.
    const w = parseInt(req.headers['x-width'], 10);
    const h = parseInt(req.headers['x-height'], 10);
    if (w > 0 && h > 0) await noteSize(name, w, h);

    return json(res, 200, { ok: true, name, url: '/uploads/' + name, bytes: buf.length, width: w || null, height: h || null });
  }
  const up = p.match(/^\/uploads\/([\w.-]+)$/);
  if (up && req.method === 'DELETE') {
    const f = safeJoin(UPLOADS, up[1]);
    if (!f) return json(res, 400, { error: 'Bad name.' });
    if (fs.existsSync(f)) await fsp.rename(f, path.join(TRASH, `${stamp()}__upload__${up[1]}`));
    return json(res, 200, { ok: true });
  }

  // ---- the bin, and previous versions
  if (p === '/trash' && req.method === 'GET') {
    const files = await fsp.readdir(TRASH);
    const list = await Promise.all(files.map(async f => {
      const st = await fsp.stat(path.join(TRASH, f));
      const m = f.match(/^(.+?)__(?:(upload)__)?(.+)$/);
      const isUpload = !!(m && m[2]);
      let title = m ? m[3] : f;
      if (!isUpload && f.endsWith('.md')) {
        try { title = parsePost(await fsp.readFile(path.join(TRASH, f), 'utf8')).title || title; }
        catch { /* keep the filename */ }
      }
      return { name: f, title, kind: isUpload ? 'picture' : 'post', at: st.mtime.toISOString() };
    }));
    list.sort((a, b) => b.at.localeCompare(a.at));
    return json(res, 200, list);
  }
  const restore = p.match(/^\/trash\/([\w.:-]+)\/restore$/);
  if (restore && req.method === 'POST') {
    const src = safeJoin(TRASH, restore[1]);
    if (!src || !fs.existsSync(src)) return json(res, 404, { error: 'That item is no longer in the bin.' });
    const m = restore[1].match(/^(.+?)__(?:(upload)__)?(.+)$/);
    if (!m) return json(res, 400, { error: 'Bad name.' });
    const dest = m[2] ? safeJoin(UPLOADS, m[3]) : safeJoin(BLOG, m[3]);
    if (!dest) return json(res, 400, { error: 'Bad name.' });
    if (fs.existsSync(dest)) return json(res, 409, { error: 'Something with that name already exists.' });
    await fsp.rename(src, dest);
    return json(res, 200, { ok: true, restored: m[3] });
  }
  const hist = p.match(/^\/history\/([\w.-]+\.md)$/);
  if (hist && req.method === 'GET') {
    const dir = path.join(HISTORY, hist[1]);
    if (!fs.existsSync(dir)) return json(res, 200, []);
    const files = (await fsp.readdir(dir)).sort().reverse();
    const list = await Promise.all(files.map(async f => {
      const d = parsePost(await fsp.readFile(path.join(dir, f), 'utf8'));
      return { version: f, title: d.title, at: f.replace(/\.md$/, '') };
    }));
    return json(res, 200, list);
  }
  const revert = p.match(/^\/history\/([\w.-]+\.md)\/([\w.-]+\.md)\/restore$/);
  if (revert && req.method === 'POST') {
    const src = safeJoin(path.join(HISTORY, revert[1]), revert[2]);
    const dest = safeJoin(BLOG, revert[1]);
    if (!src || !dest || !fs.existsSync(src)) return json(res, 404, { error: 'That version is gone.' });
    await keepVersion(dest, revert[1]);       // the revert itself is undoable
    await fsp.copyFile(src, dest);
    return json(res, 200, { ok: true });
  }

  // ---- download everything she has written, as one file
  if (p === '/backup' && req.method === 'GET') {
    const files = [];
    const walk = async (dir, rel = '') => {
      for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;          // skip .trash and .history
        const abs = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(abs, r);
        else files.push({ path: r, data: await fsp.readFile(abs) });
      }
    };
    await walk(CONTENT);
    const tar = buildTar(files);
    return send(res, 200, 'application/x-tar', tar, {
      'Content-Disposition': `attachment; filename="medpsycmoss-content-${stamp().slice(0, 10)}.tar"`,
    });
  }

  // ---- orders, so she can see what sold without logging into Stripe
  if (p === '/orders' && req.method === 'GET') {
    const list = await store.listOrders(300);
    return json(res, 200, {
      connected: store.configured,
      orders: list.map(o => ({
        id: o.id, created: o.created, product: o.product_name, option: o.option,
        amount: fromCents(o.amount, o.currency), email: o.email, name: o.name,
        fulfilment: o.fulfilment, downloads: o.downloads,
        state: store.downloadState(o),
      })),
    });
  }

  if (p === '/publish' && req.method === 'POST') return json(res, 200, await publish());

  return json(res, 404, { error: 'No such endpoint.' });
}

/* ------------------------------------------------------------ static ------ */
async function serveStatic(res, base, rel, cacheable) {
  let file = safeJoin(base, rel);
  if (!file) return send(res, 403, MIME['.txt'], 'no');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    const alt = file.endsWith('.html') ? null : file + '/index.html';
    if (alt && fs.existsSync(alt)) file = alt;
    else {
      const notFound = path.join(base, '404.html');
      if (fs.existsSync(notFound)) return send(res, 404, MIME['.html'], fs.readFileSync(notFound));
      return send(res, 404, MIME['.txt'], 'Not found');
    }
  }
  const ext = path.extname(file).toLowerCase();
  const headers = { 'X-Content-Type-Options': 'nosniff' };
  if (cacheable && /\.(woff2|webp|svg|png|jpe?g|ico)$/.test(ext))
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  else headers['Cache-Control'] = 'no-cache, must-revalidate';
  send(res, 200, MIME[ext] || 'application/octet-stream', fs.readFileSync(file), headers);
}

/* ------------------------------------------------------------- server ----- */

// This process serves the public site as well as the editor, so an unhandled
// error must never be allowed to end it. Log and keep serving; a request that
// fails is far better than a site that disappears.
process.on('unhandledRejection', (e) => {
  console.error('unhandled rejection:', e && e.message ? e.message : e);
});
process.on('uncaughtException', (e) => {
  console.error('uncaught exception:', e && e.message ? e.message : e);
});

/* ------------------------------------------------------- order page ------ */
/**
 * What the buyer sees after paying.
 *
 * The webhook may not have landed yet when Stripe redirects them here, which is
 * normal and takes a second or two. In that case we say so and reload, rather
 * than telling a paying customer that nothing happened.
 */
function orderPage(order, id) {
  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let heading, body, refresh = '';

  if (!order) {
    heading = 'Finishing your order';
    body = '<p class="sub">Your payment went through. We are just recording it, this takes a moment.</p>';
    refresh = '<meta http-equiv="refresh" content="3">';
  } else {
    const paid = fromCents(order.amount, order.currency);
    const what = esc(order.product_name) + (order.option ? ' (' + esc(order.option) + ')' : '');

    if (order.fulfilment === 'download') {
      const state = store.downloadState(order);
      if (state === 'ready') {
        heading = 'Thank you, here is your download';
        body =
          '<p class="sub">' + what + ', ' + paid + '.</p>' +
          '<div class="hero-cta"><a class="btn" href="/api/store/download/' + esc(order.token) + '">Download it now</a></div>' +
          '<p class="fine">This link works for 30 days and up to ' + (order.max_downloads || 8) +
          ' downloads. Save the file somewhere safe. A copy of this page has been sent to ' +
          (order.email ? esc(order.email) : 'your email') + '.</p>';
      } else {
        heading = 'Thank you, your order is recorded';
        body =
          '<p class="sub">' + what + ', ' + paid + '.</p>' +
          '<p class="fine">Your file is being prepared and Dr. Moss will email it to ' +
          (order.email ? esc(order.email) : 'you') + ' shortly. Your order reference is ' +
          esc(order.id).slice(0, 24) + '.</p>';
      }
    } else if (order.fulfilment === 'booking') {
      const product = store.find(order.product_id);
      const link = product && product.booking_url;
      heading = 'Thank you, now pick your time';
      body =
        '<p class="sub">' + what + ', ' + paid + '.</p>' +
        (link
          ? '<div class="hero-cta"><a class="btn" href="' + esc(link) + '">Choose your time</a></div>'
          : '<p class="fine">Dr. Moss will email ' + (order.email ? esc(order.email) : 'you') +
            ' to arrange a time that suits you.</p>') +
        '<p class="fine">Your order reference is ' + esc(order.id).slice(0, 24) + '.</p>';
    } else {
      heading = 'Thank you, send your draft over';
      body =
        '<p class="sub">' + what + ', ' + paid + '.</p>' +
        '<p class="fine">Reply to your receipt email with your document attached, and Dr. Moss will ' +
        'come back to you within 48 to 72 hours. Your order reference is ' + esc(order.id).slice(0, 24) + '.</p>';
    }
  }

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n' +
    '<meta name="robots" content="noindex">\n' + refresh +
    '<title>' + esc(heading) + ' | MedPsycMoss</title>\n' +
    '<link rel="stylesheet" href="/css/site.css">\n' +
    '<style>.fine{color:var(--muted);font-size:14px;margin-top:18px;max-width:60ch}' +
    '.order-wrap{padding:70px 0 90px}</style>\n' +
    '</head>\n<body>\n<main id="main"><section class="hero order-wrap"><div class="mesh"></div><div class="wrap">' +
    '<p class="kicker"><span>ORDER: <b>CONFIRMED</b></span></p>' +
    '<h1 class="tight">' + esc(heading) + '</h1>' + body +
    '<div class="hero-cta" style="margin-top:26px"><a class="btn dark" href="/store">Back to the store</a></div>' +
    '</div></section></main>\n</body>\n</html>\n';
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, MIME['.txt'], 'bad'); }
  const pathname = decodeURIComponent(url.pathname);
  const authed = validToken(cookies(req).mpm_session);

  try {
    if (pathname === '/healthz') return send(res, 200, MIME['.txt'], 'ok\n');

    if (pathname.startsWith('/admin/api')) {
      // login needs to set the cookie, so it is handled here rather than in api()
      if (pathname === '/admin/api/login' && req.method === 'POST') {
        const { password } = JSON.parse(await readBody(req) || '{}');
        if (!checkPassword(password || '')) return json(res, 401, { error: 'Wrong password.' });
        const tok = makeToken();
        const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? ' Secure;' : '';
        res.setHeader('Set-Cookie',
          `mpm_session=${encodeURIComponent(tok)}; HttpOnly; SameSite=Lax; Path=/;${secure} Max-Age=${SESSION_HOURS * 3600}`);
        return json(res, 200, { ok: true, user: USER });
      }
      if (pathname === '/admin/api/logout' && req.method === 'POST') {
        res.setHeader('Set-Cookie', 'mpm_session=; HttpOnly; Path=/; Max-Age=0');
        return json(res, 200, { ok: true });
      }
      // `await` matters: api() is async, and without it a rejection inside
      // escapes the try/catch below as an unhandled rejection, which takes the
      // whole process down. This server also serves the public site, so a
      // malformed save request used to take the entire website offline.
      return await api(req, res, url, authed);
    }

    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      const rel = pathname.replace(/^\/admin\/?/, '') || 'index.html';
      return serveStatic(res, UI, rel, false);
    }

    // ---------------------------------------------------------------- store
    // All public: a buyer is not logged in, and Stripe certainly is not.

    if (pathname === '/api/store/checkout' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); }
      catch { return json(res, 400, { error: 'Could not read that request.' }); }
      try {
        // Only an id crosses the wire. The amount is decided server side.
        const out = await store.createCheckout({
          productId: String(body.productId || ''),
          optionId: String(body.optionId || ''),
          email: typeof body.email === 'string' ? body.email.slice(0, 200) : '',
        });
        return json(res, 200, { url: out.url });
      } catch (e) {
        console.error('checkout:', e.message);
        return json(res, 400, { error: e.message });
      }
    }

    // A webhook endpoint is configured once, by hand, in the Stripe dashboard.
    // A typo there fails silently and every order stops being fulfilled, so we
    // accept the obvious spellings rather than 404 someone's real payments.
    // Canonical is /api/store/webhook.
    const isWebhook = /^\/api\/(store|stripe)\/webhook\/?$/i.test(pathname);
    if (isWebhook && req.method === 'POST') {
      // The signature covers the exact bytes Stripe sent, so read it raw and do
      // not parse before verifying.
      const raw = (await readBuffer(req, 1024 * 1024)).toString('utf8');
      const sig = req.headers['stripe-signature'];
      if (!verifySignature(raw, sig, store.webhookSecret)) {
        console.error('webhook: bad signature, refused');
        return json(res, 400, { error: 'Bad signature.' });
      }
      let event;
      try { event = JSON.parse(raw); }
      catch { return json(res, 400, { error: 'Bad payload.' }); }

      // Acknowledge fast. Anything slow here means Stripe retries a payment we
      // have already taken.
      try {
        if (event.type === 'checkout.session.completed') {
          const order = await store.recordOrder(event.data.object);
          console.log('order recorded:', order.id, order.product_name, order.email);
        } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
          console.log('stripe event:', event.type, event.data.object.id);
        }
      } catch (e) {
        console.error('webhook handling:', e.message);
        // Still 200: the signature was good and retrying will not fix our bug.
      }
      return json(res, 200, { received: true });
    }

    if (pathname.startsWith('/api/store/download/') && req.method === 'GET') {
      const token = pathname.replace('/api/store/download/', '');
      const order = await store.orderByToken(token);
      if (!order) return send(res, 404, MIME['.txt'], 'That download link is not valid.\n');

      const state = store.downloadState(order);
      if (state === 'expired') return send(res, 410, MIME['.txt'], 'That download link has expired.\n');
      if (state === 'exhausted') return send(res, 429, MIME['.txt'], 'That link has been used too many times.\n');

      const file = store.fileFor(order);
      if (!file) return send(res, 503, MIME['.txt'], 'That file is not available yet.\n');

      await store.countDownload(order);
      const name = path.basename(file);
      const data = await fsp.readFile(file);
      return send(res, 200, MIME[path.extname(name).toLowerCase()] || 'application/octet-stream', data, {
        'Content-Disposition': 'attachment; filename="' + name + '"',
        'Cache-Control': 'no-store',
      });
    }

    if (pathname.startsWith('/order/')) {
      const id = pathname.replace('/order/', '').trim();
      const order = await store.getOrder(id);
      return send(res, 200, MIME['.html'], orderPage(order, id));
    }

    // Pictures are served straight from the volume, so one she uploads is live
    // immediately and does not wait for a publish. The build also copies them
    // into dist/ so the site still works if it is ever served statically.
    if (pathname.startsWith('/uploads/')) {
      return serveStatic(res, UPLOADS, pathname.replace(/^\/uploads\//, ''), true);
    }

    return serveStatic(res, DIST, pathname === '/' ? 'index.html' : pathname, true);
  } catch (e) {
    console.error(req.method, pathname, e.message);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong.' });
  }
});

server.listen(PORT, () => {
  console.log(`
  MedPsycMoss
  -----------
  site   http://localhost:${PORT}/
  editor http://localhost:${PORT}/admin
  user   ${USER}${PASSWORD_HASH ? '' : '   (NO PASSWORD SET, editor disabled)'}
  serving ${fs.existsSync(DIST) ? fs.readdirSync(DIST).length + ' entries from dist/' : 'NOTHING, dist/ is missing'}
`);
});
