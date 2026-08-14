import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });

await page.goto('http://localhost:8080/terminal', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);

// Go to crypto
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const crypto = btns.find(b => b.textContent?.trim() === 'CRYPTO');
  crypto?.click();
});
await page.waitForTimeout(4000);

const snap = async (label) => {
  const data = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('button')].filter(b => /BTC|ETH|SOL/.test(b.textContent || '') && /USDT/.test(b.textContent || ''));
    const prices = rows.slice(0, 4).map(r => r.textContent?.replace(/\s+/g, ' ').slice(0, 60));
    const body = document.body.innerText;
    const liveMatch = body.match(/LIVE|OFFLINE/);
    const headerIdx = body.indexOf('BTC/USDT');
    return { prices, live: liveMatch ? liveMatch[0] : '?', aroundBtc: body.slice(Math.max(0, headerIdx - 80), headerIdx + 120).replace(/\n/g, ' | ') };
  });
  console.log(`--- ${label} ---`);
  console.log('LIVE:', data.live);
  console.log('PRICES:', JSON.stringify(data.prices));
  console.log('ACTIVE:', data.aroundBtc);
};

await snap('crypto T+8s');
await page.waitForTimeout(10000);
await snap('crypto T+18s');
await page.waitForTimeout(15000);
await snap('crypto T+33s');

console.log('--- ERRORS (uniq, first 12) ---');
console.log([...new Set(errs)].slice(0, 12).join('\n'));
await browser.close();
