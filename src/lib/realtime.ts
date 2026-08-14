import { API_KEYS, ENDPOINTS, BINANCE_INTERVAL, TIMEFRAME_SECONDS } from "@/constants/config";
import { isTdDayExhausted } from "@/lib/dataProviders";
import type { OHLCV, Timeframe } from "@/types";

/* ────────────────────────────────────────────────────────────────
 * Finnhub trade WebSocket (stocks — verified live)
 * ──────────────────────────────────────────────────────────────── */

export type TickHandler = (symbol: string, price: number, volume: number, ts: number) => void;

/* Shared reconnect state + circuit breaker:
 * after maxFails consecutive failed connections the stream pauses
 * (pauseMs) instead of hammering a geo-blocked or quota-limited
 * endpoint forever. */
interface ReconnectState {
  timer?: ReturnType<typeof setTimeout>;
  backoff: number;
  fails: number;
}

function scheduleReconnect(rs: ReconnectState, closed: boolean, open: () => void, maxFails = 6, pauseMs = 300_000) {
  if (closed) return;
  rs.fails++;
  if (rs.fails >= maxFails) {
    rs.timer = setTimeout(() => { rs.fails = 0; rs.backoff = 1000; open(); }, pauseMs);
    return;
  }
  rs.timer = setTimeout(() => open(), rs.backoff);
  rs.backoff = Math.min(rs.backoff * 1.5, 10000);
}

function markOpen(rs: ReconnectState) {
  rs.fails = 0;
  rs.backoff = 1000;
}

class FinnhubTradeWS {
  private ws: WebSocket | null = null;
  private subscriptions = new Set<string>();
  private onTick?: TickHandler;
  private rs: ReconnectState = { backoff: 1000, fails: 0 };
  private closed = false;

  connect(onTick: TickHandler) {
    this.onTick = onTick;
    // Singleton: idempotent reconnect across StrictMode remounts
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.closed = false;
    this.open();
  }

  private open() {
    if (this.closed) return;
    this.ws = new WebSocket(`${ENDPOINTS.FINNHUB_WS}?token=${API_KEYS.FINNHUB}`);

    this.ws.onopen = () => {
      markOpen(this.rs);
      this.subscriptions.forEach(sym => this.sendSubscribe(sym));
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "trade" && msg.data) {
          for (const trade of msg.data) {
            this.onTick?.(trade.s, trade.p, trade.v || 0, trade.t || Date.now());
          }
        }
      } catch { /* ignore */ }
    };

    this.ws.onerror = () => { /* transient */ };

    this.ws.onclose = () => {
      if (!this.closed) scheduleReconnect(this.rs, this.closed, () => this.open());
    };
  }

  subscribe(symbol: string) {
    if (this.subscriptions.has(symbol)) return;
    this.subscriptions.add(symbol);
    this.sendSubscribe(symbol);
  }

  unsubscribe(symbol: string) {
    this.subscriptions.delete(symbol);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", symbol }));
    }
  }

  private sendSubscribe(symbol: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", symbol }));
    }
  }

  get status(): "connected" | "connecting" | "offline" {
    if (!this.ws) return "offline";
    if (this.ws.readyState === WebSocket.OPEN) return "connected";
    return "connecting";
  }

  close() {
    this.closed = true;
    clearTimeout(this.rs.timer);
    this.ws?.close();
  }
}

/* ────────────────────────────────────────────────────────────────
 * Binance WebSocket — trade streams for the crypto watchlist
 * (all symbols) + kline stream for the active symbol/timeframe.
 * Geo-blocked from some regions: the reconnect circuit breaker
 * keeps it quiet, and Coinbase/Kraken below are always-on peers.
 * ──────────────────────────────────────────────────────────────── */

export interface KlineEvent { symbol: string; candle: OHLCV; isClosed: boolean }

class BinanceStreamWS {
  private ws: WebSocket | null = null;
  private closed = false;
  private rs: ReconnectState = { backoff: 1000, fails: 0 };
  private tradeSymbols: string[] = [];
  private klineSymbol: string | null = null;
  private klineInterval = "15m";
  private onTrade?: TickHandler;
  private onKline?: (e: KlineEvent) => void;

