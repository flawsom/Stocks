import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:8080/terminal', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);
for (let i = 0; i < 6; i++) {
  const d = await page.evaluate(() => {
    const header = document.querySelector('header');
    const footer = document.querySelector('footer');
    return {
      headerFresh: [...header.querySelectorAll('span[title]')].filter(s => s.title.includes('heartbeat')).map(s => s.textContent?.trim()),
      footerText: footer.innerText.replace(/\n/g, ' | ').slice(0, 300),
    };
  });
  console.log(`T+${5 + i * 2}s header:`, JSON.stringify(d.headerFresh));
  console.log(`       footer:`, d.footerText);
  await page.waitForTimeout(2000);
}
await browser.close();
