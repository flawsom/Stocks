// Analyst-chat E2E probe — real Chromium, verifies the 24/7 reasoning journal:
//   1. The CHAT tab exists and opens.
//   2. The journal boots with the ANALYST ONLINE system message.
//   3. The LIVE 24/7 badge and uptime counter render.
//   4. Asking "why" produces a narration message.
//   Run: bun run scripts/probe-analyst.mjs
import { createServer } from "vite";
import { chromium } from "playwright";

const PORT = 8092;
const server = await createServer({ server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const BASE = `http://localhost:${PORT}`;

let fails = 0;
const pass = (n, x = "") => console.log(`PASS  ${n}${x ? " — " + x : ""}`);
const fail = (n, x = "") => { fails++; console.log(`FAIL  ${n}${x ? " — " + x : ""}`); };
const check = (n, c, x = "") => c ? pass(n, x) : fail(n, x);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrs = [];
page.on("pageerror", e => pageErrs.push(String(e).slice(0, 200)));

await page.goto(BASE + "/terminal", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(6000);

// 1. CHAT tab exists and opens
const chatTab = await page.evaluate(() => {
  const el = [...document.querySelectorAll("button")].find(b => b.textContent?.toUpperCase().includes("CHAT"));
  if (el) { el.click(); return true; }
  return false;
});
check("CHAT tab exists and opens", chatTab);
await page.waitForTimeout(2000);

// 2. Journal booted
const body = await page.evaluate(() => document.body.innerText);
check("ANALYST ONLINE system message rendered", body.includes("ANALYST ONLINE"));
check("LIVE 24/7 badge rendered", /LIVE 24\/7/.test(body));
check("uptime counter running", /\d{2}:\d{2}/.test(body));

// 3. Ask a question and verify a response appears
const before = await page.evaluate(() => document.body.innerText.match(/WHAT I CAN DO|NO SIGNAL YET|FORECAST|MARKET PULSE|SYSTEM STATUS/g)?.length ?? 0);
await page.evaluate(() => {
  const input = [...document.querySelectorAll("input")].find(i => i.placeholder?.includes("Ask"));
  if (input) {
    // React-controlled input: set the value through the native prototype
    // setter, otherwise React state never sees the change.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "how");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(b => b.textContent?.includes("Ask"));
  btn?.click();
});
await page.waitForTimeout(1500);
const after = await page.evaluate(() => document.body.innerText.match(/HOW THE MACHINE WORKS/g)?.length ?? 0);
check("asking 'how' returns the pipeline narration", after > 0);

// 4. No crashes
check("no uncaught page errors", pageErrs.length === 0, pageErrs[0] ?? "");
void before;

await browser.close();
await server.close();
console.log(fails === 0 ? "\nANALYST CHAT E2E PASSED ✅" : `\n${fails} ANALYST CHAT CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
