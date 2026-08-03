import { chromium } from 'playwright';
const W = Number(process.argv[2] || 1440);
const b = await chromium.launch({ });
const p = await b.newPage({ viewport: { width: W, height: 900 } });
await p.goto('http://localhost:8123/new', { waitUntil: 'domcontentloaded' });
console.log(`viewport ${W}px\n`);
console.log(await p.evaluate(() => {
  const rows = [];
  const add = (label, sel) => {
    const e = document.querySelector(sel);
    if (!e) return rows.push(`${label.padEnd(26)} MISSING`);
    const r = e.getBoundingClientRect();
    rows.push(`${label.padEnd(26)} left ${String(Math.round(r.left)).padStart(5)}  width ${String(Math.round(r.width)).padStart(5)}  right ${String(Math.round(window.innerWidth - r.right)).padStart(5)}`);
  };
  add('hero .wrap', '.hero .wrap');
  add('store .wrap', '#store .wrap');
  add('store bento', '.bento');
  add('duality .dual-grid', '.dual-grid');
  add('duality .half.pt', '.half.pt');
  add('dual-quote', '.dual-quote');
  add('pod-in (tinted band)', '.pod-in');
  add('dual-panel', '.dual-panel');
  rows.push(`section.pod background     ${getComputedStyle(document.querySelector('section.pod')).backgroundColor}`);
  add('free .wrap', '#free .wrap');
  add('sub-box', '.sub-box');
  return rows.join('\n');
}));
await b.close();
