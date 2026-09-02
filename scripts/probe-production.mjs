// Production E2E probe — real Chromium against https://stock.unifies.codes/
// Verifies the consumer journey end-to-end on the deployed site:
//   1. Landing renders (hero + CTA)
//   2. Terminal boots from the landing CTA
//   3. Live data flows (prices tick, mesh status live)
//   4. PREDICTION LOG · LIVE 24/7 panel renders
//   5. No uncaught page errors
// Run: node scripts/probe-production.mjs
// DNS note: stock.unifies.codes currently round-robins between healthy GitHub
// Pages IPs (185.199.x.x) and unclaimed Vercel anycast IPs (SSL-dead). Pin the
// browser to the Pages IPs so the probe tests the app, not the DNS transition.
import { chromium } from "playwright";

const BASE = "https://stock.unifies.codes/";
let fails = 0;
const check = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); if (!c) fails++; };

const browser = await chromium.launch({
  args: ["--host-resolver-rules=MAP stock.unifies.codes 185.199.108.153"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrs = [];
page.on("pageerror", e => pageErrs.push(String(e).slice(0, 160)));

// Resilient goto: the domain can briefly fail SSL while Vercel setup completes
const goto = async (path) => {
  for (let i = 0; i < 4; i++) {
    try { await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 }); return true; }
    catch { await page.waitForTimeout(6000); }
  }
  return false;
};

// 1) Landing
check("landing loads", await goto(""));
await page.waitForTimeout(5000);
const land = await page.evaluate(() => document.body.innerText);
check("landing renders", land.length > 200);
check("landing has live market strip / hero", /ULTRA|OmegaTrade/i.test(land));

// 2) Terminal
await goto("terminal");
await page.waitForTimeout(10000);
const term = await page.evaluate(() => document.body.innerText);
check("terminal renders", /AAPL|BTC|Watchlist|PREDICTION LOG/i.test(term));
check("PREDICTION LOG panel present", term.includes("PREDICTION LOG"));
check("LIVE 24/7 badge present", /LIVE 24\/7/.test(term));

// 3) Live data: crypto price must render (24/7 market) + footer mesh fresh
const btcText = () => page.evaluate(() => { const m = document.body.innerText.match(/BTC\/USDT\s*\n?\s*([\d,]+\.\d+)/); return m ? m[1] : ""; });
let btc = "";
for (let i = 0; i < 6 && !btc; i++) { btc = await btcText(); if (!btc) await page.waitForTimeout(4000); }
check("crypto price renders (24/7 market)", !!btc && parseFloat(btc.replace(/,/g, "")) > 1000, btc || "no price rendered");
const footer = await page.evaluate(() => document.querySelector("footer")?.innerText || "");
check("footer mesh live (FASTEST latency)", /FASTEST/i.test(footer), footer.match(/FASTEST[^\n]*/)?.[0] || "");

// 4) Journal streams within the probe window (scan heartbeats fire ≤60s after a forecast)
let entry = "";
for (let i = 0; i < 12 && !entry; i++) {
  await page.waitForTimeout(6000);
  const body = await page.evaluate(() => document.body.innerText);
  const m = body.match(/\[(SIGNAL|SCAN|VERDICT|LEARN|GUARD)\][^\n]*/);
  if (m) entry = m[0].slice(0, 200);
}
check("journal streams on production", !!entry, entry);

// 5) Page errors
check("no uncaught page errors", pageErrs.length === 0, pageErrs.join(" | ").slice(0, 300));

console.log(fails === 0 ? "\nPRODUCTION E2E PASSED ✅" : `\n${fails} PRODUCTION CHECK(S) FAILED`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
