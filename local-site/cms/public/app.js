/* Editor front end. Vanilla, no build step, no dependencies. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
}

async function api(path, opts = {}) {
  const r = await fetch('/admin/api' + path, {
    headers: { 'Content-Type': 'application/json' }, ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

/* ----------------------------------------------------------------- login -- */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-err'); err.hidden = true;
  try {
    await api('/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) });
    start();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

$('#logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

/* ------------------------------------------------------------------ tabs -- */
$$('.tabs button').forEach(b => b.addEventListener('click', () => {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  const t = b.dataset.tab;
  if (t === 'uploads') loadUploads();
  else if (t === 'trash') loadTrash();
  else if (t !== 'posts') loadData(t);
}));

/* -------------------------------------------------------------- pictures -- */
const kb = (n) => n < 1024 * 1024
  ? Math.round(n / 1024) + ' KB'
  : (n / 1024 / 1024).toFixed(1) + ' MB';

async function loadUploads() {
  const box = $('#uploads');
  box.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const list = await api('/uploads');
    if (!list.length) {
      box.innerHTML = '<p class="hint">No pictures yet. Press "Add a picture" above.</p>';
      return;
    }
    box.innerHTML = list.map(u => `
      <figure class="pic">
        <img src="${esc(u.url)}" alt="${esc(u.name)}" loading="lazy">
        <figcaption>
          <span class="pic-name" title="${esc(u.name)}">${esc(u.name)}</span>
          <span class="pic-size">${kb(u.bytes)}</span>
        </figcaption>
        <div class="pic-actions">
          <button data-copy="${esc(u.url)}">Copy</button>
          <button data-del="${esc(u.name)}" class="danger">Delete</button>
        </div>
      </figure>`).join('');

    $$('#uploads [data-copy]').forEach(b => b.addEventListener('click', async () => {
      // What she pastes into a post to place the picture.
      const snippet = `![Describe this picture](${b.dataset.copy})`;
      try { await navigator.clipboard.writeText(snippet); toast('Copied. Paste it into a post on its own line.'); }
      catch { prompt('Copy this and paste it into a post on its own line:', snippet); }
    }));

    $$('#uploads [data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Delete ${b.dataset.del}? It goes to the Bin and can be restored.`)) return;
      try {
        await api('/uploads/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
        toast('Moved to the Bin.');
        loadUploads();
      } catch (ex) { toast(ex.message, 'bad'); }
    }));
  } catch (ex) {
    box.innerHTML = `<p class="hint">${esc(ex.message)}</p>`;
  }
}

/**
 * Shrink a picture before it is uploaded.
 *
 * The server has no image library on purpose, so this happens here. A photo
 * straight off a phone is 8 MB and 4000px wide; the site never displays one
 * wider than 1600, so sending the original wastes her upload and every
 * visitor's download.
 *
 * Re-encoding through a canvas also drops the EXIF block, which removes the GPS
 * coordinates phones embed in photos. That matters for a physician posting
 * pictures.
 */
const MAX_EDGE = 1600;

async function shrink(file) {
  // createImageBitmap applies the EXIF rotation, so portrait photos stay upright.
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { return null; }                       // not decodable, let the server judge

  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();

  // GIFs may be animated; a canvas would flatten them to one frame.
  if (file.type === 'image/gif') return null;

  const blob = await new Promise(ok => canvas.toBlob(ok, 'image/webp', 0.82))
    || await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', 0.85));
  if (!blob) return null;

  // If shrinking somehow made it bigger, keep the original.
  if (blob.size >= file.size && scale === 1) return null;

  const ext = blob.type === 'image/webp' ? '.webp' : '.jpg';
  const base = file.name.replace(/\.[^.]+$/, '');
  return { blob, name: base + ext, w, h, from: file.size };
}

$('#upfile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  toast('Preparing the picture...');
  let body = file, name = file.name, dims = null, before = file.size;
  try {
    const small = await shrink(file);
    if (small) { body = small.blob; name = small.name; dims = small; }
  } catch { /* fall through and send the original */ }

  if (body.size > 8 * 1024 * 1024) {
    toast('That picture is still larger than 8 MB after resizing. Please use a smaller one.', 'bad');
    return;
  }

  toast('Uploading...');
  try {
    const headers = {
      'Content-Type': body.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(name),
    };
    if (dims) { headers['x-width'] = String(dims.w); headers['x-height'] = String(dims.h); }

    const r = await fetch('/admin/api/uploads', { method: 'POST', headers, body });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Upload failed.');

    toast(dims && before > body.size
      ? `Picture added, resized from ${kb(before)} to ${kb(body.size)}.`
      : 'Picture added.');
    loadUploads();
  } catch (ex) { toast(ex.message, 'bad'); }
});

