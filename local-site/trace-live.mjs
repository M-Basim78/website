// Same trace, but against the real site, to see what the widget API really does.
import { chromium } from 'playwright';

const target = process.argv[2] || '/blog';
const browser = await chromium.launch({
  });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

page.on('response', async r => {
  const u = r.url();
  if (u.includes('/services/') || u.includes('/appmarket/')) {
    console.log(`  <-  ${r.status()} ${r.request().method()} ${u}`);
    console.log(`      ct: ${r.headers()['content-type']}`);
    try { console.log(`      ${(await r.text()).slice(0, 300)}`); } catch {}
  }
});

await page.goto(`https://medpsycmoss.com${target}`, { waitUntil: 'networkidle', timeout: 90000 }).catch(e => console.log('nav:', e.message.split('\n')[0]));
await page.waitForTimeout(3000);
const bodyText = await page.locator('body').innerText();
console.log('\nbody text length:', bodyText.length);
console.log('contains "Applying into Residency":', bodyText.includes('Applying into Residency'));
console.log('contains "FEATURED POSTS":', /featured posts/i.test(bodyText));
await page.screenshot({ path: process.argv[3] || 'live.png', fullPage: true });
await browser.close();