  connect(tradeSymbols: string[], onTrade: TickHandler, onKline: (e: KlineEvent) => void) {
    this.tradeSymbols = tradeSymbols;
    this.onTrade = onTrade;
    this.onKline = onKline;
    // Singleton: idempotent reconnect across StrictMode remounts
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.closed = false;
    this.open();
  }

  private streamName(symbol: string, kind: "trade" | "kline", interval?: string) {
    const s = symbol.replace("/", "").toLowerCase();
    return kind === "trade" ? `${s}@trade` : `${s}@kline_${interval}`;
  }

  private buildUrl() {
    const streams = [
      ...this.tradeSymbols.map(s => this.streamName(s, "trade")),
      ...(this.klineSymbol ? [this.streamName(this.klineSymbol, "kline", this.klineInterval)] : []),
    ];
    return `${ENDPOINTS.BINANCE_WS}?streams=${streams.join("/")}`;
  }

  private open() {
    if (this.closed) return;
    this.ws = new WebSocket(this.buildUrl());

    this.ws.onopen = () => { markOpen(this.rs); };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const data = msg.data;
        if (!data) return;
        if (data.e === "trade") {
          const symbol = data.s.replace("USDT", "/USDT");
          this.onTrade?.(symbol, parseFloat(data.p), parseFloat(data.q) || 0, data.T || Date.now());
        } else if (data.e === "kline" && data.k) {
          const k = data.k;
          const symbol = k.s.replace("USDT", "/USDT");
          this.onKline?.({
            symbol,
            candle: {
              time: Math.floor(k.t / 1000),
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
            },
            isClosed: k.x === true,
          });
        }
      } catch { /* ignore */ }
    };

    this.ws.onerror = () => { /* transient */ };

    this.ws.onclose = () => {
      if (!this.closed) scheduleReconnect(this.rs, this.closed, () => this.open());
    };
  }

  setActiveKline(symbol: string, timeframe: Timeframe) {
    this.klineSymbol = symbol;
    this.klineInterval = BINANCE_INTERVAL[timeframe] || "15m";
    // Reconnect with the new stream set (simplest reliable approach)
    this.ws?.close();
    this.ws = null;
    if (!this.closed) this.open();
  }

  get status(): "connected" | "connecting" | "offline" {
    if (!this.ws) return "offline";
    if (this.ws.readyState === WebSocket.OPEN) return "connected";
    return "connecting";
  }

  close() {
    this.closed = true;
    clearTimeout(this.rs.timer);
    this.ws?.close();
  }
}

/* ────────────────────────────────────────────────────────────────
 * Coinbase Exchange WebSocket — free, no API key, CORS-free (WS),
 * reachable from every region. Live ticker stream for the crypto
 * watchlist. Works even where Binance is geo-blocked.
 * ──────────────────────────────────────────────────────────────── */

function coinbaseProduct(symbol: string) {
  const [b, q] = symbol.split("/");
  return `${b}-${q === "USDT" ? "USD" : q}`;
}

function coinbaseAppSymbol(product: string) {
  const [b, q] = product.split("-");
  return `${b}/${q === "USD" ? "USDT" : q}`;
}

class CoinbaseTradeWS {
  private ws: WebSocket | null = null;
  private closed = false;
  private rs: ReconnectState = { backoff: 1000, fails: 0 };
  private symbols: string[] = [];
  private onTick?: TickHandler;

  connect(symbols: string[], onTick: TickHandler) {
    this.symbols = symbols;
    this.onTick = onTick;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.closed = false;
    this.open();
  }

  private open() {
    if (this.closed) return;
    this.ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");

    this.ws.onopen = () => {
      markOpen(this.rs);
      if (this.symbols.length > 0) {
        this.ws?.send(JSON.stringify({
          type: "subscribe",
          product_ids: this.symbols.map(coinbaseProduct),
          channels: ["ticker"],
        }));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "ticker" && msg.product_id && msg.price) {
          const price = parseFloat(msg.price);
          if (!(price > 0)) return;
          const symbol = coinbaseAppSymbol(msg.product_id);
          this.onTick?.(symbol, price, parseFloat(msg.volume_24h) || 0, Date.parse(msg.time) || Date.now());
        }
      } catch { /* ignore */ }
    };

