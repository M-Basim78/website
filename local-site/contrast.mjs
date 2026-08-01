// WCAG contrast checker for the maroon / navy / pink palette.
const hex = (h) => h.replace('#', '').match(/../g).map(x => parseInt(x, 16));
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const P = {
  base:        '#FFFFFF',
  tint:        '#FBF1F4',   // light pink section background
  tintDeep:    '#F7E8EC',   // light pink cards / patient panel
  navyTint:    '#EFF1F7',   // doctor panel
  ink:         '#1B2A4A',   // navy, body + hero type
  muted:       '#55607D',   // navy-grey secondary text
  primary:     '#6E1F35',   // deep maroon, buttons + links
  primaryHi:   '#8C2A45',   // hover / brighter maroon
  accent:      '#A63A57',   // ECG trace, vital dots
  pinkChip:    '#F3C6D2',   // chip background
  chipInk:     '#4A1424',   // text on pink chip
  onDark:      '#F7D9E2',   // pink text on the dark maroon/navy panels
  darkA:       '#4A1526',   // feature tile gradient start (maroon)
  darkB:       '#1B2A4A',   // feature tile gradient end (navy)
};

const PAIRS = [
  ['ink', 'base'], ['ink', 'tint'], ['ink', 'tintDeep'], ['ink', 'navyTint'],
  ['muted', 'base'], ['muted', 'tint'], ['muted', 'tintDeep'], ['muted', 'navyTint'],
  ['primary', 'base'], ['primary', 'tint'], ['primary', 'tintDeep'],
  ['primaryHi', 'base'], ['accent', 'base'],
  ['chipInk', 'pinkChip'],
  ['base', 'primary'], ['base', 'darkA'], ['base', 'darkB'],
  ['onDark', 'darkA'], ['onDark', 'darkB'],
];

console.log('pair                              ratio   AA-normal  AA-large');
let fails = 0;
for (const [fg, bg] of PAIRS) {
  const r = ratio(P[fg], P[bg]);
  const aa = r >= 4.5, aaL = r >= 3;
  if (!aa) fails++;
  console.log(
    `${(fg + ' on ' + bg).padEnd(32)} ${r.toFixed(2).padStart(6)}   ${(aa ? 'PASS' : 'fail').padEnd(9)} ${aaL ? 'PASS' : 'fail'}`
  );
}
console.log(`\nnormal-text failures: ${fails}`);
console.log('\ntokens:'); for (const [k, v] of Object.entries(P)) console.log(`  --${k}: ${v}`);
