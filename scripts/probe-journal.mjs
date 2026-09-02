// Prediction-journal E2E probe — real Chromium, verifies:
//   1. The PREDICTION LOG panel renders with the LIVE 24/7 badge.
//   2. The journal streams what/why/how entries from live data.
//   3. No uncaught page errors.
// Run: node scripts/probe-journal.mjs
import { createServer } from "vite";
import { chromium } from "playwright";

const PORT = 8093;
const server = await createServer({ server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const BASE = `http://localhost:${PORT}`;

let fails = 0;
const check = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); if (!c) fails++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrs = [];
page.on("pageerror", e => pageErrs.push(String(e).slice(0, 200)));

await page.goto(BASE + "/terminal", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(8000);

// 1. Panel renders
const body1 = await page.evaluate(() => document.body.innerText);
check("PREDICTION LOG panel rendered", body1.includes("PREDICTION LOG"));
check("LIVE 24/7 badge rendered", /LIVE 24\/7/.test(body1));

// 2. Journal streams entries (scan heartbeat fires within ~60s of first forecast)
let hasEntry = false;
let entrySample = "";
for (let i = 0; i < 14 && !hasEntry; i++) {
  await page.waitForTimeout(6000);
  const body = await page.evaluate(() => document.body.innerText);
  const m = body.match(/\[(SIGNAL|SCAN|VERDICT|LEARN|GUARD)\][^\n]*(\n[^\n]*why:[^\n]*)?/);
  if (m) { hasEntry = true; entrySample = m[0].slice(0, 240); }
}
check("journal streams what/why/how entries from live data", hasEntry, entrySample.replace(/\n/g, " | "));

// 3. No crashes
check("no uncaught page errors", pageErrs.length === 0, pageErrs[0] ?? "");

await browser.close();
await server.close();
console.log(fails === 0 ? "\nPREDICTION JOURNAL E2E PASSED ✅" : `\n${fails} JOURNAL CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
