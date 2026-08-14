import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:8080/terminal', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);
const read = async (label) => {
  const d = await page.evaluate(() => {
    const els = [...document.querySelectorAll('span[title="Seconds since the last real market heartbeat"]')];
    return els.map(e => e.textContent?.trim());
  });
  console.log(label, JSON.stringify(d));
};
for (let i = 0; i < 4; i++) { await read(`T+${5 + i * 5}s`); await page.waitForTimeout(5000); }
await browser.close();
