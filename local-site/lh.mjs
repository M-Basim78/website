// Lighthouse mobile run against the rebuilt homepage.
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import fs from 'fs';
import path from 'path';

const URL = process.argv[2] || 'http://localhost:8123/new';
const OUT = process.argv[3] || 'lh-report';
fs.mkdirSync(OUT, { recursive: true });

// Use whichever chromium Playwright installed on this machine, falling back to
// chrome-launcher's own discovery. Pinning an absolute build path meant these
// tools only ran on the machine they were written on.
import { chromium } from 'playwright';

let chromePath;
try { chromePath = chromium.executablePath(); } catch { chromePath = undefined; }

const chrome = await launch({
  ...(chromePath ? { chromePath } : {}),
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
});

const runnerResult = await lighthouse(URL, {
  port: chrome.port,
  output: ['html', 'json'],
  logLevel: 'error',
  formFactor: 'mobile',
  screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
  onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
});

const lhr = runnerResult.lhr;
fs.writeFileSync(path.join(OUT, 'report.html'), runnerResult.report[0]);
fs.writeFileSync(path.join(OUT, 'report.json'), runnerResult.report[1]);

console.log(`\n  ${URL}\n`);
for (const [k, c] of Object.entries(lhr.categories)) {
  const s = Math.round(c.score * 100);
  console.log(`  ${(s >= 90 ? 'PASS' : 'FAIL')}  ${String(s).padStart(3)}  ${c.title}`);
}

const m = lhr.audits;
console.log('\n  metrics');
for (const id of ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']) {
  if (m[id]) console.log(`    ${id.padEnd(26)} ${m[id].displayValue}`);
}

console.log('\n  failing / flagged audits');
const bad = Object.values(m).filter(a =>
  a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable');
if (!bad.length) console.log('    (none)');
for (const a of bad.sort((x, y) => x.score - y.score)) {
  console.log(`    [${a.score.toFixed(2)}] ${a.id} — ${a.title}`);
  const raw = a.details?.items;
  const items = Array.isArray(raw) ? raw.slice(0, 4) : [];
  for (const it of items) {
    const label = it.node?.snippet || it.url || it.source?.url || it.label || JSON.stringify(it).slice(0, 110);
    console.log(`         · ${String(label).replace(/\s+/g, ' ').slice(0, 130)}`);
  }
}

await chrome.kill();