/* ------------------------------------------------------------------- bin -- */
async function loadTrash() {
  const box = $('#trash');
  box.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const list = await api('/trash');
    if (!list.length) {
      box.innerHTML = '<p class="hint">The Bin is empty. Nothing has been deleted.</p>';
      return;
    }
    box.innerHTML = `<ul class="list">${list.map(t => `
      <li>
        <span class="t">${esc(t.title)}</span>
        <span class="meta">${t.kind} &middot; deleted ${new Date(t.at).toLocaleString()}</span>
        <button data-restore="${esc(t.name)}">Restore</button>
      </li>`).join('')}</ul>`;

    $$('#trash [data-restore]').forEach(b => b.addEventListener('click', async () => {
      try {
        await api('/trash/' + encodeURIComponent(b.dataset.restore) + '/restore', { method: 'POST' });
        toast('Restored. Press Publish to put it back on the site.');
        loadTrash();
        loadPosts();
      } catch (ex) { toast(ex.message, 'bad'); }
    }));
  } catch (ex) {
    box.innerHTML = `<p class="hint">${esc(ex.message)}</p>`;
  }
}

$('#backup').addEventListener('click', () => {
  // Straight download; the browser handles it from the Content-Disposition.
  window.location = '/admin/api/backup';
  toast('Downloading a copy of everything you have written.');
});

/* ----------------------------------------------------------------- posts -- */
let posts = [], current = null;

async function loadPosts() {
  posts = await api('/posts');
  const list = $('#post-list');
  list.innerHTML = posts.map(p => `
    <button data-file="${esc(p.file)}">
      <span class="kind">${esc(p.kind)}</span>
      <span class="t">${esc(p.title)}</span>
      <span class="s">${esc(p.slug)}</span>
    </button>`).join('');
  $$('#post-list button').forEach(b =>
    b.addEventListener('click', () => openPost(b.dataset.file)));
}

function postForm(p, isNew) {
  return `
    <label class="f">Title<input class="f" id="p-title" value="${esc(p.title)}"></label>
    <label class="f">Web address
      <span class="hint">Starts with a slash. Changing this on an existing post breaks old links.</span>
      <input class="f" id="p-slug" value="${esc(p.slug)}" placeholder="/blog/my-new-post"></label>
    <label class="f">Type
      <select class="f" id="p-kind">
        <option value="blog"${p.kind !== 'interview' ? ' selected' : ''}>Blog post</option>
        <option value="interview"${p.kind === 'interview' ? ' selected' : ''}>Interview</option>
      </select></label>
    <label class="f">Search engine description
      <span class="hint">About 155 characters. This is what Google shows.</span>
      <input class="f" id="p-desc" value="${esc(p.description)}"></label>
    <label class="f">Body
      <span class="hint">Leave a blank line between paragraphs. Start a line with ## for a subheading.</span>
      <textarea class="f" id="p-body">${esc(p.body)}</textarea></label>
    <div class="row">
      <button class="btn" id="p-save">${isNew ? 'Create post' : 'Save'}</button>
      ${isNew ? '' : '<button class="btn danger small" id="p-del">Delete this post</button>'}
    </div>`;
}

async function openPost(file) {
  const p = await api('/posts/' + encodeURIComponent(file));
  current = file;
  $$('#post-list button').forEach(b => b.classList.toggle('on', b.dataset.file === file));
  $('#post-edit').innerHTML = postForm(p, false);
  $('#p-save').addEventListener('click', () => savePost(file));
  $('#p-del').addEventListener('click', async () => {
    if (!confirm('Delete this post? This cannot be undone from here.')) return;
    await api('/posts/' + encodeURIComponent(file), { method: 'DELETE' });
    current = null; $('#post-edit').innerHTML = '<p class="empty">Post deleted. Publish to update the site.</p>';
    await loadPosts(); toast('Deleted. Remember to publish.', 'good');
  });
}

function readPostForm() {
  return {
    title: $('#p-title').value.trim(),
    slug: $('#p-slug').value.trim(),
    kind: $('#p-kind').value,
    description: $('#p-desc').value.trim(),
    body: $('#p-body').value,
  };
}

async function savePost(file) {
  try {
    await api('/posts/' + encodeURIComponent(file), { method: 'PUT', body: JSON.stringify(readPostForm()) });
    await loadPosts(); toast('Saved. Press Publish to put it live.', 'good');
  } catch (e) { toast(e.message, 'bad'); }
}