    this.ws.onerror = () => { /* transient */ };

    this.ws.onclose = () => {
      if (!this.closed) scheduleReconnect(this.rs, this.closed, () => this.open());
    };
  }

  get status(): "connected" | "connecting" | "offline" {
    if (!this.ws) return "offline";
    if (this.ws.readyState === WebSocket.OPEN) return "connected";
    return "connecting";
  }

  close() {
    this.closed = true;
    clearTimeout(this.rs.timer);
    this.ws?.close();
  }
}

/* ────────────────────────────────────────────────────────────────
 * Kraken WebSocket — free, no API key, region-friendly. Live
 * ticker stream for the crypto watchlist (a second independent
 * peer to Coinbase so crypto never depends on a single venue).
 * ──────────────────────────────────────────────────────────────── */

const KRAKEN_NAME_MAP: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };
const KRAKEN_NAME_REV: Record<string, string> = { XBT: "BTC", XDG: "DOGE" };

function krakenPair(symbol: string) {
  const [b, q] = symbol.split("/");
  return `${KRAKEN_NAME_MAP[b] || b}/${q === "USDT" ? "USD" : q}`;
}

function krakenAppSymbol(pair: string) {
  const [b, q] = pair.split("/");
  return `${KRAKEN_NAME_REV[b] || b}/${q === "USD" ? "USDT" : q}`;
}

class KrakenTradeWS {
  private ws: WebSocket | null = null;
  private closed = false;
  private rs: ReconnectState = { backoff: 1000, fails: 0 };
  private symbols: string[] = [];
  private onTick?: TickHandler;

  connect(symbols: string[], onTick: TickHandler) {
    this.symbols = symbols;
    this.onTick = onTick;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.closed = false;
    this.open();
  }

  private open() {
    if (this.closed) return;
    this.ws = new WebSocket("wss://ws.kraken.com");

    this.ws.onopen = () => {
      markOpen(this.rs);
      if (this.symbols.length > 0) {
        this.ws?.send(JSON.stringify({
          event: "subscribe",
          pair: this.symbols.map(krakenPair),
          subscription: { name: "ticker" },
        }));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Ticker messages are arrays: [channelId, data, "ticker", pair]
        if (Array.isArray(msg) && msg.length >= 4 && msg[2] === "ticker") {
          const pair = String(msg[3]);
          const data = msg[1] as { c?: string[]; v?: string[] };
          const price = parseFloat(data?.c?.[0] ?? "");
          if (!(price > 0)) return;
          const symbol = krakenAppSymbol(pair);
          this.onTick?.(symbol, price, parseFloat(data?.v?.[1] ?? "0") || 0, Date.now());
        }
      } catch { /* ignore */ }
    };

    this.ws.onerror = () => { /* transient */ };

    this.ws.onclose = () => {
      if (!this.closed) scheduleReconnect(this.rs, this.closed, () => this.open());
    };
  }

  get status(): "connected" | "connecting" | "offline" {
    if (!this.ws) return "offline";
    if (this.ws.readyState === WebSocket.OPEN) return "connected";
    return "connecting";
  }

  close() {
    this.closed = true;
    clearTimeout(this.rs.timer);
    this.ws?.close();
  }
}

/* ────────────────────────────────────────────────────────────────
 * Twelve Data WebSocket — real-time quotes for ONE forex pair
 * (free tier allows a single symbol per account — verified).
 * Re-subscribes when the active pair changes.
 * ──────────────────────────────────────────────────────────────── */

class TwelveDataQuoteWS {
  private ws: WebSocket | null = null;
  private closed = false;
  private rs: ReconnectState = { backoff: 1000, fails: 0 };
  private symbol: string | null = null;
  private onTick?: TickHandler;

  connect(onTick: TickHandler) {
    this.onTick = onTick;
    // Singleton: idempotent reconnect across StrictMode remounts
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.closed = false;
    this.open();
  }

