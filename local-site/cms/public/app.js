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
  if (t === 'orders') loadOrders();
  else if (t === 'messages') loadMessages();
  else if (t === 'visitors') loadVisitors();
  else if (t === 'uploads') loadUploads();
  else if (t === 'trash') loadTrash();
  else if (t !== 'posts') loadData(t);
}));

/* ---------------------------------------------------------------- orders -- */
/** "3 days ago", because "2026-08-23T14:02Z" is not how anyone thinks. */
function ago(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  if (!isFinite(d)) return '';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return d + ' days ago';
  return new Date(iso).toLocaleDateString();
}

async function markDone(id, done, btn) {
  if (btn) { btn.disabled = true; btn.textContent = done ? 'Marking...' : 'Undoing...'; }
  try {
    await api('/orders/' + encodeURIComponent(id) + '/done', {
      method: 'POST', body: JSON.stringify({ done: done }),
    });
    toast(done ? 'Marked as done.' : 'Put back on the list.');
    await loadOrders();
    loadPending();
  } catch (ex) {
    toast(ex.message, 'bad');
    if (btn) { btn.disabled = false; btn.textContent = done ? 'Mark done' : 'Undo'; }
  }
}

function todoItem(o) {
  const t = o.todo;
  // mailto with the order already written into it, so acting on one of these is
  // a click and not a copy-paste job across three fields.
  const subject = encodeURIComponent('Your order: ' + o.product);
  const body = encodeURIComponent(
    'Hi' + (o.name ? ' ' + o.name.split(' ')[0] : '') + ',\n\n' +
    'Thank you for buying ' + o.product + '.\n\n\n\n' +
    'Dr. Stephanie Moss, MD\nmedpsycmoss.com\n\n' +
    'Order reference: ' + o.id.slice(0, 24) + '\n');

  const mail = o.email
    ? '<a href="mailto:' + esc(o.email) + '?subject=' + subject + '&body=' + body + '">' + esc(o.email) + '</a>'
    : '<span class="meta">no email on the order</span>';

  return '<div class="item' + (t.urgent ? ' urgent' : '') + '">' +
    '<span class="t">' + esc(o.product) + (o.option ? ' <small>(' + esc(o.option) + ')</small>' : '') + '</span>' +
    '<span class="act"><button class="btn small ghost" data-done="' + esc(o.id) + '">Mark done</button></span>' +
    '<span class="what">' + esc(t.what) + '</span>' +
    '<span class="who">' + mail + '</span>' +
    '<span class="meta">' + esc(o.amount) + ' &middot; paid ' + esc(ago(o.created)) + '</span>' +
    '</div>';
}

