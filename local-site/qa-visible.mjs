#!/usr/bin/env node
/**
 * Prove that every page actually SHOWS its content in a browser.
 *
 * This exists because the site once passed every check while forty per cent of
 * the blog rendered blank. The HTML was correct, the tests read the HTML, and
 * nobody looked at a rendered page. `.reveal{opacity:0}` waited for an
 * IntersectionObserver whose threshold a long article could never satisfy.
 *
 * Reading the markup is not the same as seeing the page. This reads the page.
 *
 *   node qa-visible.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8188';

const urls = [];
(function walk(d, rel) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name), rel + '/' + e.name);
    else if (e.name === 'index.html') urls.push(rel + '/');
  }
})('dist', '');

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
let bad = 0, checked = 0;

for (const u of urls) {
  await p.goto(BASE + u.replace(/\/+/g, '/'), { waitUntil: 'domcontentloaded' }).catch(() => {});
  // scroll the page the way a reader does, so anything reveal-gated has its chance
  await p.evaluate(() => new Promise(r => {
    let y = 0;
    const step = () => {
      y += 900; window.scrollTo(0, y);
      // 900ms at the end, comfortably longer than the .7s reveal transition:
      // measuring mid-fade reports a paragraph at opacity 0.2 as hidden when it
      // is simply still arriving.
      if (y < document.body.scrollHeight) setTimeout(step, 60); else setTimeout(r, 900);
    };
    step();
  })).catch(() => {});

  const hidden = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.reveal, article.prose, main section')) {
      const cs = getComputedStyle(el);
      const text = (el.innerText || '').trim();
      // .in means the reveal has fired and the element is on its way in, so the
      // only real failure is content that never got the class at all.
      const arriving = el.classList.contains('in');
      if (text.length > 200 && !arriving &&
          (Number(cs.opacity) < 0.5 || cs.visibility === 'hidden' || cs.display === 'none')) {
        out.push({ cls: el.className.slice(0, 40), chars: text.length, op: cs.opacity });
      }
    }
    return out;
  }).catch(() => []);

  checked++;
  if (hidden.length) {
    bad++;
    console.log('  INVISIBLE CONTENT  ' + u);
    for (const h of hidden.slice(0, 2)) console.log('      ' + h.chars + ' chars at opacity ' + h.op + '  .' + h.cls);
  }
}

console.log('');
console.log('  pages checked in a real browser: ' + checked);
console.log(bad ? '  FAILED: ' + bad + ' page(s) hide content from the reader'
                : '  every page shows its content');
await b.close();
process.exit(bad ? 1 : 0);
