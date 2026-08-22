/**
 * The store: Stripe Checkout, order records and fulfilment.
 *
 * Design notes, because they are load bearing:
 *
 * 1. NO DEPENDENCIES. The rest of this container has none, and adding the
 *    Stripe SDK would change that for one HTTP call. Stripe's REST API is
 *    form-encoded and its webhook signature is an HMAC, both of which Node does
 *    natively.
 *
 * 2. THE PRICE IS NEVER TAKEN FROM THE BROWSER. The client posts a product id;
 *    the amount is looked up here from content/products.json. Otherwise anyone
 *    could open devtools and buy a 125 dollar session for one dollar.
 *
 * 3. content/products.json IS THE SINGLE SOURCE OF TRUTH. She edits a price in
 *    the CMS and that is what Stripe charges. There is no second place to keep
 *    in step, which is the whole reason for leaving Gator.
 *
 * 4. FULFILMENT HAPPENS ON THE WEBHOOK, NOT THE REDIRECT. A customer can close
 *    the tab the moment they pay. Stripe calls us server to server and retries;
 *    the browser redirect is only a convenience.
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const API = 'https://api.stripe.com/v1';

/* ------------------------------------------------------------------ money -- */

/** "$1,250.00" -> 125000 cents. null if it is not a price. */
function toCents(s) {
  const m = String(s || '').replace(/[\s,]/g, '').match(/\$?(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * 100);
}

const fromCents = (c, cur) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: String(cur || 'usd').toUpperCase(),
  }).format((c || 0) / 100);

/* ------------------------------------------------- stripe form encoding ---- */

/**
 * Stripe takes application/x-www-form-urlencoded with bracketed nesting:
 *   line_items[0][price_data][unit_amount]=5000
 */
function formEncode(obj, prefix, out) {
  out = out || [];
  prefix = prefix || '';
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') formEncode(item, key + '[' + i + ']', out);
        else out.push(encodeURIComponent(key + '[' + i + ']') + '=' + encodeURIComponent(item));
      });
    } else if (v && typeof v === 'object') {
      formEncode(v, key, out);
    } else {
      out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
    }
  }
  return out.join('&');
}

