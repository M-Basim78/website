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
  if (b.dataset.tab !== 'posts') loadData(b.dataset.tab);
}));

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
