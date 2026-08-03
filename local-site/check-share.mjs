// Verify the shareable file is genuinely self-contained and renders identically.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const FILE = path.resolve('share', 'medpsycmoss-homepage.html');
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ });

for (const [label, url] of [['file', pathToFileURL(FILE).href], ['served', 'http://localhost:8123/new']]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const network = [], errors = [];
  p.on('request', r => { if (!/^(data|file|blob):/.test(r.url()) && !r.url().startsWith('http://localhost:8123')) network.push(r.url()); });
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push(e.message));

  await p.goto(url, { waitUntil: 'load', timeout: 60000 });
  await p.evaluate(() => {
    document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
    document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; });
  });
  await p.evaluate(() => Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; }))));
  await p.waitForTimeout(600);

  const stats = await p.evaluate(() => ({
    height: document.body.scrollHeight,
    images: [...document.images].length,
    broken: [...document.images].filter(i => !i.naturalWidth).length,
    fonts: getComputedStyle(document.querySelector('h1')).fontFamily,
    links: document.querySelectorAll('a[href]').length,
  }));
  await p.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true });
  console.log(`${label.padEnd(7)} height ${stats.height}  imgs ${stats.images} (broken ${stats.broken})  links ${stats.links}`);
  console.log(`        external requests: ${network.length}${network.length ? ' -> ' + network.slice(0, 5).join(', ') : ''}`);
  console.log(`        console errors: ${errors.length}${errors.length ? ' -> ' + errors[0] : ''}`);
  await p.close();
}
await b.close();
