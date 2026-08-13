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

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CONTENT = path.join(ROOT, 'content');
const BLOG = path.join(CONTENT, 'blog');
const UI = path.join(__dirname, 'public');

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
      await fsp.writeFile(file, serializePost(body));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      if (fs.existsSync(file)) await fsp.unlink(file);
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
