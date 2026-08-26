/**
 * The contact form and the mailing list.
 *
 * The most important decision here: DISK FIRST, EMAIL SECOND.
 *
 * A student writing about a failed exam is not a notification, it is a record.
 * Every message is written to content/ before anything is emailed, so the form
 * works completely with no SMTP configured at all, and an expired app password
 * costs a notification rather than an enquiry. She reads them in the editor
 * either way.
 *
 * Everything lives in the content volume, so it survives a redeploy and is
 * covered by the backup button.
 *
 *   content/messages/<iso>-<rand>.json   one per enquiry
 *   content/subscribers.json             the list, exportable as CSV
 */
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const MAX = { name: 120, email: 200, subject: 200, message: 8000 };

const clean = (v, limit) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, limit);
const isEmail = (s) => /^[^\s@,;:<>"']+@[^\s@,;:<>"']+\.[A-Za-z]{2,}$/.test(String(s || '').trim());

class Inbox {
  constructor(opts) {
    this.CONTENT = opts.contentDir;
    this.DIR = path.join(this.CONTENT, 'messages');
    this.SUBS = path.join(this.CONTENT, 'subscribers.json');
    fs.mkdirSync(this.DIR, { recursive: true });

    // Simple in-memory throttle. Not a security control, just enough that one
    // bored person cannot fill the volume from a coffee shop.
    this.recent = new Map();
    this.WINDOW_MS = 10 * 60 * 1000;
    this.MAX_PER_WINDOW = 5;
  }

  /** Same shape as the analytics fingerprint: never store the address itself. */
  _who(req) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = fwd || (req.socket && req.socket.remoteAddress) || '';
    return crypto.createHash('sha256').update('inbox|' + ip).digest('hex').slice(0, 12);
  }

  throttled(req) {
    const key = this._who(req);
    const now = Date.now();
    const hits = (this.recent.get(key) || []).filter(t => now - t < this.WINDOW_MS);
    if (hits.length >= this.MAX_PER_WINDOW) return true;
    hits.push(now);
    this.recent.set(key, hits);
    // Keep the map from growing forever on a long-running process.
    if (this.recent.size > 5000) {
      for (const [k, v] of this.recent) {
        if (!v.some(t => now - t < this.WINDOW_MS)) this.recent.delete(k);
      }
    }
    return false;
  }

  /**
   * Validate a submission.
   * Returns { ok, error } or { ok: true, value }.
   */
  validate(body) {
    // The honeypot. A real person never sees this field, so anything in it is a
    // bot. Accepted and discarded rather than rejected, so it learns nothing.
    if (clean(body.website, 200)) return { ok: true, spam: true, value: null };

    const name = clean(body.name, MAX.name);
    const email = clean(body.email, MAX.email);
    const subject = clean(body.subject, MAX.subject);
    const message = clean(body.message, MAX.message);

    if (!name) return { ok: false, error: 'Please add your name.' };
    if (!isEmail(email)) return { ok: false, error: 'That email address does not look right.' };
    if (!subject) return { ok: false, error: 'Please add a subject.' };
    if (message.length < 2) return { ok: false, error: 'Please write a message.' };

    return { ok: true, spam: false, value: { name, email, subject, message } };
  }

  async save(value, req) {
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' +
      crypto.randomBytes(4).toString('hex');
    const record = {
      id,
      created: new Date().toISOString(),
      name: value.name,
      email: value.email,
      subject: value.subject,
      message: value.message,
      read_at: '',
      // Not the address, just enough to spot a flood from one source.
      source: this._who(req || { headers: {}, socket: {} }),
    };
    await fsp.writeFile(path.join(this.DIR, id + '.json'),
      JSON.stringify(record, null, 2) + '\n');
    return record;
  }

  async list(limit) {
    let files = [];
    try { files = (await fsp.readdir(this.DIR)).filter(f => f.endsWith('.json')); }
    catch { return []; }
    files.sort().reverse();
    const out = [];
    for (const f of files.slice(0, limit || 300)) {
      try { out.push(JSON.parse(await fsp.readFile(path.join(this.DIR, f), 'utf8'))); }
      catch { /* skip a damaged record rather than fail the whole list */ }
    }
    return out;
  }

  async unreadCount() {
    return (await this.list(500)).filter(m => !m.read_at).length;
  }

  async markRead(id, read) {
    if (!/^[\w.-]+$/.test(String(id))) return null;
    const file = path.join(this.DIR, id + '.json');
    let rec;
    try { rec = JSON.parse(await fsp.readFile(file, 'utf8')); }
    catch { return null; }
    rec.read_at = read ? new Date().toISOString() : '';
    await fsp.writeFile(file, JSON.stringify(rec, null, 2) + '\n');
    return rec;
  }

  async remove(id) {
    if (!/^[\w.-]+$/.test(String(id))) return false;
    try { await fsp.unlink(path.join(this.DIR, id + '.json')); return true; }
    catch { return false; }
  }

  /* ------------------------------------------------------------ the list -- */

  async subscribers() {
    try { return JSON.parse(await fsp.readFile(this.SUBS, 'utf8')); }
    catch { return { list: [] }; }
  }

  /**
   * Add someone to the list. Idempotent: signing up twice is not an error and
   * does not create a duplicate, because people do it.
   */
  async subscribe(body) {
    if (clean(body.website, 200)) return { ok: true, spam: true };
    const email = clean(body.email, MAX.email).toLowerCase();
    const name = clean(body.name, MAX.name);
    if (!isEmail(email)) return { ok: false, error: 'That email address does not look right.' };

    const data = await this.subscribers();
    const found = data.list.filter(s => s.email === email)[0];
    if (found) {
      if (name && !found.name) found.name = name;
      found.unsubscribed_at = '';
      await fsp.writeFile(this.SUBS, JSON.stringify(data, null, 2) + '\n');
      return { ok: true, already: true };
    }
    data.list.push({ email, name, joined: new Date().toISOString(), unsubscribed_at: '' });
    await fsp.writeFile(this.SUBS, JSON.stringify(data, null, 2) + '\n');
    return { ok: true, already: false };
  }

  /** The list as CSV, because every mailing tool imports CSV. */
  async subscribersCsv() {
    const data = await this.subscribers();
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['email', 'name', 'joined'].map(esc).join(',')];
    for (const s of data.list) {
      if (s.unsubscribed_at) continue;
      rows.push([s.email, s.name, s.joined].map(esc).join(','));
    }
    return rows.join('\r\n') + '\r\n';
  }
}

module.exports = { Inbox, isEmail };
