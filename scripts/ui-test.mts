import { chromium, type Browser, type Page } from "playwright";

/* ────────────────────────────────────────────────────────────────
 * Full-app UI click-through suite (Playwright, headless Chromium).
 *
 * Loads the REAL app from the live preview and exercises every
 * button/link: landing CTAs, market tabs, timeframes, symbol search,
 * watchlist, right-panel tabs, scanner (open/sort/filter/row-click),
 * strategy lab (run backtest), paper ticket (buy/close), XAI toggle,
 * and verifies the data on screen is live and non-zero.
 * ──────────────────────────────────────────────────────────────── */

const BASE = process.env.UI_TEST_BASE || "http://localhost:8080";
const MS = (n: number) => n;

let failures = 0;
let passed = 0;
let consoleErrors: string[] = [];
let page: Page;

function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}${extra ? " — " + extra : ""}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
}

async function waitFor(fn: () => Promise<boolean> | boolean, name: string, timeout = 15000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await fn()) return true;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`  ⚠ timed out waiting for: ${name}`);
  return false;
}

async function pollValue<T>(fn: () => Promise<T | null | false>, name: string, timeout = 15000): Promise<T | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const v = await fn();
      if (v !== null && v !== false) return v;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`  ⚠ timed out waiting for: ${name}`);
  return null;
}

const bodyText = () => page.locator("body").innerText().catch(() => "");
const headerText = () => page.locator("header").innerText().catch(() => "");

/** Right panel is the w-72 column; its tab buttons have exact short labels. */
function panelTab(label: string) {
  return page.locator("div.w-72").getByRole("button", { name: label, exact: true }).first();
}

async function clickPanelTab(label: string) {
  await panelTab(label).click({ timeout: 5000 });
}

