// Assert no em/en dash survives in the rendered text of a page (file:// or http).
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const target = process.argv[2];
const url = /^https?:/.test(target) ? target : pathToFileURL(path.resolve(target)).href;

const b = await chromium.launch({ executablePath: String.raw`C:\Users\Basim\AppData\Local\ms-playwright\chromium-1187\chrome-win\chrome.exe` });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(url, { waitUntil: 'load' });
const hits = await p.evaluate(() => {
  const bad = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    if (!/[\u2013\u2014]/.test(n.nodeValue)) continue;
    if (n.parentElement.closest('script,style')) continue;
    bad.push(n.nodeValue.trim().slice(0, 90));
  }
  return bad;
});
// also check the metadata search engines and social cards show
const meta = await p.evaluate(() => [document.title,
  ...[...document.querySelectorAll('meta[name],meta[property]')].map(m => m.content || '')]
  .filter(v => /[\u2013\u2014]/.test(v)));

console.log(`${url}`);
console.log(`  rendered text dashes : ${hits.length}`);
hits.forEach(h => console.log('    ' + h));
console.log(`  title/meta dashes    : ${meta.length}`);
meta.forEach(m => console.log('    ' + m));
await b.close();
process.exit(hits.length + meta.length ? 1 : 0);
