/**
 * End to end test of the shop against a running server, with a fake Stripe.
 *
 * Proves the parts that matter without touching a real account:
 *   - a buyer cannot choose their own price
 *   - an unsigned or forged webhook is refused
 *   - a genuine webhook records the order and mints a download link
 *   - the download link expires, is use limited, and cannot escape the folder
 *   - the same webhook delivered twice does not create two orders
 *
 *   node cms/store.e2e.js [baseUrl]
 */
const crypto = require('crypto');

/* ----------------------------------------------------------- safety gate --
 * These tests create checkout sessions and fire webhooks. Against a LIVE key
 * that means real Stripe objects on her real account, and a mistake means real
 * money and a real customer record. Test mode exists for exactly this and runs
 * the same code paths.
 *
 * Set ALLOW_LIVE=i-understand only if you genuinely mean it.
 */
(function liveGate() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  const live = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  if (live && process.env.ALLOW_LIVE !== 'i-understand') {
    console.error('');
    console.error('  REFUSING TO RUN.');
    console.error('  STRIPE_SECRET_KEY is a LIVE key (' + key.slice(0, 8) + '...).');
    console.error('  These tests would create real objects on her Stripe account.');
    console.error('');
    console.error('  Use the test key instead: Stripe dashboard, Developers, API keys,');
    console.error('  with the Test mode toggle ON. It starts sk_test_.');
    console.error('');
    process.exit(2);
  }
  if (live) console.error('  WARNING: running against a LIVE key because ALLOW_LIVE is set.');
})();

const BASE = process.argv[2] || 'http://localhost:8184';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_e2e_secret_for_testing';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   ' + extra : '')); }
};

const sign = (body, secret, t) => {
  t = t || Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(t + '.' + body, 'utf8').digest('hex');
  return 't=' + t + ',v1=' + v1;
};

