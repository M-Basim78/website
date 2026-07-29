/**
 * Self-host the template's three Google fonts.  Loading them from
 * fonts.googleapis.com costs a render-blocking round trip to a third party;
 * serving the woff2 from our own origin is what gets LCP under the bar.
 * Latin only — the page has no other scripts.
 */
import fs from 'fs';
import path from 'path';

const OUT = path.resolve('rebuild', 'fonts');
fs.mkdirSync(OUT, { recursive: true });

// A modern UA is required or the API hands back legacy ttf instead of woff2.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const FAMILIES = [
  'Bricolage+Grotesque:opsz,wght@12..96,300..800',
  'Inter:wght@400..600',
  'JetBrains+Mono:wght@400..600',
];

const url = `https://fonts.googleapis.com/css2?${FAMILIES.map(f => 'family=' + f).join('&')}&display=swap`;
let css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();

// Keep the latin block only; the latin-ext / vietnamese / cyrillic subsets are dead weight here.
const blocks = css.split('@font-face').slice(1).map(b => '@font-face' + b);
const latin = blocks.filter(b => {
  const r = b.match(/unicode-range:\s*([^;]+);/);
  return !r || r[1].includes('U+0000-00FF');   // the latin subset always starts here
});

let out = '';
for (const b of latin) {
  const m = b.match(/src:\s*url\(([^)]+)\)/);
  if (!m) continue;
  const family = (b.match(/font-family:\s*'([^']+)'/) || [, 'font'])[1];
  const weight = (b.match(/font-weight:\s*([^;]+);/) || [, '400'])[1].trim().replace(/\s+/g, '-');
  const name = `${family.toLowerCase().replace(/\s+/g, '-')}-${weight}.woff2`;
  const buf = Buffer.from(await (await fetch(m[1], { headers: { 'User-Agent': UA } })).arrayBuffer());
  fs.writeFileSync(path.join(OUT, name), buf);
  out += b.replace(m[1], `/new/fonts/${name}`).replace(/unicode-range:[^;]+;\s*/, '') + '\n';
  console.log(`${name.padEnd(38)} ${(buf.length / 1024).toFixed(1)}KB`);
}

fs.writeFileSync(path.join(OUT, 'fonts.css'), out.trim() + '\n');
console.log(`\nwrote fonts.css (${latin.length} faces)`);
