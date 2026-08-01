/**
 * Swap the teal design system for her brand palette: maroon, navy, light pink,
 * white.  Every mapping is explicit; anything teal left behind is reported as a
 * failure rather than silently surviving.
 */
import fs from 'fs';

const FILE = process.argv[2] || 'rebuild/index.html';
let css = fs.readFileSync(FILE, 'utf8');

const NEW_TOKENS = `  :root{
    /* ---- brand palette: maroon, navy, light pink, white ----
       every pair below was checked for WCAG AA on its intended background,
       see contrast.mjs. No teal anywhere in this system. */
    --base:#FFFFFF;
    --tint:#FBF1F4;          /* light pink, section backgrounds */
    --tint-deep:#F7E8EC;     /* light pink, cards and the patient panel */
    --navy-tint:#EFF1F7;     /* the doctor panel */
    --ink:#1B2A4A;           /* navy, body copy and the hero type */
    --muted:#55607D;         /* navy grey, secondary copy */
    --primary:#6E1F35;       /* deep maroon, buttons, links, headings accent */
    --primary-hi:#8C2A45;    /* hover */
    --accent:#A63A57;        /* ECG trace, vital dots, quote marks */
    --chip:#F3C6D2;          /* pill background */
    --chip-ink:#4A1424;      /* text on a pill */
    --on-dark:#F7D9E2;       /* pink text on the dark panels */
    --dark-a:#4A1526;        /* dark panel gradient start, maroon */
    --dark-b:#1B2A4A;        /* dark panel gradient end, navy */
    --line:rgba(27,42,74,0.14);
    --line-soft:rgba(27,42,74,0.08);
    --shadow:rgba(27,42,74,0.30);

    /* legacy aliases, so every component rule keeps working unchanged */
    --bg:var(--base);
    --bg-2:var(--tint);
    --card:var(--base);
    --pulse:var(--accent);
    --pulse-ink:var(--primary);
    --pulse-dim:rgba(166,58,87,0.10);
    --blue:var(--ink);
    --blue-ink:var(--ink);
    --coral:var(--accent);
    --coral-ink:var(--primary);

    --display:'Bricolage Grotesque',system-ui,sans-serif;
    --body:'Inter',system-ui,-apple-system,sans-serif;
    --mono:'JetBrains Mono',ui-monospace,monospace;
    /* dock box: 21px icon + 5 gap + 17 label + 8 link padding + 20 dock padding + 2 border */
    --dock-h:73px;
    --dock-gap:12px;
  }`;

// replace the whole :root block
css = css.replace(/ {2}:root\{[\s\S]*?\n {2}\}/, NEW_TOKENS);