async function loadOrders() {
  const box = $('#orders');
  const todoBox = $('#orders-todo');
  const status = $('#orders-status');
  box.innerHTML = '<p class="hint">Loading...</p>';
  todoBox.innerHTML = '';
  try {
    const data = await api('/orders');
    // Saying "no orders to show" while orders are on screen is worse than saying
    // nothing. Report the Stripe connection and the orders separately.
    status.textContent = data.connected
      ? 'Every sale made through the website. Payments are handled by Stripe; this is a record, not the money itself.'
      : data.orders.length
        ? 'Showing recorded orders. Stripe is not connected right now, so no new ones can come in.'
        : 'The shop is not connected to Stripe yet, so there are no orders to show.';

    if (!data.orders.length) {
      box.innerHTML = '<p class="hint">No orders yet.</p>';
      return;
    }

    // Anything she still has to do by hand goes first, oldest at the top, so the
    // one that has been waiting longest is the one she sees.
    const todo = data.orders.filter(o => o.todo)
      .sort((a, b) => String(a.created).localeCompare(String(b.created)));

    todoBox.innerHTML = todo.length
      ? '<div class="todo-head"><h3>Waiting on you</h3>' +
        '<span class="n">' + todo.length + ' ' + (todo.length === 1 ? 'order' : 'orders') +
        '. Mark each one done once you have sent it.</span></div>' +
        '<div class="todo">' + todo.map(todoItem).join('') + '</div>'
      : '<div class="todo-head"><h3>Nothing waiting on you</h3>' +
        '<span class="n">Every order has been dealt with.</span></div>';

    box.innerHTML = '<h3 style="font-size:16px;margin-bottom:12px">All orders</h3>' +
      '<ul class="list' + (todo.length ? ' done-list' : '') + '">' + data.orders.map(o => `
      <li>
        <span class="t">${esc(o.product)}${o.option ? ' <small>(' + esc(o.option) + ')</small>' : ''}</span>
        <span class="meta">${esc(o.amount)} &middot; ${esc(o.email || 'no email')} &middot; ${new Date(o.created).toLocaleString()}</span>
        <span class="meta">${esc(o.fulfilment)}${o.fulfilment === 'download' ? ' &middot; ' + o.downloads + ' downloads &middot; ' + esc(o.state) : ''}${
          o.fulfilled_at ? ' &middot; done ' + esc(ago(o.fulfilled_at)) : ''}</span>
        ${o.fulfilled_at ? '<button class="btn small ghost" data-undone="' + esc(o.id) + '">Undo</button>' : ''}
      </li>`).join('') + '</ul>';
  } catch (ex) {
    box.innerHTML = `<p class="hint">${esc(ex.message)}</p>`;
  }
}

// One listener for both lists, so re-rendering never leaves a dead button.
document.addEventListener('click', (e) => {
  const d = e.target.closest('[data-done]');
  if (d) return markDone(d.dataset.done, true, d);
  const u = e.target.closest('[data-undone]');
  if (u) return markDone(u.dataset.undone, false, u);
});

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
    <label class="f">YouTube video
      <span class="hint">Paste the link to the video for this post. The thumbnail appears at the
        top of the page and clicks through to YouTube. Leave it blank for no video.</span>
      <input class="f" id="p-video" value="${esc(p.video || '')}"
             placeholder="https://www.youtube.com/watch?v=..."></label>
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
    video: $('#p-video').value.trim(),
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
/* -------------------------------------------------------------- messages -- */
/* Written to disk before anything is emailed, so this screen is the record and
   the email is the notification. With no SMTP configured this is the ONLY place
   an enquiry appears, which is why it is a first-class tab and not a footnote. */

async function messageAction(id, method, body) {
  return api('/messages/' + encodeURIComponent(id) + (method === 'DELETE' ? '' : '/read'),
    method === 'DELETE' ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify(body) });
}

function msgCard(m) {
  const subject = encodeURIComponent('Re: ' + m.subject);
  const quoted = m.message.split('\n').map(l => '> ' + l).join('\n');
  const body = encodeURIComponent(
    'Hi ' + (m.name || '').split(' ')[0] + ',\n\n\n\n' +
    'Dr. Stephanie Moss, MD\nmedpsycmoss.com\n\n' + quoted + '\n');
  return '<div class="msg' + (m.read_at ? '' : ' unread') + '">' +
    '<span class="subj">' + esc(m.subject) + '</span>' +
    '<span class="acts">' +
      '<a class="btn small" href="mailto:' + esc(m.email) + '?subject=' + subject + '&body=' + body + '">Reply</a>' +
      '<button class="btn small ghost" data-msgread="' + esc(m.id) + '" data-read="' + (m.read_at ? '0' : '1') + '">' +
        (m.read_at ? 'Mark unread' : 'Mark read') + '</button>' +
      '<button class="btn small danger" data-msgdel="' + esc(m.id) + '">Delete</button>' +
    '</span>' +
    '<span class="from">' + esc(m.name) + ' &middot; <a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a></span>' +
    '<span class="body">' + esc(m.message) + '</span>' +
    '<span class="when">' + esc(ago(m.created)) + ' &middot; ' + new Date(m.created).toLocaleString() + '</span>' +
    '</div>';
}

