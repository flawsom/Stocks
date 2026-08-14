import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:8080/terminal', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'CRYPTO')?.click();
});
await page.waitForTimeout(4000);

const read = async (label) => {
  const d = await page.evaluate(() => {
    const body = document.body.innerText;
    const btcIdx = body.indexOf('BTC/USDT');
    const btc = body.slice(btcIdx, btcIdx + 32).replace(/\n/g, ' | ');
    const footer = body.slice(-700);
    const tick = footer.match(/TICK [^\n]*/)?.[0];
    const stats = body.match(/OPEN [\d.]+[\s\S]{0,40}HIGH [\d.]+/)?.[0];
    return { btc, tick, stats: stats ? stats.replace(/\s+/g, ' ') : 'n/a' };
  });
  console.log(label, JSON.stringify(d));
};

// The footer may be off-screen; also read the store's provider status from React props is not accessible,
// so read the mesh dots colors via the footer text positions.
for (let i = 0; i < 6; i++) {
  await read(`T+${8 + i * 4}s`);
  await page.waitForTimeout(4000);
}
await browser.close();