  private open() {
    if (this.closed) return;
    if (isTdDayExhausted()) {
      // The key's day budget is spent server-side — don't hammer the socket.
      // Re-check every 5 minutes; a fresh personal key clears the flag.
      this.rs.timer = setTimeout(() => this.open(), 300_000);
      return;
    }
    this.ws = new WebSocket(`${ENDPOINTS.TWELVE_DATA_WS}?apikey=${API_KEYS.TWELVE_DATA}`);

    this.ws.onopen = () => {
      markOpen(this.rs);
      if (this.symbol) {
        this.ws?.send(JSON.stringify({ action: "subscribe", params: { symbols: this.symbol } }));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === "price") {
          const sym = msg.symbol;
          const price = parseFloat(msg.price);
          this.onTick?.(sym, price, 0, (msg.timestamp || Date.now() / 1000) * 1000);
        }
      } catch { /* ignore */ }
    };

    this.ws.onerror = () => { /* transient */ };

    this.ws.onclose = () => {
      if (!this.closed) scheduleReconnect(this.rs, this.closed, () => this.open());
    };
  }

  setSymbol(symbol: string | null) {
    this.symbol = symbol;
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (symbol) {
        this.ws.send(JSON.stringify({ action: "subscribe", params: { symbols: symbol } }));
      }
    } else if (!this.closed && this.ws?.readyState !== WebSocket.CONNECTING) {
      this.open();
    }
  }

  get status(): "connected" | "connecting" | "offline" {
    if (!this.ws) return "offline";
    if (this.ws.readyState === WebSocket.OPEN) return "connected";
    return "connecting";
  }

  close() {
    this.closed = true;
    clearTimeout(this.rs.timer);
    this.ws?.close();
  }
}

/* ────────────────────────────────────────────────────────────────
 * CandleAggregator — builds live candles from ticks and merges
 * provider history with the live stream.
 * ──────────────────────────────────────────────────────────────── */

interface SeriesState {
  candles: OHLCV[];
  lastBucket: number;
  lastBucketVol: number;
  streaming: boolean;
  tickCount: number;
}

const MAX_TICKS_PER_SYMBOL = 4000;
const MAX_CANDLES = 600;

function bucketOf(ts: number, tf: Timeframe): number {
  const sec = TIMEFRAME_SECONDS[tf] || 900;
  return Math.floor(ts / sec) * sec;
}

class CandleAggregator {
  private tickBuffers = new Map<string, { ts: number; price: number; vol: number }[]>();
  private series = new Map<string, SeriesState>();
  private activeSymbol: string | null = null;
  private activeTf: Timeframe = "15min";

  setActive(symbol: string, tf: Timeframe) {
    this.activeSymbol = symbol;
    this.activeTf = tf;
  }

  /** Seed provider history for (symbol, tf); replays buffered ticks on top. */
  setHistory(symbol: string, tf: Timeframe, candles: OHLCV[]) {
    const key = `${symbol}|${tf}`;
    const list = [...candles].slice(-MAX_CANDLES);
    let lastBucket = 0;
    if (list.length > 0) lastBucket = bucketOf(list[list.length - 1].time, tf);
    this.series.set(key, {
      candles: list,
      lastBucket,
      lastBucketVol: list.length > 0 ? list[list.length - 1].volume : 0,
      streaming: false,
      tickCount: 0,
    });
    // Replay buffered ticks that come after the last history candle
    const ticks = this.tickBuffers.get(symbol);
    if (ticks) {
      const lastTime = list.length > 0 ? list[list.length - 1].time : 0;
      for (const t of ticks) {
        if (t.ts / 1000 >= lastTime - 60) this.mergeTick(symbol, tf, t);
      }
    }
  }

  private seriesState(symbol: string, tf: Timeframe): SeriesState {
    const key = `${symbol}|${tf}`;
    let s = this.series.get(key);
    if (!s) {
      s = { candles: [], lastBucket: 0, lastBucketVol: 0, streaming: true, tickCount: 0 };
      this.series.set(key, s);
    }
    return s;
  }

