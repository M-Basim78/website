/**
 * Tests for the parts of the store that would cost real money if wrong.
 *   node cms/store.test.js
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Store, toCents, verifySignature } = require('./store.js');

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

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
};

const sign = (body, secret, t) => {
  t = t || Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(t + '.' + body, 'utf8').digest('hex');
  return 't=' + t + ',v1=' + v1;
};

console.log('\nwebhook signature');
{
  const secret = 'whsec_test_' + 'x'.repeat(24);
  const body = JSON.stringify({ id: 'cs_test_123', type: 'checkout.session.completed' });

  ok('valid signature accepted', verifySignature(body, sign(body, secret), secret));

  ok('tampered body rejected',
    !verifySignature(body.replace('cs_test_123', 'cs_test_evil'), sign(body, secret), secret));

  ok('wrong secret rejected', !verifySignature(body, sign(body, 'whsec_other'), secret));

  ok('replay of an old payload rejected',
    !verifySignature(body, sign(body, secret, Math.floor(Date.now() / 1000) - 3600), secret));

  ok('missing header rejected', !verifySignature(body, '', secret));
  ok('missing secret rejected', !verifySignature(body, sign(body, secret), ''));
  ok('garbage header rejected', !verifySignature(body, 'not-a-signature', secret));
}

console.log('\nprice is decided by the server, never the browser');
{
  const store = new Store({
    contentDir: path.resolve(__dirname, '..', 'content'),
    origin: 'https://medpsycmoss.com',
  });

  const mock = store.find('p_3313250');
  ok('mock interview found', !!mock);
  ok('mock interview is 12500 cents', mock && store.quote(mock, '').amount === 12500,
    mock ? 'got ' + store.quote(mock, '').amount : '');

  const editing = store.find('p_3291607');
  ok('editing base is 10000 cents', editing && store.quote(editing, '').amount === 10000);
  ok('editing with 2 edits is 15000 cents',
    editing && store.quote(editing, 'two').amount === 15000,
    editing ? 'got ' + JSON.stringify(store.quote(editing, 'two')) : '');
  ok('unknown option is refused', editing && store.quote(editing, 'free_please') === null);

  ok('unknown product is not found', store.find('p_does_not_exist') === null);

  // Every product must produce a chargeable amount and a known fulfilment route.
  // 'email' is the old spelling of 'send-draft' and is still honoured by the
  // order page, so an order taken before the rename still reads correctly.
  const kinds = ['download', 'booking', 'email-file', 'send-draft', 'email'];
  let allPriced = true, allRouted = true, allFiles = true;
  for (const p of store.products().list) {
    if (toCents(p.price) === null || toCents(p.price) <= 0) { allPriced = false; console.log('     unpriced: ' + p.id); }
    if (kinds.indexOf(p.fulfilment) < 0) { allRouted = false; console.log('     bad fulfilment: ' + p.id); }
    // A product that promises a download must have the file on disk. Getting
    // this wrong takes the customer's money and shows them a dead link, which
    // is exactly what happened to the accommodations workbook.
    if (p.file && !fs.existsSync(path.join(__dirname, '..', 'content', 'products', p.file))) {
      allFiles = false; console.log('     missing file: ' + p.id + ' -> ' + p.file);
    }
    if (p.fulfilment === 'download' && !p.file) {
      allFiles = false; console.log('     download with no file: ' + p.id);
    }
  }
  ok('every product has a valid price', allPriced);
  ok('every product has a known fulfilment route', allRouted);
  ok('every promised file is on disk', allFiles);
}

console.log('\nthe fulfilment queue knows what she still has to do');
{
  const store = new Store({
    contentDir: path.resolve(__dirname, '..', 'content'),
    origin: 'https://medpsycmoss.com',
  });
  const live = { token: 'x'.repeat(32), max_downloads: 8,
                 expires: new Date(Date.now() + 864e5).toISOString() };
  const order = (pid, ful, extra) => Object.assign({
    id: 'cs_x', product_id: pid, fulfilment: ful, downloads: 0, token: '',
  }, extra || {});

  // She emails the accommodations workbook by hand, so it must appear.
  const t1 = store.todoFor(order('p_3380308', 'email-file'));
  ok('an email-file order needs her', !!t1 && t1.kind === 'send-file');
  ok('and it is marked urgent', !!t1 && t1.urgent === true);

  // A booking with no calendar link means she promised to be in touch.
  const t2 = store.todoFor(order('p_3370950', 'booking'));
  ok('a booking with no link needs her', !!t2 && t2.kind === 'send-calendar');

  // A plain download fulfils itself and must NOT clutter the queue.
  const t3 = store.todoFor(order('p_3291868', 'download', live));
  ok('a working download needs nothing', t3 === null);

  // ...unless the file has gone missing, which is the one she must know about.
  const t4 = store.todoFor(order('p_no_such_product', 'download', live));
  ok('a download with no file needs her', !!t4 && t4.kind === 'file-missing');

  // Editing waits on the customer. Worth showing, but not something to chase.
  const t5 = store.todoFor(order('p_3291607', 'send-draft'));
  ok('editing waits on the customer', !!t5 && t5.kind === 'await-draft');
  ok('and is not marked urgent', !!t5 && t5.urgent === false);

  // Ticking it off takes it out of the queue, whatever kind it was.
  ok('a fulfilled order leaves the queue',
    store.todoFor(order('p_3380308', 'email-file',
      { fulfilled_at: '2026-08-26T00:00:00Z' })) === null);

  // The old spelling still routes, so orders taken before the rename read right.
  ok('the old "email" spelling still queues', !!store.todoFor(order('p_3291607', 'email')));
}

console.log('\nfile serving cannot escape the products folder');
{
  const store = new Store({
    contentDir: path.resolve(__dirname, '..', 'content'),
    origin: 'https://medpsycmoss.com',
  });
  const evil = store.fileFor({ product_id: 'p_3380308' });
  // The product's own file is absent until she exports it, which is the expected state.
  ok('missing file returns null rather than throwing', evil === null || typeof evil === 'string');

  // A traversal attempt in the product record must not resolve outside FILES.
  const orig = store.find('p_3380308');
  if (orig) {
    const saved = orig.file;
    orig.file = '../../../../etc/passwd';
    const p = store.fileFor({ product_id: 'p_3380308' });
    ok('path traversal in the file field is neutralised', p === null);
    orig.file = saved;
  }
}

console.log('\n' + (fail ? 'FAILED' : 'ALL PASSED') + '  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
