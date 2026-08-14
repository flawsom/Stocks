import { useCallback, useEffect, useMemo, useState } from "react";
import { useTradingStore } from "@/stores/tradingStore";
import { aggregator } from "@/lib/realtime";
import { buildScanRow, sortScanRows, type ScanRow, type ScanSortKey } from "@/lib/scanner";
import { downloadCSV } from "@/lib/export";
import { getSymbolMeta } from "@/constants/config";
import { cn } from "@/lib/utils";
import { X, Download, Radar, Search, ArrowUp, ArrowDown, TrendingUp, TrendingDown } from "lucide-react";
import type { MarketType } from "@/types";

const MARKETS: { id: MarketType | "all"; label: string; color: string }[] = [
  { id: "all", label: "ALL", color: "#16a034" },
  { id: "stocks", label: "STOCKS", color: "#16a034" },
  { id: "forex", label: "FOREX", color: "#0a9c36" },
  { id: "crypto", label: "CRYPTO", color: "#a16207" },
  { id: "indices", label: "INDICES", color: "#b45309" },
  { id: "futures", label: "FUTURES", color: "#7c3aed" },
];

const COLUMNS: { key: ScanSortKey; label: string; align?: "right" }[] = [
  { key: "score", label: "SCORE" },
  { key: "price", label: "LAST", align: "right" },
  { key: "changePct", label: "CHG%", align: "right" },
  { key: "momentum20", label: "MOM 20T", align: "right" },
  { key: "swing", label: "SWING", align: "right" },
  { key: "rsi", label: "RSI", align: "right" },
  { key: "flow", label: "FLOW", align: "right" },
];

function fmt(v: number, digits = 2): string {
  return v.toFixed(digits);
}

function fmtPrice(v: number): string {
  if (v <= 0) return "—";
  if (v < 1) return v.toFixed(5);
  if (v < 100) return v.toFixed(3);
  return v.toFixed(2);
}

