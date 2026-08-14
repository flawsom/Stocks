import { useTradingStore } from "@/stores/tradingStore";
import { TIMEFRAMES, getSymbolsByMarket, ALL_SYMBOLS } from "@/constants/config";
import { Wifi, WifiOff, Clock, Zap, Search, X, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import type { MarketType } from "@/types";

// Editorial rule: one accent. Every active market tab shares the single
// highlighter-green accent instead of five competing neon hues.
const MARKET_TABS: { id: MarketType; label: string; color: string }[] = [
  { id: "stocks", label: "STOCKS", color: "#16a034" },
  { id: "forex", label: "FOREX", color: "#16a034" },
  { id: "crypto", label: "CRYPTO", color: "#16a034" },
  { id: "indices", label: "INDICES", color: "#16a034" },
  { id: "futures", label: "FUTURES", color: "#16a034" },
];

function marketSessionStatus(market: string): { open: boolean; label: string } {
  if (market === "crypto") return { open: true, label: "24/7" };
  if (market === "forex") return { open: true, label: "24/5" };
  // Stocks / indices / futures: 09:30–16:00 ET, Mon–Fri
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  const open = day >= 1 && day <= 5 && mins >= 570 && mins <= 960;
  return { open, label: open ? "SESSION OPEN" : "SESSION CLOSED" };
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  const lastTick = useTradingStore(s => s.lastTick);
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const nyTime = new Date(time.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const londonTime = new Date(time.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const tokyoTime = new Date(time.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));

  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  // Freshness of the last real market heartbeat (WS trade/quote OR REST quote)
  const ageS = lastTick > 0 ? Math.max(0, (time.getTime() - lastTick) / 1000) : -1;
  const tickColor = ageS < 0 ? "text-slate-700" : ageS < 5 ? "text-bull" : ageS < 20 ? "text-predict" : "text-bear";

  return (
    <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
      <Clock size={11} className="text-slate-600" />
      <span>NY {fmt(nyTime)}</span>
      <span>LDN {fmt(londonTime)}</span>
      <span>TYO {fmt(tokyoTime)}</span>
      <span className={cn(tickColor, "flex items-center gap-1")} title="Seconds since the last real market heartbeat">
        <Zap size={10} />
        {ageS < 0 ? "T—" : ageS < 1 ? `T ${(ageS * 10).toFixed(0)}` : `T ${Math.round(ageS)}s`}
      </span>
    </div>
  );
}

function TickerTape() {
  const { watchlist } = useTradingStore();
  const items = watchlist.filter(w => w.price > 0);

  if (items.length === 0) return null;

  const renderItem = (item: typeof items[0], key: string) => {
    const isUp = item.changePct >= 0;
    const color = isUp ? "#0a9c36" : "#d43b36";
    return (
      <span key={key} className="flex items-center gap-2 mr-8 shrink-0">
        <span className="text-slate-400">{item.symbol}</span>
        <span className="font-semibold" style={{ color }}>
          {item.price < 1 ? item.price.toFixed(6) : item.price < 100 ? item.price.toFixed(4) : item.price.toFixed(2)}
        </span>
        <span style={{ color, fontSize: 10 }}>
          {isUp ? "▲" : "▼"} {Math.abs(item.changePct).toFixed(2)}%
        </span>
      </span>
    );
  };

  return (
    <div className="relative overflow-hidden border-b border-terminal-border bg-terminal-bg/50"
         style={{ height: 28 }}>
      <div className="flex items-center h-full">
        <div className="flex ticker-tape" style={{ whiteSpace: "nowrap" }}>
          {items.map((item, i) => renderItem(item, `a-${i}`))}
          {items.map((item, i) => renderItem(item, `b-${i}`))}
        </div>
      </div>
    </div>
  );
}

function SymbolSearch() {
  const { setActiveMarket, setActiveSymbol } = useTradingStore();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const results = query.trim().length > 0
    ? ALL_SYMBOLS
        .filter(s => {
          const q = query.trim().toUpperCase();
          return s.symbol.toUpperCase().includes(q) || s.name.toUpperCase().includes(q);
        })
        .slice(0, 8)
    : [];

  const select = (symbol: string, market: MarketType) => {
    setActiveMarket(market);
    setActiveSymbol(symbol);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative flex items-center h-full border-r border-terminal-border px-2">
      <Search size={11} className="text-slate-600 mr-1.5 shrink-0" />
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search all markets…"
        className="w-28 bg-transparent text-xs font-mono text-slate-300 placeholder:text-slate-600 outline-none"
      />
      {query && (
        <button onClick={() => { setQuery(""); }} className="ml-1 text-slate-600 hover:text-slate-300">
          <X size={11} />
        </button>
      )}
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 glass-panel overflow-hidden max-h-72 overflow-y-auto">
          {results.map(s => (
            <button
              key={s.symbol}
              onClick={() => select(s.symbol, s.market)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-terminal-surface text-left"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-mono font-semibold text-slate-200">{s.symbol}</span>
                <span className="text-[10px] font-mono text-slate-500 truncate">{s.name}</span>
              </div>
              <span className={cn(
                "text-[9px] font-mono px-1.5 py-0.5 rounded border",
                s.market === "stocks" && "text-brand-cyan border-brand-cyan/30",
                s.market === "forex" && "text-bull border-bull/30",
                s.market === "crypto" && "text-predict border-predict/30",
                s.market === "indices" && "text-editorial-verdant border-editorial-verdant/30",
                s.market === "futures" && "text-neural border-neural/30",
              )}>
                {s.market.toUpperCase()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const {
    activeMarket, activeSymbol, activeTimeframe, isConnected,
    setActiveMarket, setActiveSymbol, setActiveTimeframe, candles, watchlist,
    candleSource
  } = useTradingStore();

  const symbols = getSymbolsByMarket(activeMarket);
  const liveData = watchlist.find(w => w.symbol === activeSymbol);
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;

  const currentPrice = liveData?.price || lastCandle?.close || 0;
  const change = liveData?.change || 0;
  const changePct = liveData?.changePct || 0;
  const isUp = changePct >= 0;

  return (
    <header className="flex-none bg-terminal-bg border-b border-terminal-border">
      {/* Ticker tape */}
      <TickerTape />

      {/* Main header */}
      <div className="flex items-center gap-0 h-12">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 border-r border-terminal-border h-full shrink-0">
          <div className="w-7 h-7 rounded bg-brand-cyan/10 border border-brand-cyan/30 flex items-center justify-center">
            <Zap size={14} className="text-brand-cyan" />
          </div>
          <span className="text-sm font-mono font-bold text-brand-cyan text-glow-cyan">
            Ω ULTRA
          </span>
        </div>

        {/* Market tabs */}
        <div className="flex h-full border-r border-terminal-border">
          {MARKET_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveMarket(tab.id);
                const syms = getSymbolsByMarket(tab.id);
                if (syms.length > 0) setActiveSymbol(syms[0].symbol);
              }}
              className={cn(
                "px-3 h-full text-xs font-mono font-semibold tracking-wider border-r border-terminal-border/50",
                "hover:bg-terminal-surface/50 transition-all duration-150",
                activeMarket === tab.id
                  ? "bg-terminal-surface/80"
                  : "text-slate-500"
              )}
              style={activeMarket === tab.id ? { color: tab.color, borderBottom: `2px solid ${tab.color}`, boxShadow: `inset 0 -2px 8px ${tab.color}20` } : {}}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Symbol selector */}
        <div className="flex items-center gap-0 h-full border-r border-terminal-border overflow-x-auto">
          {symbols.map(sym => (
            <button
              key={sym.symbol}
              onClick={() => setActiveSymbol(sym.symbol)}
              className={cn(
                "px-3 h-full text-xs font-mono whitespace-nowrap shrink-0 border-r border-terminal-border/30",
                "hover:bg-terminal-surface/40 transition-all duration-150",
                activeSymbol === sym.symbol
                  ? "text-brand-cyan bg-terminal-surface/60"
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              {sym.symbol}
            </button>
          ))}
        </div>

        {/* Symbol search */}
        <SymbolSearch />

        {/* Price display */}
        <div className="flex items-center gap-4 px-4 border-r border-terminal-border h-full shrink-0">
          {currentPrice > 0 ? (
            <>
              <span className={cn(
                "text-xl font-mono font-bold",
                isUp ? "text-bull text-glow-green" : "text-bear text-glow-red"
              )}>
                {currentPrice < 1 ? currentPrice.toFixed(6) :
                 currentPrice < 100 ? currentPrice.toFixed(4) :
                 currentPrice.toFixed(2)}
              </span>
              <div className="flex flex-col">
                <span className={cn(
                  "text-xs font-mono font-semibold",
                  isUp ? "text-bull" : "text-bear"
                )}>
                  {isUp ? "▲" : "▼"} {Math.abs(changePct).toFixed(3)}%
                </span>
                <span className={cn("text-xs font-mono", isUp ? "text-bull/70" : "text-bear/70")}>
                  {isUp ? "+" : ""}{change.toFixed(change < 1 ? 5 : 2)}
                </span>
              </div>
            </>
          ) : (
            <span className="text-sm font-mono text-slate-600">Loading...</span>
          )}
        </div>

        {/* Timeframe */}
        <div className="flex items-center gap-1 px-3 h-full border-r border-terminal-border shrink-0">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              onClick={() => setActiveTimeframe(tf.value)}
              className={cn(
                "px-2 py-1 text-xs font-mono rounded transition-all duration-150",
                activeTimeframe === tf.value
                  ? "btn-terminal-active"
                  : "btn-terminal"
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Right: scanner + session + source + clock + connection */}
        <div className="ml-auto flex items-center gap-4 px-4 shrink-0">
          <button
            onClick={() => useTradingStore.getState().setScannerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-mono font-semibold border border-brand-cyan/40 text-brand-cyan hover:bg-brand-cyan/10 transition-colors shadow-cyan-glow"
          >
            <Radar size={12} /> SCANNER
          </button>
          <div className={cn(
            "flex items-center gap-1.5 text-xs font-mono",
            marketSessionStatus(activeMarket).open ? "text-bull/80" : "text-slate-600"
          )}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: marketSessionStatus(activeMarket).open ? "#0a9c36" : "#93a08f" }} />
            <span>{marketSessionStatus(activeMarket).label}</span>
          </div>

          {candleSource && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-brand-cyan/80">
              <Zap size={11} />
              <span>{candleSource.provider === "live-aggregate" ? "STREAM" : candleSource.provider === "binance-rest" ? "BINANCE" : candleSource.provider === "twelvedata-rest" ? "TWELVEDATA" : candleSource.provider === "alpha-vantage" ? "ALPHAVANTAGE" : candleSource.provider === "polygon" ? "POLYGON" : String(candleSource.provider).toUpperCase()}</span>
              {candleSource.streaming && <span className="text-slate-500">· live-built</span>}
            </div>
          )}

          <LiveClock />
          <div className={cn(
            "flex items-center gap-1.5 text-xs font-mono",
            isConnected ? "text-bull" : "text-bear"
          )}>
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span>{isConnected ? "LIVE" : "OFFLINE"}</span>
            {isConnected && (
              <div className="w-1.5 h-1.5 rounded-full bg-bull animate-pulse-glow" />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
