// Production live-data probe — confirms the deployed terminal receives real-time data.
// Crypto trades 24/7, so watch the BTC watchlist price plus the footer TICK clock
// and mesh status — movement/freshness in any of these proves live streaming.
// Run: node scripts/probe-live-data.mjs
import { chromium } from "playwright";

const BASE = "https://stocks.unifies.codes/terminal";
let fails = 0;
const check = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); if (!c) fails++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrs = [];
page.on("pageerror", e => pageErrs.push(String(e).slice(0, 160)));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(12000); // let WS connect + first quotes land

// Snapshot helper: BTC row text (watchlist), footer text
const snap = async () => page.evaluate(() => {
  const txt = document.body.innerText;
  const btc = txt.match(/BTC[^\n]*/)?.[0] || "";
  const eth = txt.match(/ETH[^\n]*/)?.[0] || "";
  const footer = document.querySelector("footer")?.innerText || "";
  return { btc, eth, footer: footer.slice(0, 400) };
});

const a = await snap();
await page.waitForTimeout(15000);
const b = await snap();

console.log("BTC before:", JSON.stringify(a.btc));
console.log("BTC after :", JSON.stringify(b.btc));
console.log("footer    :", JSON.stringify(b.footer.slice(0, 160)));

const priceOf = s => s.match(/\d[\d,]*\.\d+/)?.[0];
const p1 = priceOf(a.btc), p2 = priceOf(b.btc);
check("BTC price moves (24/7 market)", !!p1 && !!p2 && p1 !== p2, `${p1} → ${p2}`);
check("footer TICK clock fresh", /TICK\s*\d+(\.\d+)?s/.test(b.footer), b.footer.match(/TICK[^·]*/)?.[0]);
check("footer mesh shows live sources", /FASTEST|LIVE|●/i.test(b.footer), (b.footer.match(/FASTEST[^\n]*/)?.[0] || "").slice(0, 80));

// Switch to crypto market tab explicitly to double-check the active chart symbol streams
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll("button, [role=tab]")];
  const crypto = tabs.find(t => /crypto/i.test(t.textContent || ""));
  if (crypto) crypto.click();
});
await page.waitForTimeout(8000);
const c = await snap();
console.log("crypto BTC:", JSON.stringify(c.btc));
const p3 = priceOf(c.btc);
check("crypto BTC renders a live price", !!p3 && parseFloat(p3.replace(/,/g, "")) > 1000, p3 || "none");

check("no uncaught page errors", pageErrs.length === 0, pageErrs.join(" | ").slice(0, 200));

console.log(fails === 0 ? "\nLIVE-DATA PROBE PASSED ✅" : `\n${fails} CHECK(S) FAILED`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
