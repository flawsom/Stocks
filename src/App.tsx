import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { Toaster } from "sonner";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";
import { startLiveFeeds } from "@/lib/feeds";
import useCanvasCursor from "@/hooks/useCanvasCursor";

// The terminal is code-split so the landing page — the SEO-critical document —
// doesn't download the heavy charting / ML / 3D libraries until it's opened.
// This is the single biggest lever for landing-page Core Web Vitals.
const TradingDashboard = lazy(() => import("@/pages/TradingDashboard"));

// Router basename follows Vite's build-time base. On GitHub Pages the site is
// served at the custom domain root (stock.unifies.codes), so the base is "/";
// on Vercel/Netlify and local dev the base is "/" and behavior is unchanged.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

function TerminalFallback() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-editorial-bone">
      <div className="flex flex-col items-center gap-4">
        <span className="text-lg font-bold tracking-tight text-editorial-ink">
          Ω&nbsp;ULTRA<span className="text-editorial-marker">.</span>
        </span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-editorial-verdant/20">
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-editorial-marker" />
        </span>
      </div>
    </div>
  );
}

export default function App() {
  // Start the global live feeds once — landing and terminal share the same stream.
  useEffect(() => {
    startLiveFeeds();
  }, []);

  // Canvas cursor trail — fixed overlay, rendered once for every page/route.
  useCanvasCursor();

  return (
    <BrowserRouter basename={BASE}>
      <canvas id="canvas" aria-hidden="true" />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#ffffff",
            border: "1px solid #c8d2c8",
            color: "#121613",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "12px",
          },
        }}
      />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/terminal"
          element={
            <Suspense fallback={<TerminalFallback />}>
              <TradingDashboard />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
