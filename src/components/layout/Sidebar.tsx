import { useTradingStore } from "@/stores/tradingStore";
import { getSymbolsByMarket } from "@/constants/config";
import WatchList from "@/components/features/WatchList";
import { cn } from "@/lib/utils";

export default function Sidebar() {
  const { activeMarket, setActiveMarket, setActiveSymbol } = useTradingStore();

  const markets = [
    { id: "stocks" as const, label: "STK" },
    { id: "forex" as const, label: "FX" },
    { id: "crypto" as const, label: "CRYP" },
    { id: "indices" as const, label: "IND" },
    { id: "futures" as const, label: "FUT" },
  ];

  return (
    <aside className="w-52 flex flex-col bg-terminal-bg border-r border-terminal-border flex-none">
      {/* Market switcher */}
      <div className="grid grid-cols-5 border-b border-terminal-border">
        {markets.map(m => (
          <button
            key={m.id}
            onClick={() => {
              setActiveMarket(m.id);
              const syms = getSymbolsByMarket(m.id);
              if (syms.length > 0) setActiveSymbol(syms[0].symbol);
            }}
            className={cn(
              "py-2 text-xs font-mono font-semibold border-r border-terminal-border/50 last:border-0",
              "hover:bg-terminal-surface/50 transition-colors",
              activeMarket === m.id ? "text-brand-cyan bg-terminal-surface/60" : "text-slate-600"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Watchlist header */}
      <div className="px-3 py-2 border-b border-terminal-border flex items-center justify-between">
        <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">Watchlist</span>
        <div className="live-indicator">
          <div className="indicator-dot bg-bull" />
          <span className="text-slate-600">Live</span>
        </div>
      </div>

      {/* Watchlist */}
      <div className="flex-1 overflow-hidden">
        <WatchList />
      </div>
    </aside>
  );
}