async function loadMessages() {
  const box = $('#messages'), subs = $('#subscribers'), note = $('#msg-note');
  box.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const d = await api('/messages');
    note.textContent = d.mail.configured
      ? 'Everything sent through the contact form. A copy also goes to ' + d.mail.to + '.'
      : 'Everything sent through the contact form. Email sending is not set up yet, so this page is the only copy: check it regularly.';

    box.innerHTML = d.messages.length
      ? d.messages.map(msgCard).join('')
      : '<p class="hint">No messages yet.</p>';

    const sv = await api('/subscribers');
    subs.innerHTML = sv.count
      ? '<div class="subs">' + sv.list.map(x =>
          '<div class="row"><span class="e">' + esc(x.email) + '</span>' +
          '<span class="d">' + esc(x.name || '') + ' &middot; ' + esc(ago(x.joined)) + '</span></div>').join('') +
        '</div>'
      : '<p class="hint">Nobody has signed up yet.</p>';
  } catch (ex) {
    box.innerHTML = '<p class="hint">' + esc(ex.message) + '</p>';
  }
}

document.addEventListener('click', async (e) => {
  const r = e.target.closest('[data-msgread]');
  if (r) {
    await messageAction(r.dataset.msgread, 'POST', { read: r.dataset.read === '1' }).catch(() => {});
    loadMessages(); loadPending(); return;
  }
  const del = e.target.closest('[data-msgdel]');
  if (del) {
    if (!confirm('Delete this message? It cannot be undone.')) return;
    await messageAction(del.dataset.msgdel, 'DELETE').catch((ex) => toast(ex.message, 'bad'));
    toast('Message deleted.');
    loadMessages(); loadPending();
  }
});

/* --------------------------------------------------------------- traffic -- */
/* Everything here is drawn from divs. Thirty numbers do not justify pulling a
   charting library into a container that otherwise has no dependencies. */

const nfmt = (n) => Number(n || 0).toLocaleString();

/** "6 Aug" - short enough for an axis, unambiguous for her. */
const dshort = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** The change against the window before, phrased so it needs no explaining. */
function delta(now, before) {
  if (!before) return { cls: 'flat', text: now ? 'first full period' : '' };
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { cls: 'flat', text: 'same as the 30 days before' };
  return {
    cls: pct > 0 ? 'up' : 'down',
    text: (pct > 0 ? '+' : '') + pct + '% vs the period before',
  };
}

async function loadGlance() {
  let d;
  try { d = await api('/analytics?days=30'); } catch { return; }

  $('#g-visits').textContent = nfmt(d.views);
  const dd = delta(d.views, d.previous.views);
  const el = $('#g-delta');
  el.textContent = dd.text;
  el.className = 'gd ' + dd.cls;
  $('#g-people').textContent = d.views
    ? nfmt(d.visitors) + ' ' + (d.visitors === 1 ? 'visitor' : 'visitors')
    : 'No visits recorded yet.';

  // Sparkline. The tallest day is full height; a day with nothing still shows a
  // sliver, so a gap reads as quiet rather than as broken.
  const max = Math.max(1, ...d.perDay.map(x => x.views));
  $('#g-spark').innerHTML = d.perDay.map(x => {
    const h = Math.max(6, Math.round((x.views / max) * 100));
    return '<i class="' + (x.views === max && max > 0 ? 'hi' : '') + '" style="height:' + h + '%"></i>';
  }).join('');

  $('#glance').hidden = false;
}

async function loadPending() {
  let d;
  try { d = await api('/orders/pending'); } catch { return; }
  loadUnread(d);                      // one request feeds both cards
  const card = $('#g-orders');
  if (!d.count) { card.hidden = true; return; }
  $('#g-pending').textContent = nfmt(d.count);
  $('#g-oldest').textContent = d.oldest
    ? 'oldest paid ' + ago(d.oldest)
    : '';
  card.hidden = false;
}