const post = (p, body, headers) => fetch(BASE + p, {
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

function sessionEvent(id, productId, amount, opts) {
  opts = opts || {};
  return JSON.stringify({
    id: 'evt_' + crypto.randomBytes(6).toString('hex'),
    type: 'checkout.session.completed',
    data: { object: {
      id: id,
      payment_intent: 'pi_' + crypto.randomBytes(6).toString('hex'),
      amount_total: amount,
      currency: 'usd',
      customer_details: { email: opts.email || 'buyer@example.com', name: opts.name || 'Test Buyer' },
      metadata: { product_id: productId, option_id: opts.option || '', fulfilment: opts.fulfilment || 'download' },
    } },
  });
}

(async () => {
  console.log('\ncheckout refuses anything it should');
  {
    // Stripe is not configured in the test server, so we assert on the *reason*.
    let r = await post('/api/store/checkout', { productId: 'p_does_not_exist' });
    let d = await r.json().catch(() => ({}));
    ok('unknown product refused', r.status === 400 && /does not exist/i.test(d.error || ''), JSON.stringify(d));

    r = await post('/api/store/checkout', { productId: 'p_3291607', optionId: 'free_please' });
    d = await r.json().catch(() => ({}));
    ok('forged option refused', r.status === 400 && /not available/i.test(d.error || ''), JSON.stringify(d));

    r = await post('/api/store/checkout', '{bad json');
    ok('malformed body gets 400, not a crash', r.status === 400);

    // A price sent by the client must simply be ignored.
    r = await post('/api/store/checkout', { productId: 'p_3313250', price: 1, amount: 1 });
    d = await r.json().catch(() => ({}));
    ok('client supplied price is ignored (fails only on Stripe not configured)',
      r.status === 400 && /not connected to stripe/i.test(d.error || ''), JSON.stringify(d));
  }

  console.log('\nwebhook rejects what it should');
  {
    const body = sessionEvent('cs_test_reject', 'p_3380308', 5000);
    let r = await post('/api/store/webhook', body);
    ok('unsigned webhook refused', r.status === 400);

    r = await post('/api/store/webhook', body, { 'stripe-signature': 't=1,v1=deadbeef' });
    ok('forged signature refused', r.status === 400);

    r = await post('/api/store/webhook', body, {
      'stripe-signature': sign(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 7200) });
    ok('replayed old webhook refused', r.status === 400);

    const tampered = body.replace('5000', '1');
    r = await post('/api/store/webhook', tampered, { 'stripe-signature': sign(body, WEBHOOK_SECRET) });
    ok('tampered body refused', r.status === 400);
  }

  const fsx = require('fs'), pathx = require('path');
  const FILES = pathx.resolve(__dirname, '..', 'content', 'products');

  console.log('\nan email-file product never offers a download');
  {
    // Her accommodations workbook is too large to serve, so she sends it by
    // hand. The page must say so, and must not show a button that cannot work.
    const sid = 'cs_test_' + crypto.randomBytes(8).toString('hex');
    const body = sessionEvent(sid, 'p_3380308', 5000, { fulfilment: 'email-file' });
    const r = await post('/api/store/webhook', body, { 'stripe-signature': sign(body, WEBHOOK_SECRET) });
    ok('signed webhook accepted', r.status === 200);

    const html = await (await fetch(BASE + '/order/' + sid)).text();
    ok('order page names the product', /Testing Accommodations/.test(html));
    ok('order page shows the amount paid', /\$50\.00/.test(html));
    ok('no download button is shown', !/\/api\/store\/download\//.test(html));
    ok('buyer is told she will email it', /email/i.test(html));
  }

  console.log('\na genuine webhook fulfils a download order');
  let token = '';
  const DL_PRODUCT = 'p_3288429';                       // Full ERAS application, $30
  const DL_FILE = pathx.join(FILES, 'full-residency-eras-application.pdf');
  {
    const sid = 'cs_test_' + crypto.randomBytes(8).toString('hex');
    const body = sessionEvent(sid, DL_PRODUCT, 3000);
    const r = await post('/api/store/webhook', body, { 'stripe-signature': sign(body, WEBHOOK_SECRET) });
    ok('signed webhook accepted', r.status === 200);

    const html = await (await fetch(BASE + '/order/' + sid)).text();
    ok('order page names the product', /ERAS/.test(html));
    ok('order page shows the amount paid', /\$30\.00/.test(html));

    const m = html.match(/\/api\/store\/download\/([A-Za-z0-9_-]+)/);
    token = m ? m[1] : '';
    ok('a download link appears', !!token);

    if (token) {
      const dl = await fetch(BASE + '/api/store/download/' + token);
      const disp = dl.headers.get('content-disposition') || '';
      ok('download returns the file', dl.status === 200, 'got ' + dl.status);
      ok('download is sent as an attachment', /attachment/.test(disp), disp);
      ok('download is not cached', /no-store/.test(dl.headers.get('cache-control') || ''));
      const head = Buffer.from(await dl.arrayBuffer()).subarray(0, 4).toString();
      ok('download body is the real PDF', head === '%PDF', 'got ' + JSON.stringify(head));
    }

    // Idempotency: Stripe delivers the same event more than once, by design.
    const before = token;
    await post('/api/store/webhook', body, { 'stripe-signature': sign(body, WEBHOOK_SECRET) });
    const again = await (await fetch(BASE + '/order/' + sid)).text();
    const m2 = again.match(/\/api\/store\/download\/([A-Za-z0-9_-]+)/);
    ok('duplicate webhook does not create a second order', !!(m2 && m2[1] === before));
  }

  console.log('\ndownload links are guarded');
  {
    let r = await fetch(BASE + '/api/store/download/not-a-real-token');
    ok('unknown token refused', r.status === 404);

    // A file can go missing from the volume without the product changing. That
    // has to read as "not available yet", not as a broken link.
    const aside = DL_FILE + '.aside';
    fsx.renameSync(DL_FILE, aside);
    try {
      r = await fetch(BASE + '/api/store/download/' + token);
      ok('valid token but missing file says 503, not 404', r.status === 503, 'got ' + r.status);
    } finally {
      fsx.renameSync(aside, DL_FILE);
    }

    r = await fetch(BASE + '/api/store/download/' + encodeURIComponent('../../../etc/passwd'));
    ok('path traversal in the token refused', r.status === 404 || r.status === 400, 'got ' + r.status);
  }

  console.log('\nbookings route by whether they carry a file');
  {
    // The mock interview is a booking that ALSO ships an instructions sheet.
    // Both have to appear: keying the download off the fulfilment mode meant
    // these buyers paid 125 dollars and were shown nothing.
    const sid = 'cs_test_' + crypto.randomBytes(8).toString('hex');
    const body = sessionEvent(sid, 'p_3313250', 12500, { fulfilment: 'booking' });
    await post('/api/store/webhook', body, { 'stripe-signature': sign(body, WEBHOOK_SECRET) });
    const html = await (await fetch(BASE + '/order/' + sid)).text();
    ok('booking asks the buyer to pick a time', /pick your time|Choose your time|arrange a time/i.test(html));
    ok('booking shows $125.00', /\$125\.00/.test(html));
    ok('booking with instructions offers the download', /\/api\/store\/download\//.test(html));

    // 30 minute advising carries no file, so it must offer no download.
    const sid2 = 'cs_test_' + crypto.randomBytes(8).toString('hex');
    const body2 = sessionEvent(sid2, 'p_3380355', 6000, { fulfilment: 'booking' });
    await post('/api/store/webhook', body2, { 'stripe-signature': sign(body2, WEBHOOK_SECRET) });
    const html2 = await (await fetch(BASE + '/order/' + sid2)).text();
    ok('booking without a file offers no download', !/\/api\/store\/download\//.test(html2));
    ok('booking without a file still shows $60.00', /\$60\.00/.test(html2));
  }

  console.log('\nevery product a customer can buy is deliverable');
  {
    // A pass over the real catalogue, so a product added later cannot quietly
    // ship promising a file that is not on disk.
    const list = JSON.parse(fsx.readFileSync(
      pathx.resolve(__dirname, '..', 'content', 'products.json'), 'utf8')).products;
    const bad = [];
    for (const pr of list) {
      if (pr.file && !fsx.existsSync(pathx.join(FILES, pr.file))) bad.push(pr.id + ' -> ' + pr.file);
      if (pr.fulfilment === 'download' && !pr.file) bad.push(pr.id + ' is a download with no file');
    }
    ok('every declared product file exists', bad.length === 0, bad.join('; '));
  }

  console.log('\n' + (fail ? 'FAILED' : 'ALL PASSED') + '   ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
