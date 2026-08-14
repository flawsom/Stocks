import { useEffect, useState, useRef } from "react";
import { useTradingStore } from "@/stores/tradingStore";
import type { OrderBook, OrderBookEntry } from "@/types";

const KRAKEN_NAMES: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };

function krakenPair(symbol: string): string {
  const [b, q] = symbol.split("/");
  return `${KRAKEN_NAMES[b] || b}${q === "USDT" ? "USD" : q}`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(v => { clearTimeout(timer); resolve(v); }).catch(() => { clearTimeout(timer); resolve(null); });
  });
}

function buildLadder(levels: [string, string][], isAsk: boolean): { entries: OrderBookEntry[]; total: number } {
  let total = 0;
  const entries = levels.slice(0, 12).map(([p, s]) => {
    const size = parseFloat(s);
    total += size;
    return { price: parseFloat(p), size, total };
  });
  return { entries, total };
}

/** Real L2 snapshot from Kraken public REST (free, no key, CORS-enabled). */
async function depthFromKraken(symbol: string): Promise<OrderBook | null> {
  const pair = krakenPair(symbol);
  const res = await fetch(`https://api.kraken.com/0/public/Depth?pair=${pair}&count=25`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.error?.length) return null;
  const key = Object.keys(data.result || {})[0];
  const book = data.result?.[key];
  if (!book?.bids?.length || !book?.asks?.length) return null;

  const bids = buildLadder(book.bids as [string, string][], false);
  const asks = buildLadder(book.asks as [string, string][], true);
  const bestBid = bids.entries[0]?.price ?? 0;
  const bestAsk = asks.entries[0]?.price ?? 0;
  if (!(bestBid > 0) || !(bestAsk > 0)) return null;

  return {
    bids: bids.entries,
    asks: asks.entries,
    spread: bestAsk - bestBid,
    midPrice: (bestBid + bestAsk) / 2,
    realDepth: true,
    source: "Kraken L2 depth",
    updatedAt: Date.now(),
  };
}

/** Real L2 snapshot from OKX public REST (free, no key, CORS-enabled). */
async function depthFromOkx(symbol: string): Promise<OrderBook | null> {
  const instId = symbol.replace("/", "-");
  const res = await fetch(`https://www.okx.com/api/v5/market/books?instId=${instId}&sz=20`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.code !== "0" || !data.data?.[0]) return null;
  const book = data.data[0];
  if (!book?.bids?.length || !book?.asks?.length) return null;

  const bids = buildLadder((book.bids as [string, string][]).slice(0, 20), false);
  const asks = buildLadder((book.asks as [string, string][]).slice(0, 20), true);
  const bestBid = bids.entries[0]?.price ?? 0;
  const bestAsk = asks.entries[0]?.price ?? 0;
  if (!(bestBid > 0) || !(bestAsk > 0)) return null;

  return {
    bids: bids.entries,
    asks: asks.entries,
    spread: bestAsk - bestBid,
    midPrice: (bestBid + bestAsk) / 2,
    realDepth: true,
    source: "OKX L2 depth",
    updatedAt: Date.now(),
  };
}

/** Volume-at-price profile built from REAL candle data (L1 market profile). */
function buildMarketProfile(candles: { high: number; low: number; close: number; volume: number }[]): OrderBook {
  const levels = 16;
  let min = Infinity, max = -Infinity;
  for (const c of candles) {
    min = Math.min(min, c.low);
    max = Math.max(max, c.high);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    max = min + 1;
  }
  const bucket = (max - min) / levels;

  const bins = new Array<number>(levels).fill(0);
  for (const c of candles) {
    const mid = (c.high + c.low) / 2;
    let idx = Math.floor((mid - min) / bucket);
    if (idx < 0) idx = 0;
    if (idx >= levels) idx = levels - 1;
    bins[idx] += c.volume || 0;
  }

  const total = bins.reduce((a, b) => a + b, 0) || 1;
  const midPrice = candles[candles.length - 1]?.close || 0;

  // Levels above mid → asks (sell pressure), below → bids (buy pressure)
  const asks: OrderBook["asks"] = [];
  const bids: OrderBook["bids"] = [];
  let askTotal = 0;
  let bidTotal = 0;

  for (let i = levels - 1; i >= 0; i--) {
    const price = min + bucket * (i + 0.5);
    const share = (bins[i] / total) * 100;
    if (price > midPrice && asks.length < 10) {
      askTotal += share;
      asks.push({ price, size: share, total: askTotal });
    } else if (price <= midPrice && bids.length < 10) {
      bidTotal += share;
      bids.push({ price, size: share, total: bidTotal });
    }
  }

  // Sort: asks ascending (farthest first), bids descending (closest first)
  asks.sort((a, b) => b.price - a.price).reverse();
  bids.sort((a, b) => b.price - a.price);

  return {
    bids,
    asks,
    spread: 0,
    midPrice,
    realDepth: false,
    source: "volume profile (real candles)",
    updatedAt: Date.now(),
  };
}