async function loadUnread(d) {
  const card = $('#g-msgs');
  try { d = d || await api('/orders/pending'); } catch { return; }
  const n = d.unreadMessages || 0;
  if (!n) { card.hidden = true; return; }
  $('#g-unread').textContent = nfmt(n);
  card.hidden = false;
}

$('#g-msgs').addEventListener('click', () => {
  const tab = $$('.tabs button').find(b => b.dataset.tab === 'messages');
  if (tab) tab.click();
});

$('#g-orders').addEventListener('click', () => {
  const tab = $$('.tabs button').find(b => b.dataset.tab === 'orders');
  if (tab) tab.click();
});

$('#g-open').addEventListener('click', () => {
  const tab = $$('.tabs button').find(b => b.dataset.tab === 'visitors');
  if (tab) tab.click();
});

$('#vis-range').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-days]');
  if (!b) return;
  $$('#vis-range button').forEach(x => x.classList.toggle('on', x === b));
  loadVisitors(Number(b.dataset.days));
});

function rows(list, empty) {
  if (!list.length) return '<p class="empty">' + empty + '</p>';
  const max = Math.max(...list.map(x => x.count));
  return '<div class="vlist">' + list.map(x =>
    '<div class="vrow">' +
      '<span class="nm" style="--pct:' + Math.round((x.count / max) * 100) + '%" title="' +
        esc(x.name) + '">' + esc(x.name) + '</span>' +
      '<span class="ct">' + nfmt(x.count) + '</span>' +
    '</div>').join('') + '</div>';
}

async function loadVisitors(days = 30) {
  const box = $('#visitors');
  box.innerHTML = '<p class="hint">Loading...</p>';
  let d;
  try { d = await api('/analytics?days=' + days); }
  catch (ex) { box.innerHTML = '<p class="empty">Could not load this: ' + esc(ex.message) + '</p>'; return; }

  $('#vis-since').textContent = d.since
    ? 'Counting since ' + dshort(d.since) + '.'
    : 'Counting starts the moment the site goes live.';

  const max = Math.max(1, ...d.perDay.map(x => x.views));
  const chart = d.perDay.map(x =>
    '<span class="col" data-label="' + dshort(x.date) + ': ' + nfmt(x.views) +
      (x.views === 1 ? ' visit' : ' visits') + '">' +
      '<i class="' + (x.views ? 'v' : '') + '" style="height:' +
        Math.max(2, Math.round((x.views / max) * 100)) + '%"></i>' +
    '</span>').join('');

  const dd = delta(d.views, d.previous.views);

  box.innerHTML =
    '<div class="vgrid">' +
      '<div class="vbox wide">' +
        '<h3>' + nfmt(d.views) + ' visits over ' + days + ' days' +
          (dd.text ? ' <span class="gd ' + dd.cls + '">' + esc(dd.text.replace('30 days', days + ' days')) + '</span>' : '') +
        '</h3>' +
        '<div class="chart">' + chart + '</div>' +
        '<div class="chart-x"><span>' + dshort(d.from) + '</span><span>' + dshort(d.to) + '</span></div>' +
      '</div>' +
      '<div class="vbox"><h3>Most read pages</h3>' +
        rows(d.topPages, 'Nothing recorded yet.') + '</div>' +
      '<div class="vbox"><h3>Where people came from</h3>' +
        rows(d.topReferrers, 'Nothing recorded yet.') +
        '<p class="empty" style="margin-top:12px">"Direct" means they typed the address, ' +
        'used a bookmark, or followed a link from an app that does not say where it came from ' +
        '(Instagram in-app links usually land here).</p>' +
      '</div>' +
    '</div>';
}

async function start() {
  $('#login').hidden = true; $('#app').hidden = false;
  await loadPosts();
  loadGlance();          // not awaited: the cards must never hold up the editor
  loadPending();
  const me = await api('/me');
  if (me.lastPublish) $('#status').textContent = 'Last published ' + new Date(me.lastPublish).toLocaleString();
}

api('/me').then(m => { if (m.authed) start(); }).catch(() => {});
