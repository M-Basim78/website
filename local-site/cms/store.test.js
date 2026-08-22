/**
 * Tests for the parts of the store that would cost real money if wrong.
 *   node cms/store.test.js
 */
const crypto = require('crypto');
const path = require('path');
const { Store, toCents, verifySignature } = require('./store.js');

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
  const kinds = ['download', 'booking', 'email'];
  let allPriced = true, allRouted = true;
  for (const p of store.products().list) {
    if (toCents(p.price) === null || toCents(p.price) <= 0) { allPriced = false; console.log('     unpriced: ' + p.id); }
    if (kinds.indexOf(p.fulfilment) < 0) { allRouted = false; console.log('     bad fulfilment: ' + p.id); }
  }
  ok('every product has a valid price', allPriced);
  ok('every product has a known fulfilment route', allRouted);
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
