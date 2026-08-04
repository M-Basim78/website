// Measure the hyphen-stripping damage described in reports/next-steps.md 2a.
import fs from 'fs';
import path from 'path';

const d = 'rebuild';
let labels = 0, hyph = 0, merge = 0, rawUrl = 0;
const samples = [];

for (const f of fs.readdirSync(d).filter(x => x.endsWith('.html'))) {
  const c = fs.readFileSync(path.join(d, f), 'utf8');
  for (const m of c.matchAll(/<span class="t">([^<]{3,160})<\/span>/g)) {
    const t = m[1].trim();
    labels++;
    if (t.includes('-')) hyph++;
    if (/[a-z][A-Z]/.test(t)) { merge++; if (samples.length < 8) samples.push(`${f}: ${t}`); }
    if (/^www\.|^https?:/.test(t)) rawUrl++;
  }
}
console.log(`link labels: ${labels}   with hyphen: ${hyph}   lower-to-upper merge: ${merge}   raw urls: ${rawUrl}`);
samples.forEach(s => console.log('   ' + s));
