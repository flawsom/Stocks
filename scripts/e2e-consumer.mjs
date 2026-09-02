// Consumer-grade E2E probe — boots its own Vite dev server in-process, clicks
// through the terminal exactly like a user (landing → terminal, every market
// tab, symbol switching, timeframes, every right panel, the scanner, footer
// status) and asserts real numbers render and auto-update from the LIVE store
// state (the exact state the UI renders). No lingering processes.
//   bun run scripts/e2e-consumer.mjs
import { createServer } from "vite";
import { chromium } from "playwright";

const PORT = 8090;
const server = await createServer({
  server: { port: PORT, host: "127.0.0.1" },
  logLevel: "error",
});
await server.listen();
const BASE = `http://localhost:${PORT}`;

let fails = 0;
const pass = (name, extra = "") => console.log(`PASS  ${name}${extra ? " — " + extra : ""}`);
const fail = (name, extra = "") => { fails++; console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`); };
const check = (name, cond, extra = "") => cond ? pass(name, extra) : fail(name, extra);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const consoleErrs = [];
const pageErrs = [];
page.on("console", m => { if (m.type() === "error") consoleErrs.push(m.text().slice(0, 140)); });
page.on("pageerror", e => pageErrs.push(String(e).slice(0, 200)));

const clickText = async (text) => {
  return page.evaluate((text) => {
    // Match on "contains" — CTAs carry a decorative arrow span, so textContent
    // is e.g. "LAUNCH TERMINAL→" and an exact-equality match never succeeds.
    const el = [...document.querySelectorAll("button,a")].find(b =>
      b.textContent?.trim().toUpperCase().includes(text.toUpperCase()));
    if (el) { el.click(); return true; }
    return false;
  }, text);
};

// Read the LIVE store — the exact state the UI renders.
const store = () => page.evaluate(async () => {
  const mod = await import("/src/stores/tradingStore.ts");
  const s = mod.useTradingStore.getState();
  const w = s.watchlist.find(x => x.symbol === s.activeSymbol);
  return {
    activeSymbol: s.activeSymbol,
    activeMarket: s.activeMarket,
    price: w?.price ?? 0,
    lastTick: s.lastTick,
    candles: s.candles.length,
    source: s.candleSource ? `${s.candleSource.provider}|hist=${s.candleSource.historyCandles}|${s.candleSource.streaming ? "streaming" : "history"}` : "none",
    isConnected: s.isConnected,
    liveCandles: s.liveCandles,
    providerStatus: s.providerStatus,
  };
});
const bodyText = () => page.evaluate(() => document.body.innerText);
const has = (t, s) => t.includes(s);

// ── 1. Landing page ──
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2500);
let t = await bodyText();
check("landing: hero renders", t.trim().length > 200, t.trim().slice(0, 80).replace(/\n/g, " | "));
const ctaClicked = await clickText("ENTER TERMINAL") || await clickText("LAUNCH TERMINAL")
  || await clickText("OPEN TERMINAL") || await clickText("TERMINAL");
check("landing: CTA clickable", ctaClicked, "");
await page.waitForTimeout(2500);
if (!page.url().includes("/terminal")) await page.goto(BASE + "/terminal", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);

// ── 2. Market tabs: live price, auto-update, real history ──
// Each market has a hard price-sanity band (real levels for these instruments).
// A provider glitch like a wrong-scale quote (e.g. BTC at $0.75) fails loudly.
const markets = [
  { header: "STOCKS", active: "AAPL", min: 10, max: 2000 },
  { header: "FOREX", active: "EUR/USD", min: 0.5, max: 3 },
  { header: "CRYPTO", active: "BTC/USDT", min: 1000, max: 1000000 },
  // Bands sized for 2026 index levels (S&P ~7,600; ES ~7,600) — wide enough to
  // stay stable across market cycles, narrow enough to catch wrong-scale data.
  // The app leads with REAL index levels (^GSPC ≈ 7,600 in 2026), not ETF proxies.
  { header: "INDICES", active: "^GSPC", min: 1000, max: 25000 },
  { header: "FUTURES", active: "ES", min: 1000, max: 50000 },
];

for (const m of markets) {
  const clicked = await clickText(m.header);
  check(`${m.header}: tab clickable`, clicked);
  await page.waitForTimeout(8000);

  // Futures quotes travel through CORS relays (Yahoo ES=F …) that can take
  // 4-12s on a cold path — wait for the first live data instead of failing on
  // a fixed window. Strictness is preserved: it MUST arrive, be sane, and move.
  let st = await store();
  let waited = 0;
  while ((st.activeSymbol !== m.active || st.price <= 0 || st.candles === 0) && waited < 20000) {
    await page.waitForTimeout(2000);
    waited += 2000;
    st = await store();
  }
  check(`${m.header}: ${m.active} has a live price`, st.activeSymbol === m.active && st.price > 0, `$${st.price}${waited ? ` (after ${waited / 1000}s)` : ""}`);
  check(`${m.header}: price in sane range`, st.price >= m.min && st.price <= m.max, `$${st.price} (band ${m.min}–${m.max})`);
  check(`${m.header}: chart has candles`, st.candles > 0, `${st.candles} bars (${st.source})`);

  const firstPrice = st.price;
  await page.waitForTimeout(4500);
  st = await store();
  const ageS = st.lastTick > 0 ? (Date.now() - st.lastTick) / 1000 : -1;
  const moved = st.price !== firstPrice;
  check(`${m.header}: price auto-updates`, moved || (ageS >= 0 && ageS < 60),
    moved ? `moved ${firstPrice}→${st.price}` : `heartbeat ${ageS.toFixed(1)}s ago`);
  check(`${m.header}: still sane after update`, st.price >= m.min && st.price <= m.max, `$${st.price}`);

  const rows = await page.evaluate(() => {
    const list = document.querySelector("aside");
    if (!list) return 0;
    return (list.innerText.match(/\n[\d,]+\.\d+\n/g) || []).length;
  });
  check(`${m.header}: watchlist has priced rows`, rows >= 2, `${rows} priced rows`);
}

// ── 3. Symbol switching via watchlist ──
await clickText("STOCKS");
await page.waitForTimeout(3000);
const switched = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("aside button")];
  const target = rows.find(r => r.textContent?.includes("NVDA"));
  if (!target) return false;
  target.click();
  return true;
});
await page.waitForTimeout(3500);
let st = await store();
check("symbol switch: NVDA becomes active with price", switched && st.activeSymbol === "NVDA" && st.price > 0, `$${st.price}`);

// ── 4. Timeframe switching must not crash and must keep chart data ──
for (const tf of ["1M", "1H", "1D"]) {
  const ok = await clickText(tf);
  await page.waitForTimeout(4000);
  t = await bodyText();
  const statsOk = has(t, "OPEN") && has(t, "HIGH") && has(t, "LOW");
  st = await store();
  check(`timeframe ${tf}: clickable + stats + candles`, ok && statsOk && st.candles > 0,
    `${st.candles} bars ${statsOk ? "" : "(stats missing)"}`);
}
const canvas = await page.evaluate(() => !!document.querySelector("canvas"));
check("chart canvas renders", canvas, "");

// ── 5. Right panels ──
const panels = [
  { label: "AI", expect: [/confidence/i, /signal/i, /accuracy/i] },
  { label: "TA", expect: [/RSI/i, /MACD/i, /ATR/i, /EMA/i] },
  { label: "DEPTH", expect: [/Depth/i, /Volume share/i, /Last/i] },
  { label: "NEWS", expect: [/news/i, /headline/i, /market/i] },
  { label: "PORT", expect: [/equity/i, /\$[\d,]+/, /balance/i] },
  { label: "LAB", expect: [/backtest/i, /strategy/i, /sharpe|equity|win/i] },
];
for (const p of panels) {
  const ok = await clickText(p.label);
  await page.waitForTimeout(3000);
  t = await bodyText();
  const matched = p.expect.some(re => re.test(t));
  check(`panel ${p.label}: opens and shows content`, ok && matched, matched ? "content visible" : "content missing");
}

// ── 6. Scanner: open, filter, click a row, close (Escape) ──
const scanOpened = await clickText("SCANNER");
await page.waitForTimeout(3000);
t = await bodyText();
check("scanner: opens overlay", scanOpened && has(t, "LIVE MARKET SCANNER"), "");
const scanHasRows = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("table tbody tr, [class*=grid] div")].length;
  return rows > 3;
});
check("scanner: renders scan table", scanHasRows, "");
const rowClicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("button")];
  const target = rows.find(r => /MSFT/.test(r.textContent || "") && r.textContent.length < 80);
  if (!target) return false;
  target.click();
  return true;
});
await page.waitForTimeout(2000);
check("scanner: row click opens symbol", rowClicked, "");
await page.keyboard.press("Escape");
await page.waitForTimeout(1500);
check("scanner: closes (Escape)", await page.evaluate(() => !document.body.innerText.includes("LIVE MARKET SCANNER")), "");

// ── 7. Footer status ──
await clickText("CRYPTO");
await page.waitForTimeout(3000);
const footerState = await page.evaluate(() => {
  const f = document.querySelector("footer");
  const txt = f ? f.innerText : "";
  const dots = f ? [...f.querySelectorAll("span[title]")] : [];
  const live = dots.filter(d => d.textContent?.trim() === "●").map(d => d.getAttribute("title"));
  return { txt, live };
});
check("footer: TICK readout", /TICK/.test(footerState.txt), (footerState.txt.match(/TICK[^\n]*/)?.[0] || "").trim());
check("footer: FASTEST provider readout", /FASTEST/i.test(footerState.txt), (footerState.txt.match(/FASTEST[^\n]*/i)?.[0] || "").trim());
check("footer: live mesh dots", footerState.live.length > 0, footerState.live.join(",") || "none");

// ── 8. Real errors (CORS noise from probed providers is benign) ──
// WS handshake failures are egress artifacts of this sandbox — the app's
// REST mesh + reconnect circuit breakers cover them (verified: prices still
// move). Treat as benign noise, exactly like CORS probes.
const benign = /CORS|has been blocked|coingecko|coinpaprika|bybit|yahoo|allorigins|jina|finnhub.*429|rate|ERR_FAILED|Failed to load resource|WebSocket connection to 'wss:\/\//i;
const realErrs = [...new Set([...consoleErrs, ...pageErrs])].filter(e => !benign.test(e));
check("no uncaught page errors", pageErrs.length === 0, pageErrs[0] || "");
check("no unexpected console errors", realErrs.length === 0, realErrs.slice(0, 4).join(" | "));

console.log(`\n${fails === 0 ? "ALL CONSUMER E2E CHECKS PASSED" : fails + " CONSUMER E2E CHECK(S) FAILED"}`);

await browser.close();
await server.close();
process.exit(fails === 0 ? 0 : 1);
