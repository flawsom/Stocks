import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { getSymbolsByMarket } from "@/constants/config";
import type { MarketType, MarketSymbol } from "@/types";

/* ────────────────────────────────────────────────────────────────
 * OMEGATRADE ULTRA — Market guides (programmatic SEO hubs)
 *
 * One real, standalone page per asset class. Every page has unique
 * editorial copy (no templated mad-libs), a BreadcrumbList + WebPage
 * JSON-LD block, self-canonical URL, per-page meta, and hub/spoke
 * internal links to the other guides and the terminal.
 * ──────────────────────────────────────────────────────────────── */

export interface MarketGuide {
  slug: string;
  market: MarketType;
  label: string;
  micro: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  lede: string[];
  sections: { heading: string; body: string[] }[];
  sources: string[];
  tagline: string; // short link-blurb used on the landing hub
}

export const MARKET_GUIDES: MarketGuide[] = [
  {
    slug: "stocks",
    market: "stocks",
    label: "US Stocks",
    micro: "The Coverage — US Equities",
    h1: "Live stock prices, free.",
    metaTitle: "Free Real-Time Stock Prices & Charts — OmegaTrade Ultra",
    metaDescription:
      "Live US stock prices for AAPL, NVDA, TSLA, MSFT and more — tick-by-tick quotes, real intraday charts and AI forecasts. Free, no account, no cost.",
    lede: [
      "OmegaTrade Ultra streams US equities tick-by-tick straight from the Finnhub trade WebSocket. Every quote, candle and order book is real — there is no mock data anywhere in the terminal, and every figure on this page is served by the same live feed store the app uses.",
      "No account, no subscription, no install. The whole terminal runs in your browser and stays free because every data source it uses is a free public provider.",
    ],
    sections: [
      {
        heading: "Which stocks are covered",
        body: [
          "Eighteen blue-chip symbols across the sectors retail traders watch most: mega-cap technology (AAPL, MSFT, NVDA, AMD, AVGO, CRM, ORCL), consumer and media (AMZN, TSLA, NFLX, WMT, KO), financials (JPM, BAC, V) and energy (XOM). Each symbol streams a live quote, a real intraday candle series from 1-minute up to 1-day, an order book where the venue publishes one, and headline news with sentiment tagging.",
          "Click any symbol in the terminal to open its full desk — live tape, chart, technical indicators, and the AI forecast panel.",
        ],
      },
      {
        heading: "How the live feed works",
        body: [
          "The primary stream is Finnhub's trade WebSocket, which pushes real executions as they print. When a source is rate-limited or unreachable, the terminal says so and fails over to the next live provider in the mesh — Polygon and the Yahoo relays — rather than freezing or guessing a number. The fastest valid quote wins.",
        ],
      },
      {
        heading: "Paper trading and forecasts",
        body: [
          "Every stock desk includes the built-in paper-trading engine, so you can test entries and exits with live prices and zero risk. The 7-model AI ensemble produces forecasts with uncertainty bands, and the terminal keeps an accuracy ledger of its own predictions — it retrains on its own misses and withholds signals when confidence is too low.",
        ],
      },
    ],
    sources: ["Finnhub trade WebSocket (live ticks)", "Polygon REST failover", "Yahoo Finance relays", "Free public keys only — optional personal keys raise your rate limits"],
    tagline: "Tick-by-tick quotes, real charts and AI forecasts for 18 blue-chip US stocks.",
  },
  {
    slug: "crypto",
    market: "crypto",
    label: "Crypto",
    micro: "The Coverage — Digital Assets",
    h1: "Crypto prices, 24/7.",
    metaTitle: "Free Real-Time Crypto Prices & Charts — 24/7 — OmegaTrade Ultra",
    metaDescription:
      "Live crypto prices for BTC, ETH, SOL, XRP and more — streamed 24/7 from independent venues with AI forecasts. Free, no account, no geo-blocks.",
    lede: [
      "Fourteen crypto pairs, streamed around the clock from independent venues so no single exchange can take the feed down — and none are geo-locked out. Bitcoin, Ethereum, Solana and the rest of the majors trade 24/7, and so does this desk.",
      "Every price is real and current. The crypto desk reads from three live WebSockets plus an eighteen-provider REST mesh, racing sources and taking the fastest valid print.",
    ],
    sections: [
      {
        heading: "Which pairs are covered",
        body: [
          "BTC/USDT and ETH/USDT lead the desk, followed by SOL, BNB, XRP, ADA, DOGE, AVAX, LTC, LINK, DOT, SUI, NEAR and ARB — fourteen pairs in total. Each streams a live price, real kline candles from 1-minute to 1-day, and where the venue publishes depth, the order book.",
        ],
      },
      {
        heading: "Why the mesh matters",
        body: [
          "The terminal aggregates independent venues — Kraken, Coinbase, OKX and Binance's public market-data domain among them — through separate WebSockets and a wide REST mesh. If one venue rate-limits or blocks a region, the others keep the feed live. The app never falls back to a stale or synthetic print; when a source stops responding it is flagged and bypassed.",
        ],
      },
      {
        heading: "24/7 forecasting",
        body: [
          "Unlike equities, crypto never sleeps, so the AI forecast ensemble runs continuously. Uncertainty bands and the circuit breaker work the same way: if the ensemble's confidence drops below its threshold it withholds the signal instead of guessing.",
        ],
      },
    ],
    sources: ["Kraken WebSocket", "Coinbase WebSocket", "OKX WebSocket", "Binance public market-data API", "18-provider REST quote mesh"],
    tagline: "Fourteen pairs streamed 24/7 from independent venues with AI forecasts.",
  },
  {
    slug: "forex",
    market: "forex",
    label: "Forex",
    micro: "The Coverage — Currency Pairs",
    h1: "Forex rates, live.",
    metaTitle: "Free Live Forex Rates & Charts — Major & Cross Pairs",
    metaDescription:
      "Live forex rates for EUR/USD, GBP/USD, USD/JPY and more — keyless multi-provider quotes refreshed every few seconds, with AI forecasts. Free.",
    lede: [
      "Twelve major and cross currency pairs, quoted to five decimals and refreshed every few seconds — through a keyless multi-provider chain that mixes er-api rates, official ECB fixings and AlphaVantage FX. No API key is required to start trading the desk.",
    ],
    sections: [
      {
        heading: "Which pairs are covered",
        body: [
          "The desk covers the majors and the crosses traders actually watch: EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CHF, USD/CAD, NZD/USD, EUR/GBP, EUR/JPY, GBP/JPY, AUD/JPY and EUR/CHF. Each pair streams a live rate, intraday candles and the same technical and AI tools as every other market.",
        ],
      },
      {
        heading: "A keyless provider chain",
        body: [
          "Rates flow through a fallback chain rather than a single point of failure: er-api serves the real-time stream, ECB fixings anchor the daily reference rates, and AlphaVantage FX backs the chain up. When one provider rate-limits, the next live source takes over — the price you see is always the best available live print.",
        ],
      },
      {
        heading: "Why five decimals matter",
        body: [
          "Pip movement lives in the fourth and fifth decimals, so the forex desk preserves full precision in its quotes, charts and forecasts — a pip-sized move is visible instead of being rounded away.",
        ],
      },
    ],
    sources: ["er-api real-time rates", "European Central Bank daily fixings", "AlphaVantage FX fallback", "Refreshed every few seconds"],
    tagline: "Twelve major and cross pairs, keyless, quoted to the pip and refreshed every few seconds.",
  },
  {
    slug: "indices",
    market: "indices",
    label: "Indices",
    micro: "The Coverage — Index Levels",
    h1: "Real index levels, live.",
    metaTitle: "Live Index Levels — S&P 500, Nasdaq, Dow, VIX",
    metaDescription:
      "Real index levels for the S&P 500, Nasdaq Composite, Dow, Russell 2000 and VIX — plus SPY, QQQ, DIA and more. Live, free, no account needed.",
    lede: [
      "True index levels, not ETF proxies. The indices desk reads the actual prints for the S&P 500, Nasdaq Composite, Dow Jones, Russell 2000 and the VIX through the Yahoo relay, which maps each ticker to the real index series.",
    ],
    sections: [
      {
        heading: "Which indices are covered",
        body: [
          "Five headline levels — ^GSPC (S&P 500), ^IXIC (Nasdaq Composite), ^DJI (Dow), ^RUT (Russell 2000) and ^VIX (the volatility 'fear gauge') — stream live alongside the index-tracking ETFs that mirror them: SPY, QQQ, DIA, IWM, VOO and VTI.",
        ],
      },
      {
        heading: "Levels, not approximations",
        body: [
          "Because the relay maps to the true index series, the S&P 500 figure you see is the actual index level, not a SPY stand-in. That matters for anyone tracking the broad market or the VIX's volatility regime on live data.",
        ],
      },
      {
        heading: "Same tools, same forecast engine",
        body: [
          "Each index and ETF opens the full terminal desk — live tape, candles, technical analysis and the AI ensemble — so you can compare the real index against its tracking ETF in real time.",
        ],
      },
    ],
    sources: ["Yahoo Finance relay (true index prints)", "Finnhub + Polygon equity feeds for ETFs", "Live WebSockets on every symbol"],
    tagline: "True S&P 500, Nasdaq, Dow, Russell 2000 and VIX levels — not ETF proxies.",
  },
  {
    slug: "futures",
    market: "futures",
    label: "Futures",
    micro: "The Coverage — Futures Contracts",
    h1: "Futures prices, real contracts.",
    metaTitle: "Live Futures Prices — ES, CL, NG, Metals & Grains",
    metaDescription:
      "Live futures prices for E-mini S&P 500, crude oil, natural gas, gold, silver and grains — real contracts via Finnhub. Free, no account, no cost.",
    lede: [
      "Thirteen futures contracts across the financials, energy, metals, softs and grains complexes — served by real contract roots so the terminal never labels a stock as a futures price.",
    ],
    sections: [
      {
        heading: "Which contracts are covered",
        body: [
          "The desk streams the E-mini S&P 500 (ES), crude oil (CL), natural gas (NG), RBOB gasoline (RB), Brent (BZ), silver (SI), copper (HG), micro gold (MGC), soybeans (ZS), soybean meal (ZM), coffee (KC), sugar (SB) and feeder cattle (GF) — the contracts day traders actually follow.",
        ],
      },
      {
        heading: "Real roots, honest labels",
        body: [
          "Each contract maps to its real underlying on Finnhub's quote feed, and the UI labels markets and symbols truthfully. There is no symbol confusion, no ETF masquerading as a futures price, and no fabricated tick.",
        ],
      },
      {
        heading: "Intraday history that stays free",
        body: [
          "Candle history for futures comes through the TwelveData free tier, the only free source the app relies on for real futures candles, alongside the live Finnhub stream — so the desk works keyless out of the box.",
        ],
      },
    ],
    sources: ["Finnhub REST quotes (real contract roots)", "TwelveData free tier for futures candles", "Live polling under the free-plan budget"],
    tagline: "E-mini S&P, crude, gold, silver, grains and softs on real contract roots.",
  },
];

