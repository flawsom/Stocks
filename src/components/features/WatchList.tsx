import { useTradingStore } from "@/stores/tradingStore";
import { getSymbolsByMarket } from "@/constants/config";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WatchlistItem } from "@/types";

function PriceRow({ item, isActive, onClick }: {
  item: WatchlistItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const isUp = item.changePct >= 0;
  const priceColor = isUp ? "#0a9c36" : "#d43b36";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left",
        "border-b border-terminal-border/50 hover:bg-terminal-surface/80",
        "transition-all duration-150 cursor-pointer group",
        isActive && "bg-terminal-surface/90 border-l-2 border-l-brand-cyan"
      )}
      style={isActive ? { boxShadow: "inset 0 0 20px rgba(22,160,52,0.06)" } : {}}
    >
      <div className="flex flex-col min-w-0">
        <span className={cn(
          "text-xs font-mono font-semibold truncate",
          isActive ? "text-brand-cyan text-glow-cyan" : "text-slate-200 group-hover:text-slate-100"
        )}>
          {item.symbol}
        </span>
        <span className="text-xs font-mono text-slate-600 truncate" style={{ fontSize: 10 }}>
          {item.name}
        </span>
      </div>
      <div className="flex flex-col items-end shrink-0">
        {item.price > 0 ? (
          <>
            <span
              className="text-xs font-mono font-semibold"
              style={{ color: priceColor }}
            >
              {item.price < 1 ? item.price.toFixed(6) :
               item.price < 100 ? item.price.toFixed(4) :
               item.price.toFixed(2)}
            </span>
            <div className="flex items-center gap-0.5">
              {isUp ? (
                <TrendingUp size={9} style={{ color: priceColor }} />
              ) : (
                <TrendingDown size={9} style={{ color: priceColor }} />
              )}
              <span
                className="font-mono font-medium"
                style={{ fontSize: 10, color: priceColor }}
              >
                {isUp ? "+" : ""}{item.changePct.toFixed(2)}%
              </span>
            </div>
          </>
        ) : (
          <span
            className="text-xs font-mono text-slate-600"
            title={item.market === "futures"
              ? "Real futures quotes come from Yahoo ES=F / CL=F relays (or a free TwelveData key) — free providers that map ES/CL/NG to unrelated stocks are never used, so nothing is shown rather than a wrong price"
              : "Awaiting the next live quote"}
          >
            —
          </span>
        )}
      </div>
    </button>
  );
}

export default function WatchList() {
  const { activeMarket, activeSymbol, watchlist, setActiveSymbol } = useTradingStore();
  const symbols = getSymbolsByMarket(activeMarket);

  const handleSelectSymbol = (symbol: string) => {
    setActiveSymbol(symbol);
  };

  // Merge live watchlist data with static symbols
  const displayItems = symbols.map(s => {
    const live = watchlist.find(w => w.symbol === s.symbol);
    return live || {
      symbol: s.symbol,
      name: s.name,
      market: s.market,
      price: 0, change: 0, changePct: 0, volume: 0, high24h: 0, low24h: 0,
    };
  });

  const gainers = [...displayItems].sort((a, b) => b.changePct - a.changePct).slice(0, 3);
  const losers = [...displayItems].sort((a, b) => a.changePct - b.changePct).slice(0, 3);

  return (
    <div className="flex flex-col h-full">
      {/* Gainers/Losers mini */}
      <div className="px-3 py-2 border-b border-terminal-border">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs font-mono text-slate-600 mb-1" style={{ fontSize: 10 }}>TOP GAINERS</div>
            {gainers.filter(g => g.changePct > 0).slice(0, 2).map(g => (
              <div key={g.symbol} className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">{g.symbol}</span>
                <span className="text-bull">+{g.changePct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs font-mono text-slate-600 mb-1" style={{ fontSize: 10 }}>TOP LOSERS</div>
            {losers.filter(l => l.changePct < 0).slice(0, 2).map(l => (
              <div key={l.symbol} className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">{l.symbol}</span>
                <span className="text-bear">{l.changePct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Symbol list */}
      <div className="flex-1 overflow-y-auto">
        {displayItems.map(item => (
          <PriceRow
            key={item.symbol}
            item={item}
            isActive={item.symbol === activeSymbol}
            onClick={() => handleSelectSymbol(item.symbol)}
          />
        ))}
      </div>
    </div>
  );
}
