import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:8080/terminal', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(6000);
for (let i = 0; i < 5; i++) {
  const d = await page.evaluate(async () => {
    const mod = await import('/src/stores/tradingStore.ts');
    const s = mod.useTradingStore.getState();
    const footerTick = [...document.querySelectorAll('footer span')].find(s => /^TICK/.test(s.textContent || ''))?.textContent;
    return { lastTick: s.lastTick, isConnected: s.isConnected, footerTick, activeSymbol: s.activeSymbol, btc: s.watchlist.find(w => w.symbol === 'BTC/USDT')?.price };
  });
  console.log(JSON.stringify(d));
  await page.waitForTimeout(2000);
}
await browser.close();