export default function MarketScanner() {
  const { watchlist, setActiveSymbol, setActiveMarket, setScannerOpen } = useTradingStore();

  const [market, setMarket] = useState<MarketType | "all">("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ScanSortKey>("score");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [tick, setTick] = useState(0);
  const [rows, setRows] = useState<ScanRow[]>([]);

  // Live refresh: recompute scan rows from real tick buffers every 2.5s
  useEffect(() => {
    const compute = () => {
      const items = useTradingStore.getState().watchlist.filter(w => w.price > 0);
      setRows(items.map(item => buildScanRow(item, aggregator.getRecentTicks(item.symbol, 60))));
    };
    compute();
    const iv = setInterval(compute, 2500);
    const ticker = setInterval(() => setTick(t => t + 1), 1000);
    return () => { clearInterval(iv); clearInterval(ticker); };
  }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (market !== "all") list = list.filter(r => r.market === market);
    if (query.trim()) {
      const q = query.trim().toUpperCase();
      list = list.filter(r => r.symbol.toUpperCase().includes(q) || r.name.toUpperCase().includes(q));
    }
    return sortScanRows(list, sortKey, sortDir);
  }, [rows, market, query, sortKey, sortDir]);

  const headerClick = (key: ScanSortKey) => {
    if (key === sortKey) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(-1); }
  };

  const openSymbol = (symbol: string) => {
    const meta = getSymbolMeta(symbol);
    if (meta) {
      setActiveMarket(meta.market);
      setActiveSymbol(symbol);
      setScannerOpen(false);
    }
  };

  const exportCSV = useCallback(() => {
    downloadCSV(
      `omegatrade-scan-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`,
      [
        ["Symbol", "Name", "Market", "Last", "Change", "ChangePct", "Momentum20", "Swing", "RSI", "Flow", "Score", "Ticks"],
        ...filtered.map(r => [
          r.symbol, r.name, r.market, r.price, r.change, r.changePct,
          r.momentum20, r.swing, r.rsi ?? "", r.flow, r.score, r.ticks,
        ]),
      ]
    );
  }, [filtered]);

  // Keyboard: Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setScannerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setScannerOpen]);

  const liveCount = rows.filter(r => r.ticks > 0).length;

  return (
    <div className="fixed inset-0 z-50 bg-terminal-bg backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex-none border-b border-terminal-border bg-terminal-bg/95 px-5 h-14 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Radar size={16} className="text-brand-cyan animate-pulse-glow" />
          <span className="text-sm font-mono font-bold text-brand-cyan text-glow-cyan">LIVE MARKET SCANNER</span>
          <span className="flex items-center gap-1.5 text-[10px] font-mono text-bull">
            <span className="w-1.5 h-1.5 rounded-full bg-bull animate-pulse-glow" />
            {liveCount}/{rows.length} symbols streaming · {tick}s
          </span>
        </div>

        {/* Market filter */}
        <div className="flex items-center gap-0.5">
          {MARKETS.map(m => (
            <button
              key={m.id}
              onClick={() => setMarket(m.id)}
              className={cn(
                "px-2.5 py-1.5 rounded text-[10px] font-mono font-semibold border transition-all",
                market === m.id
                  ? "bg-terminal-surface text-slate-200"
                  : "border-terminal-border text-slate-600 hover:text-slate-400"
              )}
              style={market === m.id ? { color: m.color, borderColor: `${m.color}55`, boxShadow: `0 0 8px ${m.color}15` } : {}}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative flex items-center">
            <Search size={12} className="absolute left-2.5 text-slate-600" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter symbol…"
              className="w-40 pl-8 pr-3 py-1.5 rounded border border-terminal-border bg-terminal-surface text-xs font-mono text-slate-200 placeholder:text-slate-600 outline-none focus:border-brand-cyan/50"
            />
          </div>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-terminal-border text-[11px] font-mono text-slate-400 hover:text-brand-cyan hover:border-brand-cyan/40 transition-colors"
          >
            <Download size={11} /> CSV
          </button>
          <button
            onClick={() => setScannerOpen(false)}
            className="flex items-center gap-1 px-3 py-1.5 rounded border border-terminal-border text-[11px] font-mono text-slate-500 hover:text-bear hover:border-bear/40 transition-colors"
          >
            <X size={11} /> ESC
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-5 py-3">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-terminal-bg/98">
              <th className="py-2 pr-3 text-[10px] font-mono text-slate-500 uppercase tracking-wider">Symbol</th>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  onClick={() => headerClick(col.key)}
                  className={cn(
                    "py-2 px-2 text-[10px] font-mono uppercase tracking-wider cursor-pointer select-none hover:text-slate-300 transition-colors whitespace-nowrap",
                    col.align === "right" ? "text-right" : "text-left",
                    sortKey === col.key ? "text-brand-cyan" : "text-slate-500"
                  )}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {sortKey === col.key && (sortDir === -1 ? <ArrowDown size={9} /> : <ArrowUp size={9} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const up = r.changePct >= 0;
              const meta = getSymbolMeta(r.symbol);
              return (
                <tr
                  key={r.symbol}
                  onClick={() => openSymbol(r.symbol)}
                  className="border-t border-terminal-border/30 hover:bg-terminal-surface/60 cursor-pointer transition-colors group"
                >
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-slate-200 group-hover:text-brand-cyan transition-colors">{r.symbol}</span>
                      <span
                        className="text-[8px] font-mono px-1 py-0.5 rounded border hidden lg:inline"
                        style={{
                          color: meta?.market === "stocks" ? "#16a034" : meta?.market === "forex" ? "#0a9c36" : meta?.market === "crypto" ? "#a16207" : meta?.market === "indices" ? "#b45309" : "#7c3aed",
                          borderColor: "currentColor",
                          opacity: 0.6,
                        }}
                      >
                        {meta?.market === "stocks" ? "STK" : meta?.market === "forex" ? "FX" : meta?.market === "crypto" ? "CRY" : meta?.market === "indices" ? "IND" : "FUT"}
                      </span>
                    </div>
                    <div className="text-[9px] font-mono text-slate-600 truncate max-w-40">{r.name}</div>
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs font-mono font-bold px-1.5 py-0.5 rounded",
                        r.score >= 30 ? "text-bull bg-bull/10" : r.score <= -30 ? "text-bear bg-bear/10" : "text-slate-500 bg-terminal-surface"
                      )}
                    >
                      {r.score >= 30 && <TrendingUp size={9} />}
                      {r.score <= -30 && <TrendingDown size={9} />}
                      {r.score >= 0 ? "+" : ""}{fmt(r.score, 0)}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <span className={cn("text-xs font-mono font-semibold", up ? "text-bull" : "text-bear")}>
                      {fmtPrice(r.price)}
                    </span>
                  </td>
                  <td className={cn("py-1.5 px-2 text-right text-xs font-mono font-bold", up ? "text-bull" : "text-bear")}>
                    {up ? "▲" : "▼"}{Math.abs(r.changePct).toFixed(2)}%
                  </td>
                  <td className={cn("py-1.5 px-2 text-right text-xs font-mono", r.momentum20 >= 0 ? "text-bull/80" : "text-bear/80")}>
                    {r.momentum20 >= 0 ? "+" : ""}{fmt(r.momentum20)}%
                  </td>
                  <td className="py-1.5 px-2 text-right text-xs font-mono text-slate-400">{fmt(r.swing)}%</td>
                  <td className="py-1.5 px-2 text-right">
                    {r.rsi !== null ? (
                      <span className={cn(
                        "text-xs font-mono font-semibold",
                        r.rsi > 70 ? "text-bear" : r.rsi < 30 ? "text-bull" : "text-slate-400"
                      )}>
                        {fmt(r.rsi, 0)}
                      </span>
                    ) : (
                      <span className="text-xs font-mono text-slate-600">—</span>
                    )}
                  </td>
                  <td className={cn("py-1.5 px-2 text-right text-xs font-mono", r.flow >= 0.15 ? "text-bull" : r.flow <= -0.15 ? "text-bear" : "text-slate-500")}>
                    {r.flow >= 0 ? "+" : ""}{fmt(r.flow)}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr className="pointer-events-none select-none">
                <td colSpan={COLUMNS.length + 1} className="py-10 text-center text-xs font-mono text-slate-600">
                  No live rows for this filter yet — live quotes arrive within a minute (mesh) and tick-derived
                  metrics as streams accumulate. Switch filters or wait a few seconds.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer note */}
      <div className="flex-none border-t border-terminal-border px-5 py-2 flex items-center justify-between text-[9px] font-mono text-slate-600">
        <span>
          Every column is computed from the live tick stream (Finnhub / Binance / TwelveData) — momentum is a 20-tick log return, RSI is tick-price RSI(14), flow is signed tick volume. No simulated values.
        </span>
        <span>{filtered.length} symbols · {new Date().toLocaleTimeString("en-US", { hour12: false })}</span>
      </div>
    </div>
  );
}