$('#new-post').addEventListener('click', () => {
  current = null;
  $$('#post-list button').forEach(b => b.classList.remove('on'));
  $('#post-edit').innerHTML = postForm({ title: '', slug: '/blog/', kind: 'blog', description: '', body: '' }, true);
  $('#p-save').addEventListener('click', async () => {
    try {
      const r = await api('/posts', { method: 'POST', body: JSON.stringify(readPostForm()) });
      await loadPosts(); await openPost(r.file);
      toast('Created. Press Publish to put it live.', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  });
});

/* ------------------------------------------------- products / stats / etc -- */
const FIELDS = {
  products: [
    ['name', 'Name', 'input'], ['price', 'Price', 'input'],
    ['description', 'Description', 'textarea'], ['chip', 'Badge', 'input'],
    ['category', 'Category tag', 'input'], ['cta', 'Button text', 'input'],
    ['store_path', 'Gator product path (do not change)', 'input'],
  ],
  stats: [['value', 'Number', 'input'], ['label', 'Label', 'input']],
  testimonials: [
    ['quote', 'Quote', 'textarea'], ['attribution', 'Who said it', 'input'],
    ['context', 'Context', 'input'],
  ],
};

let dataCache = {};

async function loadData(kind) {
  const data = await api('/data/' + kind);
  dataCache[kind] = data;
  if (kind === 'site') return renderSite(data);
  const key = kind === 'products' ? 'products' : kind === 'stats' ? 'stats' : 'featured';
  const rows = data[key] || [];
  $('#' + kind).innerHTML = rows.map((row, i) => `
    <div class="item">
      <h3>${esc(row.name || row.value || row.attribution || 'Item ' + (i + 1))}</h3>
      <div class="grid">
        ${FIELDS[kind].map(([f, label, tag]) => `
          <label class="f ${tag === 'textarea' ? 'full' : ''}">${esc(label)}
            ${tag === 'textarea'
              ? `<textarea class="f" style="min-height:90px" data-k="${kind}" data-i="${i}" data-f="${f}">${esc(row[f] || '')}</textarea>`
              : `<input class="f" data-k="${kind}" data-i="${i}" data-f="${f}" value="${esc(row[f] || '')}">`}
          </label>`).join('')}
      </div>
    </div>`).join('') + `<button class="btn" id="save-${kind}">Save ${kind === 'stats' ? 'numbers' : kind}</button>`;

  $('#save-' + kind).addEventListener('click', async () => {
    $$(`[data-k="${kind}"]`).forEach(el => {
      dataCache[kind][key][el.dataset.i][el.dataset.f] = el.value;
    });
    try {
      await api('/data/' + kind, { method: 'PUT', body: JSON.stringify(dataCache[kind]) });
      toast('Saved. Press Publish to put it live.', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  });
}

function renderSite(d) {
  const h = d.home || {}, f = d.footer || {};
  const t = (path, label, tag = 'input', hint = '') => `
    <label class="f ${tag === 'textarea' ? 'full' : ''}">${esc(label)}
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      ${tag === 'textarea'
        ? `<textarea class="f" style="min-height:90px" data-p="${path}">${esc(get(d, path))}</textarea>`
        : `<input class="f" data-p="${path}" value="${esc(get(d, path))}">`}
    </label>`;
  $('#site').innerHTML = `
    <div class="item"><h3>Hero</h3><div class="grid">
      ${t('home.title', 'Browser tab title')}
      ${t('home.description', 'Search engine description')}
      ${t('home.hero_sub', 'Opening paragraph', 'textarea')}
      ${t('home.ecg_tag', 'Text on the heartbeat strip')}
    </div></div>
    <div class="item"><h3>Free guides section</h3><div class="grid">
      ${t('home.free.label', 'Small label')}
      ${t('home.free.heading', 'Heading')}
      ${t('home.free.intro', 'Intro', 'textarea')}
    </div></div>
    <div class="item"><h3>Store section</h3><div class="grid">
      ${t('home.store.label', 'Small label')}
      ${t('home.store.heading', 'Heading')}
      ${t('home.store.intro', 'Intro', 'textarea')}
    </div></div>
    <div class="item"><h3>Footer</h3><div class="grid">
      ${t('footer.bio', 'Short bio', 'textarea')}
      ${t('footer.disclaimer', 'Legal disclaimer', 'textarea',
          'This is a professional requirement. Change it only if you are certain.')}
    </div></div>
    <button class="btn" id="save-site">Save wording</button>`;

  $('#save-site').addEventListener('click', async () => {
    $$('[data-p]').forEach(el => set(dataCache.site, el.dataset.p, el.value));
    try {
      await api('/data/site', { method: 'PUT', body: JSON.stringify(dataCache.site) });
      toast('Saved. Press Publish to put it live.', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  });
}
const get = (o, p) => p.split('.').reduce((a, k) => (a || {})[k], o) ?? '';
const set = (o, p, v) => {
  const ks = p.split('.'); const last = ks.pop();
  ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v;
};

/* --------------------------------------------------------------- publish -- */
$('#publish').addEventListener('click', async () => {
  const b = $('#publish');
  b.disabled = true; b.textContent = 'Publishing...';
  $('#status').textContent = 'Rebuilding the site, this takes a few seconds.';
  try {
    const r = await api('/publish', { method: 'POST' });
    if (r.ok) { toast('Your changes are live.', 'good'); $('#status').textContent = 'Published just now.'; }
    else { toast(r.error, 'bad'); $('#status').textContent = 'Publish failed.'; }
  } catch (e) { toast(e.message, 'bad'); $('#status').textContent = 'Publish failed.'; }
  b.disabled = false; b.textContent = 'Publish changes';
});

/* ------------------------------------------------------------------ boot -- */
async function start() {
  $('#login').hidden = true; $('#app').hidden = false;
  await loadPosts();
  const me = await api('/me');
  if (me.lastPublish) $('#status').textContent = 'Last published ' + new Date(me.lastPublish).toLocaleString();
}

api('/me').then(m => { if (m.authed) start(); }).catch(() => {});