export default function OrderBook() {
  const { candles, activeSymbol, activeMarket } = useTradingStore();
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);

  const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;

  // Live candles/price via refs so depth streams are NOT reconnected on every tick
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const lastPriceRef = useRef(lastPrice);
  lastPriceRef.current = lastPrice;

  /* Crypto: real L2 depth — Binance WS → Kraken REST → OKX REST → live candle profile.
   * The chain exists because Binance is geo-blocked in several regions; Kraken/OKX
   * are free, keyless and reachable everywhere. The final profile fallback refreshes
   * every 5s so the panel never freezes. */
  useEffect(() => {
    if (activeMarket !== "crypto" || !activeSymbol) return;
    const symbol = activeSymbol.replace("/", "").toLowerCase();
    let disposed = false;
    let binanceGotData = false;
    let restIv: ReturnType<typeof setInterval> | undefined;
    let profileTimer: ReturnType<typeof setTimeout> | undefined;
    let profileIv: ReturnType<typeof setInterval> | undefined;

    // 1) Binance depth WS (preferred where reachable — 100ms updates)
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@depth20@100ms`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data.bids || !data.asks) return;
        binanceGotData = true;
        let bidTotal = 0;
        let askTotal = 0;
        const bids = data.bids.slice(0, 12).map((b: string[]) => {
          const size = parseFloat(b[1]);
          bidTotal += size;
          return { price: parseFloat(b[0]), size, total: bidTotal };
        });
        const asks = data.asks.slice(0, 12).map((a: string[]) => {
          const size = parseFloat(a[1]);
          askTotal += size;
          return { price: parseFloat(a[0]), size, total: askTotal };
        });
        const midPrice = (parseFloat(data.bids[0][0]) + parseFloat(data.asks[0][0])) / 2;
        const spread = parseFloat(data.asks[0][0]) - parseFloat(data.bids[0][0]);
        if (!disposed) {
          setOrderBook({ bids, asks, spread, midPrice, realDepth: true, source: "Binance L2 depth stream", updatedAt: Date.now() });
        }
      } catch { /* ignore */ }
    };

    // 2) If Binance is unreachable within 5s, poll Kraken/OKX L2 REST snapshots
    const restTimer = setTimeout(() => {
      if (disposed || binanceGotData) return;
      let restIdx = 0;
      const pollRest = async () => {
        if (disposed) return;
        const book = restIdx % 2 === 0
          ? await withTimeout(depthFromKraken(activeSymbol), 3500)
          : await withTimeout(depthFromOkx(activeSymbol), 3500);
        restIdx++;
        if (book && !disposed) {
          setOrderBook(book);
        }
      };
      pollRest();
      restIv = setInterval(pollRest, 2500);
      // 3) If no venue answered after ~12s, serve the candle profile — refreshed live
      profileTimer = setTimeout(() => {
        if (disposed || binanceGotData) return;
        const cs = candlesRef.current;
        const lp = lastPriceRef.current;
        if (cs.length >= 5 && lp > 0) setOrderBook(buildMarketProfile(cs));
      }, 12000);
      profileIv = setInterval(() => {
        if (disposed || binanceGotData) return;
        const cs = candlesRef.current;
        const lp = lastPriceRef.current;
        if (cs.length >= 5 && lp > 0) setOrderBook(buildMarketProfile(cs));
      }, 5000);
    }, 5000);

    return () => {
      disposed = true;
      clearTimeout(restTimer);
      clearTimeout(profileTimer);
      clearInterval(restIv);
      clearInterval(profileIv);
      ws.close();
      setOrderBook(null);
    };
  }, [activeSymbol, activeMarket]);

  /* Other markets: real L1 volume-at-price profile from candle data, refreshed live */
  useEffect(() => {
    if (activeMarket === "crypto" || candles.length < 5 || lastPrice <= 0) return;
    setOrderBook(buildMarketProfile(candles));
  }, [candles, lastPrice, activeSymbol, activeMarket]);

  if (!orderBook) {
    return (
      <div className="p-4 flex items-center justify-center">
        <span className="text-xs font-mono text-slate-600">
          {activeMarket === "crypto" ? "Connecting to L2 depth (Binance → Kraken → OKX)..." : "Building market profile..."}
        </span>
      </div>
    );
  }

  const maxTotal = Math.max(
    ...orderBook.bids.map(b => b.total),
    ...orderBook.asks.map(a => a.total),
    1
  );
  const priceDecimals = lastPrice > 100 ? 2 : lastPrice > 1 ? 4 : 5;

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-slate-500 uppercase">Depth</span>
        <span className="text-[10px] font-mono text-slate-600">{orderBook.source}</span>
      </div>

      {orderBook.realDepth ? (
        <>
          {/* L2 ladder */}
          <div className="grid grid-cols-3 gap-1 text-xs font-mono text-slate-600 px-1">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>

          <div className="flex flex-col-reverse gap-0.5">
            {orderBook.asks.slice(0, 8).map((ask, i) => (
              <div key={i} className="relative grid grid-cols-3 gap-1 text-xs font-mono px-1 py-0.5 rounded overflow-hidden">
                <div className="absolute top-0 right-0 bottom-0" style={{ width: `${(ask.total / maxTotal) * 100}%`, backgroundColor: "rgba(255,51,102,0.08)" }} />
                <span className="text-bear relative z-10">{ask.price.toFixed(priceDecimals)}</span>
                <span className="text-right text-slate-400 relative z-10">{ask.size.toFixed(4)}</span>
                <span className="text-right text-slate-500 relative z-10">{ask.total.toFixed(4)}</span>
              </div>
            ))}
          </div>

          <div className="py-1.5 px-2 rounded bg-terminal-bg border border-terminal-border flex justify-between items-center">
            <span className="text-xs font-mono text-slate-500">Mid / Spread</span>
            <span className="text-sm font-mono font-bold text-brand-cyan">
              {orderBook.midPrice.toFixed(priceDecimals)}
              <span className="text-xs text-predict ml-2">Δ {orderBook.spread.toFixed(priceDecimals)}</span>
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            {orderBook.bids.slice(0, 8).map((bid, i) => (
              <div key={i} className="relative grid grid-cols-3 gap-1 text-xs font-mono px-1 py-0.5 rounded overflow-hidden">
                <div className="absolute top-0 left-0 bottom-0" style={{ width: `${(bid.total / maxTotal) * 100}%`, backgroundColor: "rgba(0,255,136,0.08)" }} />
                <span className="text-bull relative z-10">{bid.price.toFixed(priceDecimals)}</span>
                <span className="text-right text-slate-400 relative z-10">{bid.size.toFixed(4)}</span>
                <span className="text-right text-slate-500 relative z-10">{bid.total.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* L1 volume-at-price profile */}
          <div className="text-[10px] font-mono text-slate-600 px-1">
            Real volume-at-price from the current candle series (L1). Free tiers expose no live L2 book for this market.
          </div>
          <div className="grid grid-cols-2 gap-1 text-xs font-mono text-slate-600 px-1">
            <span>Price</span>
            <span className="text-right">Volume share</span>
          </div>

          <div className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {[...orderBook.asks, ...orderBook.bids].slice(0, 18).map((level, i) => (
              <div key={i} className="relative grid grid-cols-2 gap-1 text-xs font-mono px-1 py-0.5 rounded overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 left-0"
                  style={{
                    width: `${(level.size / 100) * 100}%`,
                    backgroundColor: level.price >= lastPrice ? "rgba(0,255,136,0.10)" : "rgba(255,51,102,0.10)",
                  }}
                />
                <span className={level.price >= lastPrice ? "text-bull relative z-10" : "text-bear relative z-10"}>
                  {level.price.toFixed(priceDecimals)}
                </span>
                <span className="text-right text-slate-400 relative z-10">{level.size.toFixed(1)}%</span>
              </div>
            ))}
          </div>

          <div className="py-1.5 px-2 rounded bg-terminal-bg border border-terminal-border flex justify-between items-center">
            <span className="text-xs font-mono text-slate-500">Last</span>
            <span className="text-sm font-mono font-bold text-brand-cyan">
              {lastPrice.toFixed(priceDecimals)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