async function stripe(secretKey, endpoint, body, idempotencyKey) {
  const headers = {
    Authorization: 'Bearer ' + secretKey,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(API + endpoint, {
    method: 'POST', headers, body: formEncode(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || 'Stripe returned ' + res.status;
    const err = new Error(msg);
    err.stripe = data.error;
    throw err;
  }
  return data;
}

/* ------------------------------------------------- webhook verification ---- */

/**
 * Verify Stripe's signature over the RAW body.
 *
 * Anyone can POST to a public webhook URL. Without this check a stranger could
 * claim a payment succeeded and be handed the paid files.
 */
function verifySignature(rawBody, header, secret, toleranceSec) {
  toleranceSec = toleranceSec || 300;
  if (!header || !secret) return false;

  const parts = {};
  for (const p of String(header).split(',')) {
    const i = p.indexOf('=');
    if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;

  // Reject a replay of an old but genuine payload.
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > toleranceSec) return false;

  const expected = crypto.createHmac('sha256', secret)
    .update(t + '.' + rawBody, 'utf8').digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ----------------------------------------------------------------- store --- */

class Store {
  constructor(opts) {
    this.CONTENT = opts.contentDir;
    this.origin = opts.origin;
    this.ORDERS = path.join(this.CONTENT, 'orders');
    this.FILES = path.join(this.CONTENT, 'products');   // the paid files live here
    fs.mkdirSync(this.ORDERS, { recursive: true });
    fs.mkdirSync(this.FILES, { recursive: true });
  }

  get secretKey() { return process.env.STRIPE_SECRET_KEY || ''; }
  get webhookSecret() { return process.env.STRIPE_WEBHOOK_SECRET || ''; }
  get configured() { return !!this.secretKey; }

  products() {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.CONTENT, 'products.json'), 'utf8'));
      return { currency: raw.currency || 'usd', list: raw.products || [] };
    } catch { return { currency: 'usd', list: [] }; }
  }

  find(id) {
    return this.products().list.filter(p => p.id === id)[0] || null;
  }

  /** Amount to charge, including any chosen option. null if the option is bogus. */
  quote(product, optionId) {
    const base = toCents(product.price);
    if (base === null) return null;
    let total = base;
    let optionLabel = '';
    if (product.options && optionId) {
      const choice = (product.options.choices || []).filter(c => c.id === optionId)[0];
      if (!choice) return null;                       // unknown option, refuse
      total += toCents(choice.add) || 0;
      optionLabel = choice.label;
    }
    return { amount: total, optionLabel };
  }

  // ---------------------------------------------------------------- checkout
  async createCheckout(opts) {
    // Validate the request before checking configuration, so a bad product id
    // reports itself instead of hiding behind "Stripe is not connected".
    const product = this.find(opts.productId);
    if (!product) throw new Error('That product does not exist.');

    const q = this.quote(product, opts.optionId);
    if (!q) throw new Error('That option is not available.');

    if (!this.configured) throw new Error('The store is not connected to Stripe yet.');

    const currency = this.products().currency;
    const name = q.optionLabel ? product.name + ' (' + q.optionLabel + ')' : product.name;

    const body = {
      mode: 'payment',
      success_url: this.origin + '/order/{CHECKOUT_SESSION_ID}',
      cancel_url: this.origin + '/store',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: currency,
          unit_amount: q.amount,
          product_data: {
            name: name,
            description: String(product.description || '').slice(0, 500),
          },
        },
      }],
      metadata: {
        product_id: product.id,
        option_id: opts.optionId || '',
        fulfilment: product.fulfilment || 'email',
      },
      payment_intent_data: { description: name },
    };
    if (opts.email) body.customer_email = opts.email;

    const session = await stripe(this.secretKey, '/checkout/sessions', body);
    return { url: session.url, id: session.id };
  }

  // ------------------------------------------------------------------ orders
  orderPath(sessionId) {
    const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '');
    return path.join(this.ORDERS, safe + '.json');
  }

  async getOrder(sessionId) {
    try { return JSON.parse(await fsp.readFile(this.orderPath(sessionId), 'utf8')); }
    catch { return null; }
  }

  async listOrders(limit) {
    limit = limit || 200;
    let files = [];
    try { files = (await fsp.readdir(this.ORDERS)).filter(f => f.endsWith('.json')); }
    catch { return []; }
    const out = [];
    for (const f of files) {
      try { out.push(JSON.parse(await fsp.readFile(path.join(this.ORDERS, f), 'utf8'))); }
      catch { /* skip a damaged record rather than fail the whole list */ }
    }
    out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
    return out.slice(0, limit);
  }

  /**
   * Record a completed checkout and prepare fulfilment.
   * Idempotent: Stripe delivers a webhook more than once by design.
   */
  async recordOrder(session) {
    const existing = await this.getOrder(session.id);
    if (existing) return existing;

    const meta = session.metadata || {};
    const product = this.find(meta.product_id);
    const fulfilment = meta.fulfilment || (product && product.fulfilment) || 'email';
    const details = session.customer_details || {};

    const order = {
      id: session.id,
      created: new Date().toISOString(),
      payment_intent: session.payment_intent || '',
      product_id: meta.product_id || '',
      product_name: product ? product.name : (meta.product_id || 'Unknown product'),
      option: meta.option_id || '',
      amount: session.amount_total,
      currency: session.currency || 'usd',
      email: details.email || session.customer_email || '',
      name: details.name || '',
      fulfilment: fulfilment,
      // Unguessable, expiring, and not shareable forever.
      token: fulfilment === 'download' ? crypto.randomBytes(24).toString('base64url') : '',
      downloads: 0,
      max_downloads: 8,
      expires: fulfilment === 'download'
        ? new Date(Date.now() + 30 * 864e5).toISOString() : '',
    };

    await fsp.writeFile(this.orderPath(session.id), JSON.stringify(order, null, 2) + '\n');
    return order;
  }

  /**
   * Find an order by its download token.
   *
   * A linear scan over the order files. At her volume that is a handful of
   * small reads; if the shop ever grows, this is the thing to index.
   */
  async orderByToken(token) {
    if (!token || !/^[A-Za-z0-9_-]{16,}$/.test(token)) return null;
    for (const o of await this.listOrders(2000)) {
      if (o.token && o.token.length === token.length &&
          crypto.timingSafeEqual(Buffer.from(o.token), Buffer.from(token))) return o;
    }
    return null;
  }

  async countDownload(order) {
    order.downloads = (order.downloads || 0) + 1;
    await fsp.writeFile(this.orderPath(order.id), JSON.stringify(order, null, 2) + '\n');
    return order;
  }

  /** The paid file for an order, or null if it is missing or escapes the folder. */
  fileFor(order) {
    const product = this.find(order.product_id);
    if (!product || !product.file) return null;
    const base = path.resolve(this.FILES);
    const p = path.resolve(base, path.basename(product.file));
    return p.startsWith(base) && fs.existsSync(p) ? p : null;
  }

  downloadState(order) {
    if (!order || order.fulfilment !== 'download') return 'n/a';
    if (order.expires && new Date(order.expires) < new Date()) return 'expired';
    if ((order.downloads || 0) >= (order.max_downloads || 8)) return 'exhausted';
    return this.fileFor(order) ? 'ready' : 'file-missing';
  }
}

module.exports = { Store, toCents, fromCents, verifySignature, formEncode, stripe };
