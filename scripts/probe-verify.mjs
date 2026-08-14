import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });

await page.goto('http://localhost:8080/terminal', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);

// Switch to crypto
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find(b => b.textContent?.trim() === 'CRYPTO')?.click();
});
await page.waitForTimeout(4000);

const read = async () => page.evaluate(() => {
  const body = document.body.innerText;
  const btcIdx = body.indexOf('BTC/USDT');
  const active = body.slice(btcIdx, btcIdx + 40).replace(/\n/g, ' | ');
  const tickAge = body.match(/TICK [\d.]+s?/)?.[0] || body.match(/T —/)?.[0] || '?';
  const header = body.match(/T \d+(\.\d+)?s?/)?.[0] || '?';
  return { active, tickAge, header };
});

console.log('T+8s :', JSON.stringify(await read()));
await page.waitForTimeout(8000);
console.log('T+16s:', JSON.stringify(await read()));
await page.waitForTimeout(8000);
console.log('T+24s:', JSON.stringify(await read()));
await page.waitForTimeout(8000);
console.log('T+32s:', JSON.stringify(await read()));

const cryptoErrs = errs.filter(e => /coinbase|kraken|coingecko|okx/i.test(e));
console.log('--- crypto-related console errors:', cryptoErrs.length);
console.log([...new Set(cryptoErrs)].slice(0, 8).join('\n'));
console.log('--- total console errors:', errs.length);
await browser.close();
