#!/usr/bin/env node
/**
 * "The Patient-Doctor tab should be the one linked to the patient resources
 *  with links to associated blog posts."
 *
 * The nav now points Patient&Doctor at /resources. This adds her own writing to
 * each patient library, so a reader who lands on Endometriosis Resources also
 * sees the posts she has written about endometriosis.
 *
 * Injected before the "Educational content only" band, and idempotent: an
 * existing block is replaced rather than appended to.
 */

import fs from 'node:fs';
import path from 'node:path';
import { assign, decode } from './guides-taxonomy.mjs';

const R = path.resolve('rebuild');
const MARK_OPEN = '<!-- related-posts:start -->';
const MARK_CLOSE = '<!-- related-posts:end -->';

const esc = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// decode first, so an entity in the source is not escaped twice on output
const tidy = s => decode(String(s || '')).replace(/\s+[—–]\s+/g, ', ').replace(/[—–]/g, '-')
  .replace(/\s+/g, ' ').trim();
const trim = (s, n) => { s = tidy(s); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '...'; };

/** library slug -> her tag, plus a keyword fallback where she has no tag. */
const LIBRARIES = {
  'trauma-resources':        { tags: [], any: /\btrauma/i, name: 'trauma' },
  'websites-for-trauma':     { tags: [], any: /\btrauma/i, name: 'trauma' },
  'mental-health-resources': { tags: ['mental health'], any: /\bmental health|depress|anxiet|suicid/i, name: 'mental health' },
  'sexual-health-resources': { tags: ['sexual health'], any: /\bsexual health|\bsex\b/i, name: 'sexual health' },
  'pelvic-pain-resources':   { tags: ['pelvic pain'], any: /\bpelvic pain|vulvodynia|vaginismus/i, name: 'pelvic pain' },
  'endometriosis-resources': { tags: ['endometriosis'], any: /\bendometrios/i, name: 'endometriosis' },
  'infertility-resources':   { tags: ['infertility'], any: /\binfertil|\bivf\b|fertility preservation/i, name: 'infertility' },
  'menopause-resources':     { tags: [], any: /\bmenopaus/i, name: 'menopause' },
  'disabilities-resources':  { tags: ['disability'], any: /\bdisabilit|accommodat/i, name: 'disability' },
  'lqbtqia-resources':       { tags: ['lgbtqia'], any: /\blgbtq|transgender|gender-affirming/i, name: 'LGBTQIA health' },
};

const { posts } = assign();

const count = (re, s) => {
  const m = s.match(new RegExp(re.source, re.flags.replace('g', '') + 'g'));
  return m ? m.length : 0;
};

let touched = 0, skipped = 0;
const report = [];

for (const [slug, rule] of Object.entries(LIBRARIES)) {
  const file = path.join(R, slug + '.html');
  if (!fs.existsSync(file)) { skipped++; continue; }

  const matches = posts.filter(p => {
    if (rule.tags.some(t => p.tags.includes(t))) return true;
    if (rule.any && rule.any.test(p.head)) return true;
    return rule.any ? count(rule.any, p.text) >= 3 : false;
  }).sort((a, b) => a.title.localeCompare(b.title)).slice(0, 12);

  let html = fs.readFileSync(file, 'utf8');
  // drop any previous injection first, so this stays idempotent
  html = html.replace(new RegExp(MARK_OPEN + '[\\s\\S]*?' + MARK_CLOSE + '\\s*'), '');

  if (matches.length < 2) {
    fs.writeFileSync(file, html);
    report.push([slug, matches.length, 'skipped, too few']);
    continue;
  }

  // cat/t/d inside one span: .fr is a two column flex, content then tag.
  const rows = matches.map(p => `        <a class="fr" href="${esc(p.url)}">
          <span><span class="cat">HER WRITING</span><span class="t">${esc(trim(p.title, 110))}</span><span class="d">${esc(trim(p.desc || '', 150))}</span></span>
          <span class="tagm">READ</span>
        </a>`).join('\n');

  const block = `${MARK_OPEN}
<section id="her-writing" aria-labelledby="writing-title">
  <div class="wrap">
    <div class="head reveal">
      <span class="vital">From the blog</span>
      <h2 id="writing-title">Her writing on ${esc(rule.name)}</h2>
      <p>Stephanie has written about this from both sides of the chart. These posts are free to read.</p>
    </div>
    <div class="free-list reveal">
${rows}
    </div>
  </div>
</section>
${MARK_CLOSE}

`;

  // sits above the education note, which should stay last
  const note = html.indexOf('<section aria-labelledby="note-title">');
  if (note >= 0) {
    html = html.slice(0, note) + block + html.slice(note);
  } else {
    html = html.replace('</main>', block + '</main>');
  }

  fs.writeFileSync(file, html);
  touched++;
  report.push([slug, matches.length, 'added']);
}

console.log('patient libraries updated : ' + touched);
if (skipped) console.log('missing pages            : ' + skipped);
console.log();
for (const [slug, n, what] of report) {
  console.log('   ' + slug.padEnd(26) + String(n).padStart(3) + ' posts   ' + what);
}
