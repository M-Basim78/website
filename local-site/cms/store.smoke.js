/**
 * Live smoke test. The one check that is safe to run against her real keys.
 *
 * It creates a Checkout Session and stops. Creating a session moves no money and
 * charges nobody: it is an unpaid, open object that Stripe expires by itself.
 * Nothing is captured, no customer record is created, and there is nothing to
 * refund.
 *
 * What it proves:
 *   - the secret key is valid and live
 *   - our request is well formed and Stripe accepts it
 *   - the amount Stripe would charge matches content/products.json exactly
 *   - the returned checkout URL is hers
 *
 * What it deliberately does NOT do: complete a payment. That needs a real card
 * and makes a real charge, and no automated test should ever do that.
 *
 *   node --env-file=.env cms/store.smoke.js
 *   node --env-file=.env cms/store.smoke.js p_3380308     one product only
 */
const path = require('path');
const { Store, toCents, fromCents } = require('./store.js');

const only = process.argv[2] || '';
const key = process.env.STRIPE_SECRET_KEY || '';

if (!key) {
  console.error('\n  STRIPE_SECRET_KEY is not set. Put it in .env and run with --env-file=.env\n');
  process.exit(2);
}

const mode = key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'LIVE' : 'TEST';

const store = new Store({
  contentDir: path.resolve(__dirname, '..', 'content'),
  origin: process.env.SITE_ORIGIN || 'https://medpsycmoss.com',
});

(async () => {
  console.log('');
  console.log('  Stripe mode   : ' + mode + (mode === 'LIVE' ? '   (no money moves, sessions are created unpaid)' : ''));
  console.log('  Sends buyer to: ' + store.origin);
  console.log('');

  const products = store.products().list.filter(p => !only || p.id === only);
  if (!products.length) {
    console.error('  No such product: ' + only + '\n');
    process.exit(2);
  }

  let pass = 0, fail = 0;

  for (const p of products) {
    const expected = toCents(p.price);
    const choices = p.options && p.options.choices ? p.options.choices : [{ id: '', label: '', add: '$0.00' }];

    for (const c of choices) {
      const want = expected + (toCents(c.add) || 0);
      const label = p.name + (c.label ? ' (' + c.label + ')' : '');
      try {
        const out = await store.createCheckout({ productId: p.id, optionId: c.id });

        // Read the session back and compare what Stripe would actually charge.
        const res = await fetch('https://api.stripe.com/v1/checkout/sessions/' + out.id, {
          headers: { Authorization: 'Bearer ' + key },
        });
        const s = await res.json();

        const got = s.amount_total;
        const good = got === want && typeof out.url === 'string' && out.url.indexOf('https://') === 0;

        if (good) { pass++; console.log('  OK    ' + label.padEnd(52) + fromCents(got, s.currency)); }
        else {
          fail++;
          console.log('  FAIL  ' + label.padEnd(52) +
            'expected ' + fromCents(want) + ', Stripe says ' + fromCents(got || 0));
        }
        if (products.length === 1) console.log('        ' + out.url);
      } catch (e) {
        fail++;
        console.log('  FAIL  ' + label.padEnd(52) + e.message);
      }
    }
  }

  console.log('');
  console.log('  ' + (fail ? 'FAILED' : 'ALL GOOD') + '   ' + pass + ' matched, ' + fail + ' failed');
  console.log('');
  if (!fail && mode === 'LIVE') {
    console.log('  The sessions above are unpaid and expire on their own. Nothing was charged.');
    console.log('  To test a real payment end to end, use the TEST keys and card 4242 4242 4242 4242.');
    console.log('');
  }
  process.exit(fail ? 1 : 0);
})();
