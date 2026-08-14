import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:8080/terminal', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);

const read = async (label) => {
  const d = await page.evaluate(() => {
    const footer = document.querySelector('footer');
    if (!footer) return { err: 'no footer' };
    const spans = [...footer.querySelectorAll('span')];
    const tickSpan = spans.find(s => /^TICK/.test(s.textContent || ''));
    const dots = spans.filter(s => s.textContent?.trim() === '●');
    const mesh = [...document.querySelectorAll('footer span[title]')].filter(s => s.textContent?.trim() === '●').map(s => ({ p: s.getAttribute('title'), c: getComputedStyle(s).color }));
    return {
      tick: tickSpan ? tickSpan.textContent : 'MISSING',
      tickColor: tickSpan ? getComputedStyle(tickSpan).color : '',
      liveDots: mesh.filter(m => m.c !== 'rgb(51, 65, 85)').map(m => m.p),
      dotCount: mesh.length,
    };
  });
  console.log(label, JSON.stringify(d));
};

for (let i = 0; i < 4; i++) { await read(`T+${5 + i * 6}s`); await page.waitForTimeout(6000); }
await browser.close();