async function main() {
  const browser: Browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

  page.on("pageerror", err => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(`console: ${msg.text().slice(0, 200)}`);
  });

  const dump = async (label: string) => {
    try {
      await page.screenshot({ path: `/tmp/ui-fail-${label}.png`, fullPage: false });
    } catch { /* ignore */ }
  };

  try {
    /* ── 1) Landing page ──────────────────────────────────────── */
    console.log("\n── LANDING PAGE ──");
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(MS(3000));
    ok("landing renders title", (await bodyText()).includes("OmegaTrade Ultra"));
    ok("landing hero CTA exists", await page.locator("a:has-text('OPEN LIVE TERMINAL')").count() > 0);
    ok("nav LAUNCH TERMINAL exists", await page.locator("a:has-text('LAUNCH TERMINAL')").count() > 0);
    ok("nav anchor CAPABILITIES target exists", await page.locator("#features").count() > 0);
    ok("nav anchor LIVE DATA target exists", await page.locator("#data").count() > 0);

    const liveStripLive = await waitFor(async () => {
      const txt = await bodyText();
      return txt.includes("REAL-TIME FEEDS") && /[▲▼]/.test(txt) && /\d+\.\d+/.test(txt);
    }, "live strip prices", 25000);
    ok("landing live strip renders real prices", liveStripLive);

    await page.click("a:has-text('OPEN LIVE TERMINAL')");
    await page.waitForURL("**/terminal", { timeout: 15000 });
    ok("landing CTA navigates to /terminal", page.url().includes("/terminal"));

    /* ── 2) Terminal shell ────────────────────────────────────── */
    console.log("\n── TERMINAL SHELL ──");
    const shellLive = await waitFor(async () => {
      const txt = await bodyText();
      return txt.includes("STOCKS") && txt.includes("LIVE");
    }, "terminal shell", 25000);
    ok("terminal shell renders", shellLive);

    const priceText = await pollValue<string>(async () => {
      const t = await page.locator("header span.text-xl").first().innerText().catch(() => "");
      const v = parseFloat(t.replace(/,/g, ""));
      return Number.isFinite(v) && v > 0 ? t : null;
    }, "header price", 30000);
    ok("header shows a live price", priceText !== null, `price=${priceText ?? "—"}`);

    const connText = await headerText();
    ok("connection indicator LIVE", connText.includes("LIVE"), connText.includes("OFFLINE") ? "offline!" : "");

    /* ── 3) Market tabs ───────────────────────────────────────── */
    console.log("\n── MARKET TABS ──");
    const marketTabs: [string, string][] = [
      ["FOREX", "EUR/USD"], ["CRYPTO", "BTC/USDT"], ["INDICES", "SPY"], ["FUTURES", "ES"],
    ];
    for (const [tab, symbol] of marketTabs) {
      await page.click(`header button:has-text("${tab}")`, { timeout: 5000 });
      const switched = await waitFor(async () => (await headerText()).includes(symbol), `tab ${tab} → ${symbol}`, 10000);
      ok(`tab ${tab} switches symbol to ${symbol}`, switched);
      await page.waitForTimeout(MS(800));
    }
    await page.click('header button:has-text("STOCKS")', { timeout: 5000 });
    await page.waitForTimeout(MS(1200));

    /* ── 4) Timeframe buttons ─────────────────────────────────── */
    console.log("\n── TIMEFRAMES ──");
    for (const tf of ["1M", "5M", "15M", "30M", "1H", "4H", "1D"]) {
      await page.click(`header button:has-text("${tf}")`, { timeout: 5000 });
      await page.waitForTimeout(MS(350));
    }
    await page.waitForTimeout(MS(1500));
    ok("timeframe buttons all clickable", true);

    /* ── 5) Symbol search ─────────────────────────────────────── */
    console.log("\n── SYMBOL SEARCH ──");
    await page.fill("header input[placeholder*='Search']", "NVDA");
    await page.waitForTimeout(MS(900));
    const searchResult = page.locator("header .glass-panel button:has-text('NVDA')");
    const resultCount = await searchResult.count();
    ok("search shows NVDA result", resultCount > 0);
    if (resultCount > 0) {
      await searchResult.first().click();
      // Active symbol selector must highlight NVDA
      const nvdaActive = await waitFor(async () => {
        const btn = page.locator("header button").filter({ hasText: /^NVDA$/ }).first();
        if (await btn.count() === 0) return false;
        const cls = await btn.getAttribute("class").catch(() => "");
        return (cls ?? "").includes("text-brand-cyan");
      }, "search result selects NVDA", 8000);
      ok("search result selects NVDA (active symbol)", nvdaActive);
      // Chart must load NVDA: header price becomes NVDA's live price (non-zero)
      await page.waitForTimeout(MS(2000));
      const priceAfter = await pollValue<number>(async () => {
        const t = await page.locator("header span.text-xl").first().innerText().catch(() => "");
        const v = parseFloat(t.replace(/,/g, ""));
        return v > 0 ? v : null;
      }, "NVDA live price", 15000);
      ok("NVDA chart loads with live price", priceAfter !== null, priceAfter ? `$${priceAfter}` : "");
    }

    /* ── 6) Right-panel tabs ──────────────────────────────────── */
    console.log("\n── RIGHT PANEL TABS ──");
    const panelTabs: [string, string][] = [
      ["TA", "RSI"], ["DEPTH", "Depth"], ["NEWS", "NEWS"], ["PORT", "PAPER ACCOUNT"], ["LAB", "STRATEGY LAB"], ["AI", "OmegaPredict"],
    ];
    for (const [label, marker] of panelTabs) {
      await clickPanelTab(label);
      // Some headings are CSS-uppercased (innerText returns "DEPTH" for "Depth"), so compare case-insensitively
      const rendered = await waitFor(async () => (await bodyText()).toLowerCase().includes(marker.toLowerCase()), `panel ${label} shows "${marker}"`, 20000);
      ok(`panel ${label} renders (${marker})`, rendered);
      await page.waitForTimeout(MS(300));
    }

    /* ── 7) Strategy Lab: run a backtest ──────────────────────── */
    console.log("\n── STRATEGY LAB ──");
    // Anchor on a liquid symbol + intraday timeframe so the series reliably has ≥40 bars
    await page.click("header button:has-text('STOCKS')", { timeout: 5000 });
    await page.click("header button:has-text('15M')", { timeout: 5000 });
    await clickPanelTab("LAB");
    await page.waitForTimeout(MS(1200));
    await page.click("button:has-text('MA CROSSOVER')", { timeout: 5000 });
    await page.waitForTimeout(MS(300));
    const runBtn = page.locator("button:has-text('RUN BACKTEST')");
    const runnable = await runBtn.isEnabled().catch(() => false);
    if (runnable) {
      ok("backtest run button enabled (≥40 bars)", runnable);
      await runBtn.click();
      const hasMetrics = await waitFor(async () =>
        (await bodyText()).toLowerCase().includes("buy & hold"), "backtest metrics", 20000);
      ok("backtest runs and renders metrics", hasMetrics);
      // Either trades exist or the honest "no signals" notice is shown — never a silent no-op
      const hasFeedback = await waitFor(async () => {
        const t = (await bodyText()).toLowerCase();
        return t.includes("no signals in this window") || /\d+ trades/.test(t);
      }, "backtest feedback", 5000);
      ok("backtest gives visible feedback (trades or no-signals notice)", hasFeedback);
    } else {
      ok("backtest run button enabled (≥40 bars)", runnable, "graceful: <40 bars for this symbol/timeframe right now");
      const notice = await waitFor(async () => (await bodyText()).includes("Need ≥ 40 candles"), "graceful notice", 8000);
      ok("backtest shows graceful notice when data is thin", notice);
    }

    /* ── 8) Paper ticket: buy + close ─────────────────────────── */
    console.log("\n── PAPER TICKET ──");
    await clickPanelTab("PORT");
    await page.waitForTimeout(MS(500));
    await page.click("header button:has-text('STOCKS')", { timeout: 5000 });
    await page.waitForTimeout(MS(800));

    const ticketPrice = await pollValue<number>(async () => {
      const t = (await bodyText()).toLowerCase();
      const m = t.match(/est\. cost[\s\S]*?\$\s*([0-9][0-9.,]*)/);
      if (!m) return null;
      const v = parseFloat(m[1].replace(/,/g, ""));
      return v > 0 ? v : null;
    }, "ticket live price", 20000);
    ok("order ticket has live price", ticketPrice !== null, `cost≈$${ticketPrice ?? 0}`);

    await page.fill("input[inputmode='decimal']", "2");
    await page.click("button:has-text('BUY'):not(button:has-text('TRADE'))", { timeout: 5000 });
    const bought = await waitFor(async () => {
      const t = await bodyText();
      return t.includes("OPEN POSITIONS") && !t.includes("No open positions");
    }, "position opened", 10000);
    ok("BUY opens a paper position", bought);
    if (!bought) await dump("buy");

    await clickPanelTab("PORT");
    await page.waitForTimeout(MS(500));
    const closeBtn = page.locator("button:has-text('CLOSE ALL')").first();
    if (await closeBtn.count()) {
      await closeBtn.click();
      const closed = await waitFor(async () => (await bodyText()).includes("No open positions"), "position closed", 10000);
      ok("CLOSE ALL closes the position", closed);
      if (!closed) await dump("close");
    } else {
      ok("CLOSE ALL closes the position", false, "no close button found");
      await dump("close");
    }

    /* ── 9) Scanner: open, sort, filter, row-click, CSV, ESC ──── */
    console.log("\n── MARKET SCANNER ──");
    await page.click("header button:has-text('SCANNER')", { timeout: 5000 });
    const scannerOpen = await waitFor(async () => (await bodyText()).includes("LIVE MARKET SCANNER"), "scanner overlay", 10000);
    ok("SCANNER button opens the overlay", scannerOpen);
    if (!scannerOpen) await dump("scanner-open");

    const scanRows = await pollValue<number>(async () => {
      const n = await page.locator("tbody tr").count();
      return n > 0 ? n : null;
    }, "scanner rows", 15000);
    ok("scanner table has live rows", (scanRows ?? 0) > 0, `${scanRows ?? 0} rows`);

    await page.click("th:has-text('CHG%')", { timeout: 5000 });
    await page.waitForTimeout(MS(400));
    ok("scanner column sorting clickable", true);

    // Scope filter clicks to the overlay (the header also has CRYPTO/STOCKS tabs)
    const overlay = page.locator("div.fixed");
    await overlay.getByRole("button", { name: "CRYPTO" }).click({ timeout: 5000 });
    await page.waitForTimeout(MS(700));
    const cryptoRows = await page.locator("tbody tr").count();
    ok("scanner market filter narrows rows", cryptoRows >= 1 && cryptoRows < (scanRows ?? 99), `${cryptoRows} crypto rows`);
    if (cryptoRows >= (scanRows ?? 0)) await dump("scanner-filter");

    const dlPromise = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    await overlay.getByRole("button", { name: "CSV" }).click({ timeout: 5000 });
    const dl = await dlPromise;
    ok("scanner CSV export downloads a file", dl !== null);

    // Row click jumps to the chart and closes — must click a REAL row (the empty-state
    // notice row is non-interactive), so reset the filter and wait for a symbol row.
    await page.locator("div.fixed").getByRole("button", { name: "ALL" }).click({ timeout: 5000 });
    const realRow = await pollValue<string>(async () => {
      const rows = page.locator("tbody tr");
      const n = await rows.count();
      for (let i = 0; i < n; i++) {
        const txt = (await rows.nth(i).innerText()).split("\n")[0] ?? "";
        if (/^[A-Z][A-Z0-9/.-]+$/.test(txt.trim())) return txt.trim();
      }
      return null;
    }, "a real scanner row", 20000);
    if (realRow) {
      const row = page.locator("tbody tr").filter({ hasText: realRow }).first();
      await row.click({ timeout: 5000 });
      const closed2 = await waitFor(async () => !(await bodyText()).includes("LIVE MARKET SCANNER"), "scanner closes", 8000);
      const headerShowsSymbol = await waitFor(async () => (await headerText()).includes(realRow), "header symbol", 8000);
      ok("scanner row-click opens symbol + closes overlay", closed2 && headerShowsSymbol, `${realRow}`);
      if (!closed2 || !headerShowsSymbol) await dump("scanner-row");
    } else {
      ok("scanner row-click opens symbol + closes overlay", false, "no real rows with data available");
      await dump("scanner-row");
    }

    await page.click("header button:has-text('SCANNER')", { timeout: 5000 });
    await page.waitForTimeout(MS(500));
    await page.click("button:has-text('ESC')", { timeout: 5000 });
    const escClosed = await waitFor(async () => !(await bodyText()).includes("LIVE MARKET SCANNER"), "esc closes scanner", 8000);
    ok("scanner ESC button closes overlay", escClosed);

    /* ── 10) XAI toggle ───────────────────────────────────────── */
    console.log("\n── XAI TOGGLE ──");
    await page.click("header button:has-text('STOCKS')", { timeout: 5000 });
    await page.waitForTimeout(MS(800));
    const xaiBtn = page.locator("button:has-text('XAI')").first();
    if (await xaiBtn.count()) {
      await xaiBtn.click();
      await page.waitForTimeout(MS(700));
      ok("XAI attribution toggle clickable", true);
      await xaiBtn.click();
    } else {
      ok("XAI attribution toggle clickable", false, "button not found");
      await dump("xai");
    }

    /* ── 11) Live-data freshness probe (crypto, 24/7) ─────────── */
    console.log("\n── LIVE DATA FRESHNESS ──");
    await page.click("header button:has-text('CRYPTO')", { timeout: 5000 });
    const samples: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = await pollValue<string>(async () => {
        const h = await headerText();
        const m = h.match(/(\d+\.\d+)\s*%/);
        if (!m) return null;
        // header shows price + change; capture the header price text near BTC
        const seg = h.match(/BTC\/USDT[\s\S]{0,120}/);
        return seg ? seg[0] : null;
      }, `BTC sample ${i + 1}`, 20000);
      samples.push(t ?? "—");
      if (i < 2) await page.waitForTimeout(MS(6000));
    }
    const distinct = new Set(samples.filter(s => s !== "—")).size;
    ok("BTC header price live and moving (3 samples, ≥2 distinct)",
      samples.every(s => s !== "—") && distinct >= 2,
      samples.map(s => s.slice(0, 60)).join(" | "));
    if (distinct < 2) await dump("freshness");

    const footer = await page.locator("footer").innerText();
    ok("footer shows provider mesh + fastest provider",
      footer.includes("Mesh:") && (footer.includes("FASTEST") || footer.includes("●")), footer.slice(0, 110));

    /* ── 12) Unknown route → NotFound with working links ──────── */
    console.log("\n── 404 PAGE ──");
    await page.goto(BASE + "/does-not-exist", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(MS(800));
    const nf = await bodyText();
    ok("404 page renders", nf.includes("404") && nf.includes("SIGNAL LOST"));
    await page.click("a:has-text('LAUNCH TERMINAL')", { timeout: 5000 });
    await page.waitForURL("**/terminal", { timeout: 10000 });
    ok("404 → LAUNCH TERMINAL navigates to /terminal", page.url().includes("/terminal"));

    /* ── Summary ──────────────────────────────────────────────── */
    console.log("\n" + "─".repeat(60));
    const realErrors = consoleErrors.filter(e => !e.includes("favicon") && !e.includes("404"));
    if (realErrors.length > 0) {
      console.log("CONSOLE/PAGE ERRORS CAPTURED:");
      realErrors.slice(0, 10).forEach(e => console.log("  ✖ " + e));
    } else {
      console.log("No console/page errors during the whole session ✅");
    }
    console.log(`UI TESTS: ${passed} passed, ${failures} failed`);
    await dump("final");
    await browser.close();
    process.exit(failures > 0 ? 1 : 0);
  } catch (e) {
    console.error("UI test crashed:", e);
    await dump("crash");
    console.error("--- body at crash ---");
    console.error((await bodyText()).slice(0, 1500));
    await browser.close();
    process.exit(1);
  }
}

main();
