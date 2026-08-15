#!/usr/bin/env node
/**
 * One-off: turn HTML entities in content/ back into plain characters.
 *
 * The content was extracted from rendered HTML, so a few descriptions kept
 * "&amp;" as literal text. The build escapes on output, so that became
 * "&amp;amp;" and a reader saw "ERAS &amp; PS Guide". She would also have seen
 * the raw entity in the editor.
 *
 * content/ holds plain text. Escaping belongs to the build, once.
 */

import fs from 'node:fs';
import path from 'node:path';
import { decode } from './guides-taxonomy.mjs';

const C = path.resolve('content');
const targets = [];

for (const f of fs.readdirSync(path.join(C, 'blog'))) {
  if (f.endsWith('.md')) targets.push(path.join(C, 'blog', f));
}
for (const f of fs.readdirSync(C)) {
  if (f.endsWith('.json')) targets.push(path.join(C, f));
}

let changed = 0, total = 0;
for (const file of targets) {
  const before = fs.readFileSync(file, 'utf8');
  // JSON keeps its own escaping; only decode HTML entities, which are never
  // meaningful in either format.
  const after = decode(before);
  if (after === before) continue;

  const n = (before.match(/&(amp|lt|gt|quot|apos|nbsp|#\d+);/g) || []).length;
  total += n;
  changed++;
  fs.writeFileSync(file, after);
  console.log('  ' + path.relative(C, file).padEnd(60) + n + ' entities');
}

console.log(`\n${changed} file${changed === 1 ? '' : 's'} rewritten, ${total} entities decoded`);
