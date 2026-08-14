import { useEffect, useState, useRef, useCallback } from "react";
import { useTradingStore } from "@/stores/tradingStore";
import { fetchNewsGeneral, fetchNewsCompany, fetchNewsHackerNews } from "@/lib/dataProviders";
import { Newspaper, ExternalLink, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { NewsItem } from "@/types";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function SentimentBadge({ item }: { item: NewsItem }) {
  if (item.sentiment === "bullish") {
    return (
      <span className="flex items-center gap-0.5 text-[9px] font-mono font-semibold px-1 py-0.5 rounded bg-bull/15 text-bull border border-bull/25">
        <TrendingUp size={8} /> BULL
      </span>
    );
  }
  if (item.sentiment === "bearish") {
    return (
      <span className="flex items-center gap-0.5 text-[9px] font-mono font-semibold px-1 py-0.5 rounded bg-bear/15 text-bear border border-bear/25">
        <TrendingDown size={8} /> BEAR
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-[9px] font-mono font-semibold px-1 py-0.5 rounded bg-terminal-surface text-slate-500 border border-terminal-border">
      <Minus size={8} /> NEUTRAL
    </span>
  );
}

export default function NewsPanel() {
  const { activeSymbol, activeMarket, setNewsLoading } = useTradingStore();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"company" | "general">("general");
  const lastFetchRef = useRef<Record<string, number>>({});
  const cancelledRef = useRef(false);

  const load = useCallback(async (symbol: string, market: string) => {
    // Company news only makes sense for stock/ETF-like tickers
    const isStockLike = market === "stocks" || market === "indices";
    const key = isStockLike ? `company:${symbol}` : "general";

    // Throttle: never fetch the same key more than once per 4 minutes
    const now = Date.now();
    if (now - (lastFetchRef.current[key] || 0) < 4 * 60_000) return;
    lastFetchRef.current[key] = now;

    setLoading(true);
    setNewsLoading(true);
    try {
      if (isStockLike) {
        const company = await fetchNewsCompany(symbol);
        let general = await fetchNewsGeneral();
        // Finnhub quota'd or unreachable → keyless Hacker News keeps the feed alive
        if (general.length === 0) general = await fetchNewsHackerNews();
        const merged = [...company.slice(0, 8), ...general.slice(0, 10)];
        const seen = new Set<string>();
        const unique = merged.filter(n => (seen.has(n.id) ? false : (seen.add(n.id), true)));
        if (!cancelledRef.current) {
          setItems(unique);
          setMode("company");
        }
      } else {
        let general = await fetchNewsGeneral();
        if (general.length === 0) general = await fetchNewsHackerNews();
        if (!cancelledRef.current) {
          setItems(general);
          setMode("general");
        }
      }
    } catch {
      if (!cancelledRef.current) setItems([]);
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
        setNewsLoading(false);
      }
    }
  }, [setNewsLoading]);

  useEffect(() => {
    cancelledRef.current = false;
    load(activeSymbol, activeMarket);
    const iv = setInterval(() => load(activeSymbol, activeMarket), 5 * 60_000);
    return () => {
      cancelledRef.current = true;
      clearInterval(iv);
    };
  }, [activeSymbol, activeMarket, load]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border flex-none">
        <div className="flex items-center gap-2">
          <Newspaper size={12} className="text-brand-cyan" />
          <span className="text-xs font-mono font-semibold text-brand-cyan">
            {mode === "company" ? `${activeSymbol} NEWS` : "MARKET NEWS"}
          </span>
        </div>
        {loading ? (
          <Loader2 size={11} className="text-slate-500 animate-spin" />
        ) : (
          <span className="text-[9px] font-mono text-slate-600">Finnhub · Hacker News · live</span>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-4 text-center">
            <span className="text-xs font-mono text-slate-600">
              {loading ? "Loading headlines…" : "No headlines available right now."}
            </span>
          </div>
        ) : (
          items.map(n => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="block px-3 py-2.5 border-b border-terminal-border/50 hover:bg-terminal-surface/60 transition-colors group"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-200 leading-snug group-hover:text-brand-cyan transition-colors">
                    {n.headline}
                  </p>
                  {n.summary && (
                    <p className="text-[10px] font-mono text-slate-500 leading-snug mt-1 line-clamp-2">
                      {n.summary}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <SentimentBadge item={n} />
                    <span className="text-[9px] font-mono text-slate-600">{n.source}</span>
                    <span className="text-[9px] font-mono text-slate-700">·</span>
                    <span className="text-[9px] font-mono text-slate-600">{timeAgo(n.datetime)}</span>
                    <ExternalLink size={8} className="text-slate-700 group-hover:text-brand-cyan" />
                  </div>
                </div>
                {n.image && (
                  <img
                    src={n.image}
                    alt=""
                    loading="lazy"
                    className="w-10 h-10 rounded object-cover border border-terminal-border/50 flex-none"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
