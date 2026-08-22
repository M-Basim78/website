#!/usr/bin/env node
/**
 * Regenerate the store grid from content/products.json.
 *
 * build-products.mjs could only update tiles it already found by id, so a
 * product she stopped selling stayed on the page and a new one never appeared.
 * The live store had moved on and ours had not: two delisted products were still
 * advertised and two real ones were missing.
 *
 * This rewrites the whole grid, so the file is the only place a product exists.
 *
 * Also repoints every remaining Gator checkout href at our own store, since
 * checkout now happens here.
 */

import fs from 'node:fs';
import path from 'node:path';

const R = path.resolve('rebuild');
const products = JSON.parse(fs.readFileSync(path.resolve('content', 'products.json'), 'utf8')).products;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The bento sizes, in the order the layout expects.
const SIZES = ['feature', 't2', 't3', 'blue t4', 't5', 't6'];

const cover = (p) => p.cover
  ? `        <span class="cover"><img src="/new/img/${esc(p.cover)}.webp"
               srcset="/new/img/${esc(p.cover)}-300.webp 300w, /new/img/${esc(p.cover)}.webp 450w"
               sizes="(min-width:780px) 140px, 120px" width="450" height="583"
               loading="lazy" decoding="async" alt="Cover of ${esc(p.name)}."></span>\n`
  : '';

function tile(p, i) {
  const size = SIZES[i] || 't6';
  const hasOptions = !!(p.options && p.options.choices && p.options.choices.length);
  // A product with a choice to make cannot go straight to checkout, so its tile
  // jumps to the picker below the grid instead.
  const href = hasOptions ? '#choose-' + esc(p.id) : '/store';
  const buy = hasOptions ? '' : ` data-buy="${esc(p.id)}"`;

  return `      <a class="tile ${size}${p.chip ? ' has-chip' : ''}"${buy} href="${href}">
        <span class="spark" aria-hidden="true"></span>
${p.chip ? `        <span class="chip">${esc(p.chip)}</span>\n` : ''}        <span class="num"><span>${esc(p.price)}</span><span class="cat">${esc(p.category)}</span></span>
${cover(p)}        <h3>${esc(p.name)}</h3>
        <p>${esc(p.description)}</p>
        <span class="cta">${esc(p.cta)}</span>
      </a>`;
}

/** The option picker for any product that has choices. */
function chooser(p) {
  const base = p.price;
  const opts = p.options.choices.map(c =>
    `            <option value="${esc(c.id)}">${esc(c.label)}${
      c.add && c.add !== '$0.00' ? ' (+' + esc(c.add) + ')' : ''}</option>`).join('\n');

  return `
<section id="choose-${esc(p.id)}" aria-labelledby="choose-title-${esc(p.id)}">
  <div class="wrap">
    <div class="tint-band" data-product>
      <div class="head">
        <span class="vital">${esc(p.category)}</span>
        <h2 id="choose-title-${esc(p.id)}">${esc(p.name)}</h2>
        <p>${esc(p.description)}</p>
      </div>
      <div class="choose">
        <label for="opt-${esc(p.id)}">${esc(p.options.label)}</label>
        <select id="opt-${esc(p.id)}" data-option>
${opts}
        </select>
        <a class="btn" data-buy="${esc(p.id)}" href="/store">${esc(p.cta)} &middot; from ${esc(base)}</a>
      </div>
    </div>
  </div>
</section>
`;
}

// ---------------------------------------------------------------- store grid
const storeFile = path.join(R, 'store.html');
let html = fs.readFileSync(storeFile, 'utf8');

const open = html.indexOf('<div class="bento reveal">');
if (open < 0) { console.error('could not find the product grid in store.html'); process.exit(1); }
// The grid ends at the first line that closes it at the same indentation.
const close = html.indexOf('\n    </div>', open);
if (close < 0) { console.error('could not find the end of the product grid'); process.exit(1); }

const grid = '<div class="bento reveal">\n' + products.map(tile).join('\n\n') + '\n';
html = html.slice(0, open) + grid + html.slice(close + 1);

// Put any option pickers after the grid's section.
const withOptions = products.filter(p => p.options && p.options.choices);
if (withOptions.length) {
  const marker = '<!-- product-choosers -->';
  html = html.replace(new RegExp(marker + '[\\s\\S]*?' + marker + '\\s*'), '');
  const anchorEnd = html.indexOf('</section>', html.indexOf('<div class="bento reveal">'));
  const block = marker + '\n' + withOptions.map(chooser).join('\n') + marker + '\n';
  html = html.slice(0, anchorEnd + 10) + '\n\n' + block + html.slice(anchorEnd + 10);
}

fs.writeFileSync(storeFile, html);
console.log('store grid rebuilt: ' + products.length + ' products, ' +
  withOptions.length + ' with an option picker');

// ------------------------------------------- repoint every Gator checkout URL
let repointed = 0, filesTouched = 0;
for (const f of fs.readdirSync(R).filter(x => x.endsWith('.html'))) {
  const fp = path.join(R, f);
  const before = fs.readFileSync(fp, 'utf8');
  // Checkout happens on this site now; the old absolute Gator links must go.
  const after = before.replace(/https:\/\/medpsycmoss\.com\/store\/p_[0-9]+\/[^"']*/g, () => {
    repointed++;
    return '/store';
  });
  if (after !== before) { fs.writeFileSync(fp, after); filesTouched++; }
}
console.log('gator checkout links repointed: ' + repointed + ' across ' + filesTouched + ' files');
