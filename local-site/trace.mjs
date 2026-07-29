// Log every request/console message for one page, to see what the site's JS does.
import { chromium } from 'playwright';

const target = process.argv[2] || '/blog';
const browser = await chromium.launch({
  executablePath: String.raw`C:\Users\Basim\AppData\Local\ms-playwright\chromium-1187\chrome-win\chrome.exe`,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

page.on('console', m => console.log(`  console[${m.type()}] ${m.text().slice(0, 300)}`));
page.on('pageerror', e => console.log(`  pageerror ${String(e).slice(0, 300)}`));
page.on('request', r => {
  if (r.resourceType() === 'xhr' || r.resourceType() === 'fetch') {
    console.log(`  ->  ${r.method()} ${r.url().slice(0, 200)}`);
    const d = r.postData();
    if (d) console.log(`      body: ${d.slice(0, 600)}`);
  }
});
page.on('response', async r => {
  if (['xhr', 'fetch'].includes(r.request().resourceType()) || r.status() >= 400) {
    console.log(`  <-  ${r.status()} ${r.url().slice(0, 200)}`);
    if (r.url().includes('localhost')) {
      try { console.log(`      resp: ${(await r.text()).slice(0, 600)}`); } catch {}
    }
  }
});

await page.goto(`http://localhost:8123${target}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.log('nav:', e.message.split('\n')[0]));
await page.waitForTimeout(3000);
console.log('\n--- blog post nodes:', await page.locator('.blog-post, [class*=blog-post], article').count());
await browser.close();