export const MARKET_LINKS: { slug: string; label: string; tagline: string }[] = MARKET_GUIDES.map((g) => ({
  slug: g.slug,
  label: g.label,
  tagline: g.tagline,
}));

const SITE_URL = "https://stock.unifies.codes";

function SymbolRow({ symbol, name, exchange }: { symbol: string; name: string; exchange?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-editorial-verdant/20 py-2.5">
      <span className="font-mono text-[13px] font-semibold tracking-tight text-editorial-ink">{symbol}</span>
      <span className="flex-1 truncate text-right text-[13px] font-times text-editorial-newsprint">
        {name}
        {exchange ? <span className="ml-2 text-[11px] uppercase tracking-wider text-editorial-verdant/70">{exchange}</span> : null}
      </span>
    </li>
  );
}

export default function MarketPage({ market }: { market: MarketType }) {
  const guide = MARKET_GUIDES.find((g) => g.market === market);
  if (!guide) return null;

  const symbols: MarketSymbol[] = getSymbolsByMarket(market);
  const others = MARKET_GUIDES.filter((g) => g.slug !== guide.slug);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: guide.metaTitle,
    url: `${SITE_URL}/${guide.slug}`,
    description: guide.metaDescription,
    isPartOf: {
      "@type": "WebSite",
      name: "OmegaTrade Ultra",
      url: SITE_URL,
    },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: guide.label, item: `${SITE_URL}/${guide.slug}` },
      ],
    },
  };

  return (
    <>
      <Helmet>
        <title>{guide.metaTitle}</title>
        <meta name="description" content={guide.metaDescription} />
        <link rel="canonical" href={`${SITE_URL}/${guide.slug}`} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`${SITE_URL}/${guide.slug}`} />
        <meta property="og:title" content={guide.metaTitle} />
        <meta property="og:description" content={guide.metaDescription} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={guide.metaTitle} />
        <meta name="twitter:description" content={guide.metaDescription} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <main className="bg-editorial-bone text-editorial-ink">
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="px-6 md:px-10 pt-28 md:pt-36 pb-10 md:pb-14">
          <div className="max-w-[1400px] mx-auto">
            <nav aria-label="Breadcrumb" className="mb-8 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-editorial-newsprint">
              <Link to="/" className="hover:text-editorial-marker transition-colors">Home</Link>
              <span aria-hidden="true" className="text-editorial-verdant/50">/</span>
              <span className="text-editorial-ink">{guide.label}</span>
            </nav>
            <span className="micro-label text-editorial-marker">{guide.micro}</span>
            <h1 className="mt-4 font-serif text-[clamp(40px,6vw,84px)] leading-[0.95] tracking-[-0.03em] text-editorial-ink">
              {guide.h1}
            </h1>
            {guide.lede.map((p) => (
              <p key={p.slice(0, 24)} className="mt-4 max-w-2xl text-[15px] font-times leading-relaxed text-editorial-newsprint">
                {p}
              </p>
            ))}
            <div className="mt-8">
              <Link
                to="/terminal"
                className="inline-block bg-editorial-ink text-editorial-bone px-6 py-3 text-[12px] font-semibold uppercase tracking-[0.16em] hover:bg-editorial-marker hover:text-editorial-ink transition-colors"
              >
                Open the live {guide.label} desk →
              </Link>
            </div>
          </div>
        </header>

        {/* ── Body: sections + symbol list ───────────────────── */}
        <section className="px-6 md:px-10 pb-20 md:pb-28">
          <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-x-16 gap-y-12">
            <div className="space-y-12">
              {guide.sections.map((s) => (
                <article key={s.heading}>
                  <h2 className="font-sans text-[22px] md:text-[28px] font-medium leading-tight tracking-[-0.02em] text-editorial-ink">
                    {s.heading}
                  </h2>
                  {s.body.map((p) => (
                    <p key={p.slice(0, 24)} className="mt-3 text-[15px] font-times leading-relaxed text-editorial-newsprint">
                      {p}
                    </p>
                  ))}
                </article>
              ))}
              <article>
                <h2 className="font-sans text-[22px] md:text-[28px] font-medium leading-tight tracking-[-0.02em] text-editorial-ink">
                  Data sources
                </h2>
                <ul className="mt-3 space-y-1.5">
                  {guide.sources.map((s) => (
                    <li key={s} className="flex items-start gap-2 text-[13px] font-times text-editorial-newsprint">
                      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-editorial-marker" />
                      {s}
                    </li>
                  ))}
                </ul>
              </article>
            </div>

            <aside>
              <span className="micro-label text-editorial-verdant">Symbols on this desk</span>
              <ul className="mt-4">
                {symbols.map((s) => (
                  <SymbolRow key={s.symbol} symbol={s.symbol} name={s.name} exchange={s.exchange} />
                ))}
              </ul>
            </aside>
          </div>
        </section>

        {/* ── Hub/spoke: other market guides ─────────────────── */}
        <section className="bg-editorial-ink text-editorial-bone px-6 md:px-10 py-16 md:py-20">
          <div className="max-w-[1400px] mx-auto">
            <span className="micro-label text-editorial-marker">More live desks</span>
            <h2 className="mt-4 font-serif text-[clamp(28px,4vw,52px)] leading-[0.95] tracking-[-0.02em]">Every market, one terminal.</h2>
            <ul className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-px bg-editorial-verdant/20">
              {others.map((o) => (
                <li key={o.slug} className="bg-editorial-ink p-6">
                  <Link to={`/${o.slug}`} className="group block">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-editorial-verdant">{o.label}</span>
                    <p className="mt-2 text-sm font-times leading-relaxed text-editorial-bone/80 group-hover:text-editorial-marker transition-colors">
                      {o.tagline}
                    </p>
                    <span className="mt-3 inline-block text-[11px] font-semibold uppercase tracking-[0.16em] text-editorial-marker">
                      Open guide →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}
