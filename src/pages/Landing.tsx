import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useTradingStore } from "@/stores/tradingStore";
import { cn } from "@/lib/utils";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import heroTerminal from "@/assets/hero-terminal.jpg";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from "@/components/ui/carousel";
import { getSymbolsByMarket } from "@/constants/config";
import type { MarketType, WatchlistItem } from "@/types";

/* ────────────────────────────────────────────────────────────────
 * OMEGATRADE ULTRA - Home
 * Editorial broadsheet in a green room.
 *
 * A printed financial broadsheet reimagined for the web: monumental
 * serif/grotesque display type, small-caps micro-labels, a single
 * saturated highlighter-green accent over a warm bone-white canvas,
 * grayscale→green duotone photo inserts, a near-black editorial
 * break, and a full-bleed green band closing the page.
 * Every figure below is LIVE - it reads from the same real-time
 * feed store as the terminal. No mock data.
 * ──────────────────────────────────────────────────────────────── */

const MICRO = "micro-label";

const EASE = [0.22, 1, 0.36, 1] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.08, ease: EASE },
  }),
};

/* Word-by-word masked reveal - display lines rise out of an ink mask,
   the editorial equivalent of a headline being set in print. */
function RevealWords({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  const words = text.split(" ");
  return (
    <span className={cn("inline-block", className)}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom pb-[0.12em] -mb-[0.12em]">
          <motion.span
            className="inline-block will-change-transform"
            initial={{ y: "115%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.7, delay: delay + i * 0.055, ease: EASE }}
          >
            {w}
            {i < words.length - 1 ? "\u00A0" : ""}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/* ── Live ticker tape - real prices marquee across the page ─────── */
function MarqueeTape() {
  const { watchlist } = useTradingStore();
  const items = watchlist.filter(w => w.price > 0);
  if (items.length === 0) {
    return (
      <div className="border-y border-editorial-verdant/40 py-3 flex items-center gap-2 px-6 md:px-10">
        <span className="w-1.5 h-1.5 rounded-full bg-editorial-marker animate-pulse-glow" />
        <span className={cn(MICRO, "text-editorial-newsprint")}>Connecting to live feeds - prices appear as they arrive</span>
      </div>
    );
  }
  const tick = (item: WatchlistItem, key: string) => {
    const up = item.changePct >= 0;
    return (
      <span key={key} className="mx-7 inline-flex items-baseline gap-2.5 shrink-0">
        <span className={cn(MICRO, "text-editorial-newsprint")}>{item.symbol}</span>
        <span className="font-serif text-lg leading-none text-editorial-ink">
          {item.price < 1 ? item.price.toFixed(5) : item.price < 100 ? item.price.toFixed(3) : item.price.toFixed(2)}
        </span>
        <span className={cn("text-[11px] font-sans font-semibold tracking-tight", up ? "text-editorial-marker" : "text-editorial-ink")}>
          {up ? "▲" : "▼"}{Math.abs(item.changePct).toFixed(2)}%
        </span>
      </span>
    );
  };
  return (
    <div className="relative overflow-hidden border-y border-editorial-verdant/40 py-3 bg-editorial-bone">
      <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
        <div className="flex shrink-0" aria-hidden={false}>
          {items.map((item, i) => tick(item, `a-${i}`))}
        </div>
        <div className="flex shrink-0" aria-hidden>
          {items.map((item, i) => tick(item, `b-${i}`))}
        </div>
      </div>
    </div>
  );
}

/* ── Live tape grid - real prices, editorial callouts ───────────── */
function LiveTape() {
  const { watchlist } = useTradingStore();
  const items = watchlist.filter(w => w.price > 0);
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm font-times text-editorial-newsprint">
        <span className="w-1.5 h-1.5 rounded-full bg-editorial-marker animate-pulse-glow" />
        <span>Connecting to live feeds…</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border-t border-b border-editorial-verdant/60">
      {items.slice(0, 12).map((item, i) => {
        const up = item.changePct >= 0;
        return (
          <motion.div
            key={item.symbol}
            variants={fadeUp}
            custom={i % 6}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-40px" }}
            className="px-5 py-5 border-r border-editorial-verdant/40 last:border-r-0 min-w-0"
          >
            <div className={cn(MICRO, "text-editorial-newsprint truncate")}>{item.symbol}</div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="font-serif text-2xl md:text-[28px] leading-none text-editorial-ink truncate">
                {item.price < 1 ? item.price.toFixed(5) : item.price < 100 ? item.price.toFixed(3) : item.price.toFixed(2)}
              </span>
              <span className={cn("font-sans text-xs font-semibold tracking-tight shrink-0", up ? "text-editorial-marker" : "text-editorial-ink")}>
                {up ? "▲" : "▼"}{Math.abs(item.changePct).toFixed(2)}%
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ── Market briefs carousel - one live editorial slide per market ─ */
const MARKET_BRIEFS: { market: MarketType; kicker: string; desc: string; tag: string }[] = [
  { market: "stocks", kicker: "Equities", desc: "Blue-chip stocks streaming tick-by-tick from the Finnhub trade WebSocket, with intraday candles built live from the actual trade stream.", tag: "Finnhub WS · Live" },
  { market: "forex", kicker: "Currencies", desc: "Major and cross currency pairs on a keyless multi-provider chain - real-time rates, ECB fixings and AlphaVantage FX, refreshed every few seconds.", tag: "er-api + ECB · Live" },
  { market: "crypto", kicker: "Digital Assets", desc: "Fourteen pairs across independent venues plus an eighteen-provider REST mesh - no single exchange can take it down, and none are geo-locked out.", tag: "3× WebSocket · 24/7" },
  { market: "indices", kicker: "Indices", desc: "True index levels - S&P 500, Nasdaq Composite, Dow, Russell 2000, VIX - alongside their index-tracking ETFs, all on live feeds.", tag: "Real Levels · Live" },
  { market: "futures", kicker: "Futures", desc: "Thirteen contracts - E-mini S&P, crude, Brent, metals, grains, softs - via real contract roots. The app never labels a stock as a futures price.", tag: "ES=F / CL=F · Live" },
];

function MarketCarousel() {
  const { watchlist } = useTradingStore();
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!api || paused) return;
    const iv = setInterval(() => api.scrollNext(), 4200);
    return () => clearInterval(iv);
  }, [api, paused]);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    api.on("select", onSelect);
    return () => { api.off("select", onSelect); };
  }, [api]);

  const priceMap = new Map(watchlist.map(w => [w.symbol, w]));

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Carousel
        setApi={setApi}
        opts={{ align: "start", loop: true }}
        className="w-full"
      >
        <CarouselContent className="-ml-4 md:-ml-6">
          {MARKET_BRIEFS.map((brief, idx) => {
            const symbols = getSymbolsByMarket(brief.market).slice(0, 6);
            return (
              <CarouselItem key={brief.market} className="pl-4 md:pl-6 md:basis-[85%] lg:basis-[62%]">
                <motion.div
                  variants={fadeUp}
                  custom={idx % 3}
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, margin: "-60px" }}
                  className="h-full border border-editorial-verdant/40 rounded-[14px] bg-editorial-bone p-8 md:p-10 flex flex-col"
                >
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-serif text-2xl text-editorial-newsprint/60 leading-none">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <span className={cn(MICRO, "text-editorial-marker")}>{brief.tag}</span>
                      </div>
                      <h3 className="mt-4 font-serif text-[clamp(28px,3.5vw,44px)] leading-[0.95] tracking-[-0.02em] text-editorial-ink">
                        {brief.kicker}
                      </h3>
                      <p className="mt-3 max-w-md text-sm font-times leading-relaxed text-editorial-newsprint">{brief.desc}</p>
                    </div>
                  </div>

                  {/* Live quotes inside the slide - reactively updating */}
                  <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-5 flex-1">
                    {symbols.map(sym => {
                      const live = priceMap.get(sym.symbol);
                      const price = live?.price ?? 0;
                      const up = (live?.changePct ?? 0) >= 0;
                      return (
                        <div key={sym.symbol} className="border-t border-editorial-verdant/40 pt-3 min-w-0">
                          <div className={cn(MICRO, "text-editorial-newsprint truncate")}>{sym.symbol}</div>
                          <div className="mt-1.5 font-serif text-[22px] leading-none text-editorial-ink truncate">
                            {price > 0
                              ? (price < 1 ? price.toFixed(5) : price < 100 ? price.toFixed(3) : price.toFixed(2))
                              : "-"}
                          </div>
                          <div className={cn("mt-1 text-[11px] font-sans font-semibold tracking-tight", up ? "text-editorial-marker" : "text-editorial-ink")}>
                            {price > 0 ? `${up ? "▲" : "▼"}${Math.abs(live?.changePct ?? 0).toFixed(2)}%` : "connecting…"}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-8 pt-6 border-t border-editorial-verdant/40 flex items-center justify-between">
                    <span className={cn(MICRO, "text-editorial-verdant")}>
                      {brief.market.toUpperCase()} · {symbols.length} LIVE SYMBOLS
                    </span>
                    <Link to="/terminal" className={cn(MICRO, "text-editorial-ink underline-link underline-offset-4 hover:text-editorial-marker transition-colors")}>
                      Open in terminal →
                    </Link>
                  </div>
                </motion.div>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        <CarouselPrevious className="hidden md:flex -left-4 lg:-left-12 text-editorial-ink border-editorial-verdant/40 bg-editorial-bone hover:bg-editorial-echo" />
        <CarouselNext className="hidden md:flex -right-4 lg:-right-12 text-editorial-ink border-editorial-verdant/40 bg-editorial-bone hover:bg-editorial-echo" />
      </Carousel>

      {/* Dots */}
      <div className="mt-8 flex items-center justify-center gap-2.5">
        {MARKET_BRIEFS.map((b, i) => (
          <button
            key={b.market}
            onClick={() => api?.scrollTo(i)}
            aria-label={`Go to ${b.market}`}
            className={cn(
              "h-[3px] rounded-full transition-all duration-300",
              i === current ? "w-8 bg-editorial-marker" : "w-4 bg-editorial-verdant/30 hover:bg-editorial-verdant/60"
            )}
          />
        ))}
      </div>
    </div>
  );
}

function MarketRow({ index, title, desc, live }: { index: string; title: string; desc: string; live: string }) {
  return (
    <motion.div
      variants={fadeUp}
      custom={1}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      className="flex flex-col gap-3 py-6 border-t border-editorial-verdant/50"
    >
      <div className="flex items-center justify-between">
        <span className="font-serif text-3xl text-editorial-newsprint/70">{index}</span>
        <span className={cn(MICRO, "text-editorial-marker")}>{live}</span>
      </div>
      <h3 className={cn(MICRO, "text-editorial-ink tracking-wide")}>{title}</h3>
      <p className="text-sm md:text-[15px] font-times leading-relaxed text-editorial-newsprint">{desc}</p>
    </motion.div>
  );
}

function FeatureRow({ index, title, desc }: { index: string; title: string; desc: string }) {
  return (
    <motion.div
      variants={fadeUp}
      custom={1}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      className="flex gap-5 py-5 border-b border-editorial-sage/15"
    >
      <span className="font-serif text-lg text-editorial-sage/60 leading-none pt-0.5">{index}</span>
      <div>
        <div className="text-[17px] font-sans font-medium text-editorial-bone tracking-tight">{title}</div>
        <p className="mt-1.5 text-sm font-times leading-relaxed text-editorial-sage/70">{desc}</p>
      </div>
    </motion.div>
  );
}

function StatFigure({ value, label }: { value: string; label: string }) {
  return (
    <div className="py-4">
      <div className="font-serif text-5xl md:text-7xl leading-[0.9] text-editorial-newsprint">{value}</div>
      <div className={cn(MICRO, "mt-3 text-editorial-verdant")}>{label}</div>
    </div>
  );
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-linked effects
  const { scrollYProgress: pageProgress } = useScroll();
  const progressScale = useSpring(pageProgress, { stiffness: 120, damping: 30 });
  const { scrollYProgress: heroProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroImgY = useTransform(heroProgress, [0, 1], [0, 80]);
  const heroFade = useTransform(heroProgress, [0, 0.85], [1, 0.15]);

  return (
    <div className="min-h-screen bg-editorial-bone text-editorial-ink overflow-x-hidden antialiased">
      <Helmet>
        <title>OmegaTrade Ultra - Free Live Stock Prices & AI Forecasts</title>
        <meta name="description" content="Real-time stock, crypto, forex, index & futures prices with self-improving AI forecasts - in your browser. Zero mock data, 20+ free sources, paper trading. No account, no cost." />
        <link rel="canonical" href="https://stocks.unifies.codes/" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="OmegaTrade Ultra" />
        <meta property="og:url" content="https://stocks.unifies.codes/" />
        <meta property="og:title" content="OmegaTrade Ultra - Free Live Stock Prices & AI Forecasts" />
        <meta property="og:description" content="Live prices across Stocks, Forex, Crypto, Indices & Futures - forecast by a self-improving 7-model AI that learns from its own misses. Zero mock data, 20+ free sources." />
        <meta property="og:image" content="https://stocks.unifies.codes/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:alt" content="OmegaTrade Ultra - live multi-market terminal with AI forecasts" />
        <meta property="og:locale" content="en_US" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="OmegaTrade Ultra - Free Live Stock Prices & AI Forecasts" />
        <meta name="twitter:description" content="Live prices across 5 markets, forecast by a self-improving 7-model AI ensemble. Zero mock data, 20+ free sources, runs free in your browser." />
        <meta name="twitter:image" content="https://stocks.unifies.codes/og-image.png" />
        <meta name="twitter:image:alt" content="OmegaTrade Ultra - live multi-market terminal with AI forecasts" />
      </Helmet>

      {/* Scroll progress - a 2px highlighter swipe down the page */}
      <motion.div
        style={{ scaleX: progressScale }}
        className="fixed top-0 inset-x-0 h-[2px] bg-editorial-marker origin-left z-50"
      />

      {/* ── Nav ─────────────────────────────────────────────────── */}
      <nav className={cn(
        "fixed top-0 inset-x-0 z-40 transition-all duration-300",
        scrolled ? "bg-editorial-bone/92 backdrop-blur-md border-b border-editorial-verdant/30" : "bg-transparent"
      )}>
        <div className="max-w-[1400px] mx-auto flex items-center justify-between px-6 md:px-10 h-16">
          {/* Wordmark - bold grotesque with a 2px marker underline (the entire logo treatment) */}
          <Link to="/" className="flex flex-col leading-none">
            <span className="text-[17px] font-bold tracking-tight text-editorial-ink">
              Ω&nbsp;ULTRA<span className="text-editorial-marker">.</span>
            </span>
            <span className="mt-1 h-[2px] w-full bg-editorial-marker" />
          </Link>
          <div className="flex items-center gap-6">
            <a href="#markets" className={cn(MICRO, "text-editorial-newsprint hover:text-editorial-ink transition-colors hidden sm:block")}>
              MARKETS
            </a>
            <a href="#system" className={cn(MICRO, "text-editorial-newsprint hover:text-editorial-ink transition-colors hidden sm:block")}>
              THE MACHINE
            </a>
            <Link
              to="/terminal"
              className="flex items-center gap-2 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.11px] text-editorial-blackink bg-editorial-marker rounded-[5px] hover:bg-editorial-marker/90 transition-colors"
              style={{ boxShadow: "rgba(16,94,29,0.45) 1px 8px 20px 0px" }}
            >
              LAUNCH TERMINAL
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero - the typographic wall ─────────────────────────── */}
      <section ref={heroRef} className="relative pt-36 md:pt-44 pb-14 md:pb-20 px-6 md:px-10">
        <div className="max-w-[1400px] mx-auto">
          <motion.div variants={fadeUp} custom={0} initial="hidden" animate="show" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.11px] text-editorial-marker">
              <span className="w-1.5 h-1.5 rounded-full bg-editorial-marker animate-pulse-glow" />
              LIVE - 5 MARKETS
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.11px] text-editorial-newsprint">18+ Data Sources</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.11px] text-editorial-newsprint">7-Model Self-Training Ensemble</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.11px] text-editorial-newsprint">Zero Mock Data</span>
          </motion.div>

          <motion.h1
            style={{ lineHeight: 0.92, letterSpacing: "-0.04em" }}
            className="mt-10 font-serif text-editorial-ink"
          >
            <span className="block text-[clamp(52px,9vw,140px)]">
              <RevealWords text="Real-time markets," delay={0.1} />
            </span>

            <span className="flex flex-wrap items-end gap-x-8 gap-y-6 mt-2">
              {/* Editorial photo insert - floated between display lines, parallax on scroll */}
              <motion.span
                style={{ y: heroImgY, opacity: heroFade }}
                className="hidden md:block shrink-0 mb-4 will-change-transform"
              >
                <img
                  src={heroTerminal}
                  alt="Live candlestick terminal"
                  className="editorial-img w-[210px] h-[140px] object-cover rounded-[14px]"
                  style={{ objectPosition: "50% 18%" }}
                />
              </motion.span>
              <motion.span
                initial={{ opacity: 0, y: 26 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.45, ease: EASE }}
                className="font-editorial italic font-light text-[clamp(40px,6.5vw,104px)] text-editorial-ink"
              >
                forecast by a machine
              </motion.span>
            </span>

            <span className="block text-[clamp(52px,9vw,140px)] mt-2">
              <RevealWords text="that learns from its" delay={0.35} />
            </span>
            <span className="block text-[clamp(52px,9vw,140px)]">
              <RevealWords text="own misses" delay={0.45} />
              <span className="text-editorial-marker">.</span>
            </span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            custom={2}
            initial="hidden"
            animate="show"
            className="mt-10 max-w-2xl text-[17px] font-times leading-relaxed text-editorial-newsprint"
          >
            OmegaTrade Ultra streams live prices, order depth and news across stocks, forex, crypto, indices and
            futures - then runs a seven-model prediction ensemble in your browser that trains in real time,
            verifies every forecast, and retrains itself on its failures. Every number is live. Every forecast
            is scored against the market.
          </motion.p>

          <motion.div variants={fadeUp} custom={3} initial="hidden" animate="show" className="mt-10 flex flex-wrap items-center gap-6">
            <Link
              to="/terminal"
              className="inline-flex items-center gap-3 px-8 py-4 text-[11px] font-semibold uppercase tracking-[0.11px] text-editorial-blackink bg-editorial-marker rounded-[5px] hover:bg-editorial-marker/90 transition-colors"
              style={{ boxShadow: "rgba(16,94,29,0.45) 1px 8px 20px 0px" }}
            >
              OPEN LIVE TERMINAL
              <span aria-hidden>→</span>
            </Link>
            <a href="#system" className="text-[15px] font-times text-editorial-ink underline-link underline-offset-4">
              Read the system brief
            </a>
          </motion.div>
        </div>
      </section>

      {/* ── Live ticker tape - the prices below scroll on their own ── */}
      <MarqueeTape />

      {/* ── Live tape grid - real prices, editorial callouts ─────── */}
      <section className="px-6 md:px-10 pb-20 md:pb-28 pt-16 md:pt-24">
        <div className="max-w-[1400px] mx-auto">
          <motion.div variants={fadeUp} custom={0} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} className="mb-8 flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-editorial-marker" />
            <span className={cn(MICRO, "text-editorial-newsprint")}>Real-time feeds - the prices below are live right now</span>
          </motion.div>
          <LiveTape />
        </div>
      </section>

      {/* ── Markets - column rules like print ───────────────────── */}
      <section id="markets" className="px-6 md:px-10 py-20 md:py-28 border-t border-editorial-verdant/40">
        <div className="max-w-[1400px] mx-auto">
          <motion.div variants={fadeUp} custom={0} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            <span className={cn(MICRO, "text-editorial-marker")}>The Coverage</span>
            <h2 className="mt-4 font-sans font-medium text-[clamp(44px,6vw,88px)] leading-[0.95] tracking-[-0.03em] text-editorial-ink">
              All markets.
              <br />
              One feed.
            </h2>
            <p className="mt-6 max-w-xl text-[15px] font-times leading-relaxed text-editorial-newsprint">
              Five asset classes, streamed through dedicated live providers. When a source is rate-limited or
              unreachable, the terminal says so and falls back to another live source - it never fabricates a price.
            </p>
          </motion.div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-2">
            <MarketRow index="01" title="US Stocks" live="Finnhub WS · Live" desc="Blue-chip equities streaming tick-by-tick on the Finnhub trade WebSocket, with intraday candles built live from the actual trade stream." />
            <MarketRow index="02" title="Forex" live="er-api + ECB · Live" desc="Major and cross currency pairs on a keyless multi-provider chain - real-time rates, ECB fixings and AlphaVantage FX - refreshed every few seconds." />
            <MarketRow index="03" title="Crypto" live="3× WebSocket · 24/7" desc="Fourteen pairs across independent venues plus an eighteen-provider REST mesh - no single exchange can take it down, and none are geo-locked out." />
            <MarketRow index="04" title="Indices" live="Real Levels · Live" desc="True index levels - S&amp;P 500, Nasdaq Composite, Dow, Russell 2000, VIX - alongside their index-tracking ETFs, all on live feeds." />
            <MarketRow index="05" title="Futures" live="ES=F / CL=F · Live" desc="Thirteen contracts - E-mini S&amp;P, crude, Brent, metals, grains, softs - via real contract roots. The app never labels a stock as a futures price." />
            <MarketRow index="06" title="News + Sentiment" live="Finnhub · Live" desc="Real headlines with lexicon sentiment tagging - bullish, bearish or neutral - beside the live data, with a keyless Hacker News fallback." />
          </div>
        </div>
      </section>

      {/* ── Market guides - SEO hubs (hub/spoke internal links) ── */}
      <section className="px-6 md:px-10 py-16 md:py-20 border-t border-editorial-verdant/40">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <span className={cn(MICRO, "text-editorial-marker")}>Market Guides</span>
              <h2 className="mt-4 font-serif text-[clamp(28px,4vw,48px)] leading-[0.95] tracking-[-0.02em] text-editorial-ink">
                A live guide for every market.
              </h2>
            </div>
            <p className="max-w-sm text-sm font-times leading-relaxed text-editorial-newsprint">
              Free reference pages for each asset class - what&rsquo;s covered, where the data comes from, and how to open
              the desk in the terminal.
            </p>
          </div>
          <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-px bg-editorial-verdant/25 border border-editorial-verdant/25">
            {[
              { to: "/stocks", label: "US Stocks", blurb: "Live quotes, charts & AI forecasts for 18 blue-chip stocks" },
              { to: "/crypto", label: "Crypto", blurb: "14 pairs streamed 24/7 from independent venues" },
              { to: "/forex", label: "Forex", blurb: "12 major & cross pairs, keyless, quoted to the pip" },
              { to: "/indices", label: "Indices", blurb: "Real S&P 500, Nasdaq, Dow, Russell 2000 & VIX levels" },
              { to: "/futures", label: "Futures", blurb: "E-mini S&P, crude, metals & grains on real contracts" },
            ].map((m) => (
              <li key={m.to} className="bg-editorial-bone p-5">
                <Link to={m.to} className="group block">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-editorial-ink group-hover:text-editorial-marker transition-colors">
                    {m.label}
                  </span>
                  <p className="mt-2 text-[13px] font-times leading-relaxed text-editorial-newsprint">{m.blurb}</p>
                  <span className="mt-3 inline-block text-[11px] font-semibold uppercase tracking-[0.16em] text-editorial-marker">
                    Open guide →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Live market briefs - the carousel ───────────────────── */}
      <section className="px-6 md:px-10 py-20 md:py-28 border-t border-editorial-verdant/40 bg-editorial-bone">
        <div className="max-w-[1400px] mx-auto">
          <motion.div variants={fadeUp} custom={0} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} className="mb-12 flex flex-wrap items-end justify-between gap-6">
            <div>
              <span className={cn(MICRO, "text-editorial-marker")}>Live Market Briefs</span>
              <h2 className="mt-4 font-sans font-medium text-[clamp(36px,5vw,72px)] leading-[0.95] tracking-[-0.03em] text-editorial-ink">
                A desk for every market.
              </h2>
            </div>
            <p className="max-w-sm text-sm font-times leading-relaxed text-editorial-newsprint">
              Five live desks - every figure inside is streaming from the same feed store as the terminal. The
              carousel advances on its own; hover to hold a desk.
            </p>
          </motion.div>
          <MarketCarousel />
        </div>
      </section>

      {/* ── Dark editorial section - the machine ────────────────── */}
      <section id="system" className="bg-editorial-ink text-editorial-bone px-6 md:px-10 py-24 md:py-32">
        <div className="max-w-[1400px] mx-auto">
          <motion.div variants={fadeUp} custom={0} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-80px" }}>
            <span className={cn(MICRO, "text-editorial-marker")}>The Machine</span>
            <h2 className="mt-4 font-sans font-medium text-[clamp(40px,6vw,92px)] leading-[0.98] tracking-[-0.03em]">
              An ensemble that proves itself.
            </h2>
            <p className="mt-6 max-w-2xl text-[17px] font-sans font-light leading-relaxed text-editorial-sage">
              Not a demo model - a verified, self-improving prediction system. Every forecast is resolved after
              its horizon; misses are mined as hard examples, replayed online immediately, and over-sampled on
              the next retrain. The accuracy you see is honest, not in-sample.
            </p>
          </motion.div>

          <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-x-12">
            <FeatureRow index="01" title="Seven-Model Ensemble" desc="Three multi-layer perceptrons, logistic regression, a kNN pattern matcher, gradient-boosted trees and a momentum model vote together - weighted by each model's verified track record." />
            <FeatureRow index="02" title="Walk-Forward Validation" desc="Every training run scores the model out-of-sample against naive baselines, so the accuracy on screen is honest, not fitted to the past." />
            <FeatureRow index="03" title="Multi-Horizon Forecasts" desc="T+1 / T+3 / T+5 targets plotted on the chart as a forecast path with an uncertainty cone, alongside the live candles." />
            <FeatureRow index="04" title="Trains On Its Failures" desc="Missed forecasts become hard examples, replayed online immediately and over-sampled on retrain - the model improves where it was wrong." />
            <FeatureRow index="05" title="Signal P&L Track Record" desc="A running equity curve of following the signals versus buy-and-hold across every verified window - precision in money terms." />
            <FeatureRow index="06" title="Kalman-Smoothed Signals" desc="A one-dimensional Kalman filter stabilises live probabilities so the signal does not flip-flop between ticks." />
            <FeatureRow index="07" title="Paper Trading Engine" desc="A $100,000 virtual account with live mark-to-market, longs and shorts, commission, an equity curve and a full order log - persisted across sessions." />
            <FeatureRow index="08" title="One-Click Signal Execution" desc="Every AI signal carries a one-click paper order at the live price - watch the forecast act on a real account in real time." />
          </div>

          <motion.div variants={fadeUp} custom={1} initial="hidden" whileInView="show" viewport={{ once: true }} className="mt-16 flex flex-wrap items-center gap-5">
            <Link
              to="/terminal"
              className="inline-flex items-center gap-3 px-8 py-4 text-[11px] font-semibold uppercase tracking-[0.11px] text-editorial-bone bg-editorial-marker text-editorial-blackink rounded-[5px] hover:bg-editorial-marker/90 transition-colors"
              style={{ boxShadow: "rgba(18,146,39,0.25) 1px 8px 20px 0px" }}
            >
              ENTER THE TERMINAL
              <span aria-hidden>→</span>
            </Link>
            <a href="#stats" className={cn(MICRO, "text-editorial-sage hover:text-editorial-bone transition-colors underline-link")}>
              See the numbers
            </a>
          </motion.div>
        </div>
      </section>

      {/* ── Stats - muted editorial figures ─────────────────────── */}
      <section id="stats" className="px-6 md:px-10 py-20 md:py-28 border-t border-editorial-verdant/40">
        <div className="max-w-[1400px] mx-auto">
          <motion.div variants={fadeUp} custom={0} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} className="grid grid-cols-2 md:grid-cols-4 gap-x-10 gap-y-10 border-b border-editorial-verdant/50">
            <StatFigure value="5" label="Markets, one stream" />
            <StatFigure value="18+" label="Live data sources" />
            <StatFigure value="7" label="Model ensemble" />
            <StatFigure value="0" label="Mock data points" />
          </motion.div>
          <motion.div variants={fadeUp} custom={1} initial="hidden" whileInView="show" viewport={{ once: true }} className="mt-14 flex flex-wrap items-center justify-between gap-6">
            <p className="max-w-xl text-[15px] font-times leading-relaxed text-editorial-newsprint">
              Every number on screen comes from a live provider feed - Finnhub, Binance, TwelveData, Alpha
              Vantage, Polygon, Kraken, Coinbase, OKX, CoinGecko, Yahoo and more - or is derived from real
              trades. When a provider is rate-limited or unavailable, the terminal says so and falls back to
              another live source.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {["FINNHUB", "BINANCE", "TWELVEDATA", "ALPHA VANTAGE", "POLYGON", "KRAKEN", "COINGECKO", "YAHOO"].map(p => (
                <span key={p} className={cn(MICRO, "text-editorial-verdant")}>{p}</span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── FAQ - long-tail answers, for humans and search ──────── */}
      <section id="faq" className="px-6 md:px-10 py-20 md:py-28 border-t border-editorial-verdant/40">
        <div className="max-w-[1400px] mx-auto">
          <motion.div
            variants={fadeUp}
            custom={0}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="max-w-3xl"
          >
            <div className={cn(MICRO, "text-editorial-newsprint")}>Questions, answered</div>
            <h2 className="mt-4 font-serif text-[clamp(36px,5vw,72px)] leading-[0.92] tracking-[-0.04em] text-editorial-ink">
              Frequently asked<span className="text-editorial-marker">.</span>
            </h2>
          </motion.div>

          <div className="mt-14 grid gap-x-14 gap-y-10 md:grid-cols-2">
            {[
              [
                "Is OmegaTrade Ultra really free?",
                "Yes - the entire terminal runs in your browser. There is no account, no subscription, no server bill, and nothing to install. All market data comes from free public providers, and the AI forecasting runs client-side.",
              ],
              [
                "Where does the live market data come from?",
                "A mesh of 20+ free sources: Finnhub and Polygon for US equities, Kraken/Coinbase/OKX and a dozen more crypto venues, Yahoo Finance relays for real index levels and futures contracts, and er-api/ECB for forex. Every quote races multiple sources and the fastest valid price wins, with automatic failover when one is rate-limited.",
              ],
              [
                "How does the AI forecast work?",
                "A 7-model ensemble that runs entirely in your browser - including a lightweight neural network with Monte-Carlo uncertainty estimation, continual-learning (EWC) updates and Grad-CAM explainability. It keeps an accuracy ledger of its own past predictions and retrains on its own misses, and a circuit breaker withholds signals when uncertainty is too high.",
              ],
              [
                "Which markets are covered?",
                "Stocks (US equities), Forex (major pairs), Crypto (20+ venues, spot and USDT pairs), Indices (S&P 500, Nasdaq Composite, Dow, Russell 2000 and the VIX - real index levels, not ETF proxies) and Futures (ES, CL, NG, SI via real contracts).",
              ],
              [
                "Do I need an API key to use it?",
                "No. It works keyless out of the box. You can optionally add your own free keys for TwelveData, Finnhub, Polygon or Alpha Vantage to raise your personal rate limits - they are all optional overrides.",
              ],
              [
                "Is this financial advice? Can I trade real money?",
                "No and no. OmegaTrade Ultra is a research and education tool with a paper-trading engine - signals are forecasts, not recommendations, and no real orders are ever placed. Markets carry risk; do your own research.",
              ],
              [
                "Is my data safe?",
                "Nothing leaves your browser except market-data requests to public APIs. There is no account, no tracking server, and no stored personal information.",
              ],
              [
                "How does the accuracy ledger stay honest?",
                "Every published prediction is timestamped and later checked against the actual price movement - including the misses. The ledger updates itself in real time, and the ML safety suite (uncertainty, drift, integrity) runs continuously so the system cannot quietly overstate its own skill.",
              ],
            ].map(([q, a], i) => (
              <motion.div
                key={q}
                variants={fadeUp}
                custom={i % 2}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-40px" }}
                className="border-t border-editorial-verdant/30 pt-5"
              >
                <h3 className="font-serif text-[22px] md:text-[26px] leading-[1.05] tracking-[-0.01em] text-editorial-ink">
                  {q}
                </h3>
                <p className="mt-3 text-[15px] font-times leading-relaxed text-editorial-newsprint">{a}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────── */}
      <section className="px-6 md:px-10 py-24 md:py-32">
        <div className="max-w-[1400px] mx-auto text-center">
          <motion.div variants={fadeUp} custom={0} initial="hidden" whileInView="show" viewport={{ once: true }}>
            <h2 className="font-serif text-[clamp(40px,6.5vw,96px)] leading-[0.92] tracking-[-0.04em] text-editorial-ink">
              Watch the machine
              <br />
              <span className="font-editorial italic font-light">learn in real time</span>
              <span className="text-editorial-marker">.</span>
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-[16px] font-times leading-relaxed text-editorial-newsprint">
              Live feeds, live forecasts, verified outcomes, and an accuracy ledger that updates itself.
            </p>
            <Link
              to="/terminal"
              className="inline-flex items-center gap-3 mt-10 px-9 py-4 text-[11px] font-semibold uppercase tracking-[0.11px] text-editorial-blackink bg-editorial-marker rounded-[5px] hover:bg-editorial-marker/90 transition-colors"
              style={{ boxShadow: "rgba(16,94,29,0.45) 1px 8px 20px 0px" }}
            >
              LAUNCH LIVE TERMINAL
              <span aria-hidden>→</span>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── Footer - near-black with green band close ───────────── */}
      <footer className="bg-editorial-ink text-editorial-bone px-6 md:px-10 pt-16 pb-10">
        <div className="max-w-[1400px] mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
            <div className="col-span-2 md:col-span-1">
              <Link to="/" className="flex flex-col leading-none">
                <span className="text-[17px] font-bold tracking-tight text-editorial-bone">
                  Ω&nbsp;ULTRA<span className="text-editorial-marker">.</span>
                </span>
                <span className="mt-1 h-[2px] w-full bg-editorial-marker" />
              </Link>
              <p className="mt-5 text-sm font-times leading-relaxed text-editorial-sage/70">
                Real-time multi-market intelligence with a self-training prediction ensemble.
              </p>
            </div>
            <div>
              <div className={cn(MICRO, "text-editorial-sage")}>Markets</div>
              <div className="mt-4 flex flex-col gap-2.5 text-sm font-times text-editorial-sage/80">
                <a href="#markets" className="underline-link underline-offset-4">Stocks</a>
                <a href="#markets" className="underline-link underline-offset-4">Forex</a>
                <a href="#markets" className="underline-link underline-offset-4">Crypto</a>
                <a href="#markets" className="underline-link underline-offset-4">Indices &amp; Futures</a>
              </div>
            </div>
            <div>
              <div className={cn(MICRO, "text-editorial-sage")}>The System</div>
              <div className="mt-4 flex flex-col gap-2.5 text-sm font-times text-editorial-sage/80">
                <a href="#system" className="underline-link underline-offset-4">Ensemble &amp; Validation</a>
                <a href="#system" className="underline-link underline-offset-4">Failure-Driven Retraining</a>
                <a href="#system" className="underline-link underline-offset-4">Uncertainty Guard</a>
                <Link to="/terminal" className="underline-link underline-offset-4">Paper Trading</Link>
              </div>
            </div>
            <div>
              <div className={cn(MICRO, "text-editorial-sage")}>Signal</div>
              <div className="mt-4 flex flex-col gap-2.5 text-sm font-times text-editorial-sage/80">
                <Link to="/terminal" className="underline-link underline-offset-4">Open the terminal</Link>
                <span>Client-side ML · paper trading</span>
                <span>Zero mock data</span>
              </div>
            </div>
          </div>
          <div className="mt-14 pt-6 border-t border-editorial-sage/15 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <span className={cn(MICRO, "text-editorial-sage/60")}>© 2026 OmegaTrade Ultra</span>
            <span className={cn(MICRO, "text-editorial-sage/60")}>For research and education. Not financial advice.</span>
          </div>
        </div>
      </footer>

      {/* ── Full-bleed highlighter band - the closing signature ─── */}
      <div className="bg-editorial-marker w-full h-[240px] md:h-[340px] relative overflow-hidden">
        <span className="absolute top-6 left-6 md:top-10 md:left-10 font-bold text-2xl text-editorial-bone">Ω</span>
        <span
          className="absolute bottom-[-0.08em] right-2 md:right-6 font-serif leading-none text-editorial-bone select-none"
          style={{ fontSize: "clamp(120px, 22vw, 320px)", letterSpacing: "-0.04em" }}
        >
          ULTRA.
        </span>
      </div>
    </div>
  );
}