  /** Apply an authoritative kline update (Binance). */
  applyKline(symbol: string, tf: Timeframe, candle: OHLCV) {
    const s = this.seriesState(symbol, tf);
    const last = s.candles[s.candles.length - 1];
    if (last && last.time === candle.time) {
      s.candles[s.candles.length - 1] = candle;
    } else if (!last || candle.time > last.time) {
      s.candles.push(candle);
      if (s.candles.length > MAX_CANDLES) s.candles.shift();
    }
    s.lastBucket = candle.time;
    s.lastBucketVol = candle.volume;
    s.streaming = false;
  }

  private mergeTick(symbol: string, tf: Timeframe, tick: { ts: number; price: number; vol: number }) {
    const s = this.seriesState(symbol, tf);
    const bucket = bucketOf(tick.ts / 1000, tf);
    const last = s.candles[s.candles.length - 1];

    if (!last || bucket > s.lastBucket) {
      const candle: OHLCV = {
        time: bucket,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.vol || 0,
      };
      s.candles.push(candle);
      if (s.candles.length > MAX_CANDLES) s.candles.shift();
      s.lastBucket = bucket;
      s.lastBucketVol = candle.volume;
      s.streaming = true;
    } else if (bucket === s.lastBucket) {
      s.candles[s.candles.length - 1] = {
        ...s.candles[s.candles.length - 1],
        high: Math.max(s.candles[s.candles.length - 1].high, tick.price),
        low: Math.min(s.candles[s.candles.length - 1].low, tick.price),
        close: tick.price,
        volume: s.candles[s.candles.length - 1].volume + (tick.vol || 0),
      };
      s.lastBucketVol = s.candles[s.candles.length - 1].volume;
    }
  }

  /** Ingest a trade/quote tick for any symbol (watchlist + active). */
  ingestTick(symbol: string, price: number, vol: number, ts: number) {
    if (!(price > 0) || !Number.isFinite(price)) return;

    let buf = this.tickBuffers.get(symbol);
    if (!buf) {
      buf = [];
      this.tickBuffers.set(symbol, buf);
    }
    buf.push({ ts, price, vol });
    if (buf.length > MAX_TICKS_PER_SYMBOL) buf.splice(0, buf.length - MAX_TICKS_PER_SYMBOL);

    if (symbol === this.activeSymbol) {
      this.mergeTick(symbol, this.activeTf, { ts, price, vol });
      // Always build a 1-minute series too (dense training data for the ML engine)
      this.mergeTick(symbol, "1min", { ts, price, vol });
    }
  }

  /** Current merged series for the active pair. */
  getActiveSeries(): OHLCV[] {
    if (!this.activeSymbol) return [];
    const s = this.series.get(`${this.activeSymbol}|${this.activeTf}`);
    return s ? s.candles : [];
  }

  /** 1-minute series for the active symbol (built from ticks). */
  getMinuteSeries(): OHLCV[] {
    if (!this.activeSymbol) return [];
    const s = this.series.get(`${this.activeSymbol}|1min`);
    return s ? s.candles : [];
  }

  getSeries(symbol: string, tf: Timeframe): OHLCV[] {
    const s = this.series.get(`${symbol}|${tf}`);
    return s ? s.candles : [];
  }

  isStreaming(symbol?: string, tf?: Timeframe): boolean {
    const s = this.series.get(`${symbol || this.activeSymbol}|${tf || this.activeTf}`);
    return s ? s.streaming : true;
  }

  /** Recent live ticks for any symbol (real trades/quotes — feeds the scanner). */
  getRecentTicks(symbol: string, n = 60): { ts: number; price: number; vol: number }[] {
    const buf = this.tickBuffers.get(symbol);
    if (!buf) return [];
    return buf.slice(-n);
  }

  /** Number of live ticks currently buffered for a symbol. */
  tickCount(symbol: string): number {
    return this.tickBuffers.get(symbol)?.length ?? 0;
  }
}

/* Singleton exports */
export const finnhubTradeWS = new FinnhubTradeWS();
export const binanceStreamWS = new BinanceStreamWS();
export const coinbaseStreamWS = new CoinbaseTradeWS();
export const krakenStreamWS = new KrakenTradeWS();
export const twelvedataQuoteWS = new TwelveDataQuoteWS();
export const aggregator = new CandleAggregator();
