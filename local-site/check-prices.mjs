#!/usr/bin/env node
/**
 * Assert that every price shown on the built store page is the price checkout
 * would actually charge.
 *
 * This exists because the two came apart once already. The tile updater keyed on
 * an attribute the shop rewrite had removed, so a price edit changed what Stripe
 * charged while the page went on advertising the old figure. Silent, and the
 * kind of thing a customer discovers at the moment they are billed.
 *
 * It also catches the markup corruption that followed: her prices start "$1",
 * and in a string replacement "$1" means backreference to group 1, so "$135.00"
 * spliced the matched markup back in and left "35.00" behind.
 *
 *   node check-prices.mjs
 */
import fs from 'node:fs';

const { products } = JSON.parse(fs.readFileSync('content/products.json', 'utf8'));
const html = fs.readFileSync('dist/store/index.html', 'utf8');

let bad = 0;

for (const p of products) {
  const hasOptions = !!(p.options && p.options.choices && p.options.choices.length);
  let shown;

  if (hasOptions) {
    // Its tile jumps to a picker, so the price sits on the picker's button as
    // "from $X", and each option carries its own surcharge.
    const sec = html.match(new RegExp('id="choose-' + p.id + '"[\\s\\S]*?</section>'));
    const body = sec ? sec[0] : '';
    const btn = body.match(/from (\$[0-9,]+\.[0-9]{2})/);
    shown = btn ? btn[1] : '(no price on the picker)';

    for (const c of p.options.choices) {
      if (!c.add || c.add === '$0.00') continue;
      if (body.indexOf('+' + c.add) < 0) {
        bad++;
        console.log('  FAIL  ' + p.id + '  option "' + c.label + '" is missing its +' + c.add);
      }
    }
  } else {
    const tile = html.match(
      new RegExp('data-buy="' + p.id + '"[\\s\\S]{0,900}?<span class="num"><span>([^<]*)<'));
    shown = tile ? tile[1].trim() : '(not found on the page)';
  }

  const ok = shown === p.price;
  if (!ok) bad++;
  console.log('  ' + (ok ? 'OK  ' : 'FAIL') + '  ' + p.id.padEnd(11) +
    'page: ' + shown.padEnd(22) + 'charges: ' + p.price + (hasOptions ? '   (+options)' : ''));
}

if (/<span class="num"><span><span class="num">/.test(html)) {
  bad++;
  console.log('  FAIL  nested .num spans: a price replacement corrupted the markup');
}

console.log('');
console.log(bad
  ? '  FAILED: ' + bad + ' problem' + (bad === 1 ? '' : 's')
  : '  every displayed price matches what Stripe would charge');
process.exit(bad ? 1 : 0);