const MAP = [
  // hero surfaces
  ['linear-gradient(180deg,#FFFFFF,#F6FAFB)', 'linear-gradient(180deg,#FFFFFF,var(--tint))'],
  ['radial-gradient(55% 40% at 88% 8%,rgba(46,111,163,0.08),transparent 70%)',
   'radial-gradient(55% 40% at 88% 8%,rgba(27,42,74,0.09),transparent 70%)'],
  ['radial-gradient(45% 35% at 8% 90%,rgba(13,168,140,0.08),transparent 70%)',
   'radial-gradient(45% 35% at 8% 90%,rgba(166,58,87,0.11),transparent 70%)'],
  ['-webkit-text-stroke:1.5px rgba(16,41,58,0.55)', '-webkit-text-stroke:1.5px rgba(27,42,74,0.55)'],

  // ECG
  ['stroke:rgba(13,168,140,0.1)', 'stroke:rgba(110,31,53,0.12)'],
  ['stroke:rgba(13,168,140,0.18)', 'stroke:rgba(166,58,87,0.22)'],

  // buttons
  ['background:#066352', 'background:var(--primary-hi)'],
  ['box-shadow:0 12px 26px -14px rgba(8,122,102,0.6)', 'box-shadow:0 12px 26px -14px rgba(110,31,53,0.55)'],

  // tiles
  ['border-color:rgba(13,168,140,0.5)', 'border-color:rgba(166,58,87,0.45)'],
  ['linear-gradient(150deg,#0B4F45,#10293A 80%)', 'linear-gradient(150deg,var(--dark-a),var(--dark-b) 80%)'],
  ['.tile.feature .cta{color:#7FE8D2}', '.tile.feature .cta{color:var(--on-dark)}'],
  ['radial-gradient(circle,rgba(127,232,210,0.3),transparent 70%)',
   'radial-gradient(circle,rgba(243,198,210,0.34),transparent 70%)'],
  ['linear-gradient(150deg,#EBF3FA,#FFFFFF 75%)', 'linear-gradient(150deg,var(--navy-tint),#FFFFFF 75%)'],
  ['border-color:rgba(46,111,163,0.25)', 'border-color:rgba(27,42,74,0.22)'],
  ['color:#04352C;background:#7FE8D2', 'color:var(--chip-ink);background:var(--chip)'],

  // duality panels
  ['.half.pt{background:#FCF2EF}', '.half.pt{background:var(--tint-deep)}'],
  ['.half.dr{background:#EEF8F5}', '.half.dr{background:var(--navy-tint)}'],

  // podcast
  ['border-color:rgba(46,111,163,0.45)', 'border-color:rgba(110,31,53,0.40)'],

  // subscribe band
  ['linear-gradient(140deg,#0B4F45,#123A5C)', 'linear-gradient(140deg,var(--dark-a),var(--dark-b))'],
  ['.sub-box .vital{color:#7FE8D2}', '.sub-box .vital{color:var(--on-dark)}'],
  ['.sub-box .vital::before{background:#7FE8D2}', '.sub-box .vital::before{background:var(--chip)}'],
  ['.sub-box h2 .hl{color:#7FE8D2}', '.sub-box h2 .hl{color:var(--on-dark)}'],
  ['background:#fff;color:#0B4F45;border-color:#fff', 'background:#fff;color:var(--primary);border-color:#fff'],
  ['.sub-box .btn:hover{background:#E8F6F2;box-shadow:none}', '.sub-box .btn:hover{background:var(--tint-deep);box-shadow:none}'],
  ['color:#7FE8D2;', 'color:var(--on-dark);'],

  // free list pill
  ['color:#04352C;background:#7FE8D2;padding:6px 11px', 'color:var(--chip-ink);background:var(--chip);padding:6px 11px'],

  // shadows, navy rather than slate
  ['rgba(16,41,58,0.3)', 'rgba(27,42,74,0.30)'],
  ['rgba(16,41,58,0.35)', 'rgba(27,42,74,0.35)'],
  ['rgba(16,41,58,0.4)', 'rgba(27,42,74,0.40)'],
  ['rgba(16,41,58,0.45)', 'rgba(27,42,74,0.45)'],
  ['rgba(16,41,58,0.5)', 'rgba(27,42,74,0.50)'],

  // browser chrome
  ['content="#0DA88C"', 'content="#6E1F35"'],
];

let applied = 0, missed = [];
for (const [from, to] of MAP) {
  if (!css.includes(from)) { missed.push(from); continue; }
  css = css.split(from).join(to);
  applied++;
}

fs.writeFileSync(FILE, css);

console.log(`applied ${applied}/${MAP.length} mappings`);
if (missed.length) { console.log('NOT FOUND (check by hand):'); missed.forEach(m => console.log('   ' + m)); }

// nothing teal may survive
const TEAL = /#0DA88C|#087A66|#7FE8D2|#0B4F45|#066352|#04352C|#E8F6F2|#F3F8FA|#EEF8F5|#FCF2EF|#123A5C|#10293A|#2E6FA3|#255B87|#E2604B|#C2432E|#54687A|#EBF3FA|#F6FAFB|13,168,140|8,122,102|127,232,210|46,111,163|16,41,58/gi;
const left = css.match(TEAL);
console.log(`\nlegacy colour literals remaining: ${left ? left.length : 0}`);
if (left) console.log('   ' + [...new Set(left)].join(', '));
