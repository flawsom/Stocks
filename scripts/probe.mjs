import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));
page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url().slice(0, 120) + ' -> ' + (r.failure()?.errorText || '')));

await page.goto('http://localhost:8080/terminal', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(8000);

const snap = async (label) => {
  const data = await page.evaluate(() => {
    const lines = document.body.innerText.split('\n').filter(l => l.trim());
    return { head: lines.slice(0, 10).join(' | ').slice(0, 600), hasLive: document.body.innerText.includes('LIVE') };
  });
  console.log(`--- ${label} ---`);
  console.log(data.head);
  console.log('HAS_LIVE:', data.hasLive);
};

await snap('T+8s');
await page.waitForTimeout(12000);
await snap('T+20s');
await page.waitForTimeout(15000);
await snap('T+35s');

console.log('--- CONSOLE ERRORS (' + errors.length + ') ---');
console.log([...new Set(errors)].slice(0, 25).join('\n'));

await browser.close();
