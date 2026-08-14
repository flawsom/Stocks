/* ────────────────────────────────────────────────────────────────
 * Resilient JSON fetching.
 *
 * Every market-data call in the app goes through fetchJson():
 *   1. direct request to the provider, then
 *   2. if that fails (CORS block, network error, non-2xx, empty body)
 *      a free keyless CORS relay is tried once.
 *
 * The relay only runs AFTER the direct request already failed, so the
 * happy path stays fast and the fallback can only ever help — it is
 * what keeps numbers flowing even when a provider blocks a browser
 * origin directly. Returns null only when every path failed.
 * ──────────────────────────────────────────────────────────────── */

const ALLORIGINS_RAW = "https://api.allorigins.win/raw?url=";
// cors.lol's egress sits outside geo-restricted regions — it unblocks APIs
// that are region-blocked for the browser's own IP (Binance 451, Bybit 403),
// which allorigins cannot do. Rate-limited (free shared proxy), so it is used
// only for providers that need it, and only after a direct attempt failed.
const CORS_LOL = "https://api.cors.lol/?url=";
// Jina reader (r.jina.ai) — a server-side fetch + markdown wrapper with CORS
// enabled (it echoes the request origin). Verified: it relays Yahoo Finance
// chart JSON (incl. futures contracts like ES=F) that browsers cannot reach
// directly. Free anonymous tier is rate-limited, so it is used only as the
// LAST relay for Yahoo-only fetches.
const JINA = "https://r.jina.ai/";

async function tryFetchJson(url: string, timeoutMs: number): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Jina wraps the fetched body in markdown boilerplate — extract the JSON object. */
async function tryFetchJina(url: string, timeoutMs: number): Promise<any | null> {
  try {
    const res = await fetch(JINA + url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const text = await res.text();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Fetch JSON directly, falling back to free CORS relays when needed.
 *
 * proxy modes:
 *   undefined/true — direct, then allorigins relay
 *   false          — direct only (no relay)
 *   "lol"          — direct, then cors.lol relay, then allorigins relay
 *   "lol-only"     — cors.lol relay first (no direct attempt — avoids CORS
 *                    console noise for APIs that are region-blocked here)
 *   "yahoo"        — direct, then allorigins, then Jina reader (last resort:
 *                    Yahoo sends no CORS headers, so browsers need a relay;
 *                    allorigins is flaky under Yahoo's rate limits, Jina is
 *                    the reliable second path)
 */
export async function fetchJson(
  url: string,
  opts?: { timeoutMs?: number; proxy?: boolean | "lol" | "lol-only" | "yahoo" }
): Promise<any | null> {
  const timeoutMs = opts?.timeoutMs ?? 5000;
  if (opts?.proxy !== "lol-only") {
    const direct = await tryFetchJson(url, timeoutMs);
    if (direct !== null) return direct;
    if (opts?.proxy === false) return null;
  }
  const relayTime = timeoutMs + 4000;
  if (opts?.proxy === "lol" || opts?.proxy === "lol-only") {
    const viaLol = await tryFetchJson(CORS_LOL + encodeURIComponent(url), relayTime);
    if (viaLol !== null) return viaLol;
  }
  if (opts?.proxy === "yahoo") {
    // RACE all relays in parallel: allorigins is fast but flaky under Yahoo's
    // rate limits, Jina is reliable but slower, cors.lol is a third independent
    // egress. First success wins, so the chart never waits on one slow/blocked
    // path.
    const [viaAll, viaJina, viaLol] = await Promise.all([
      tryFetchJson(ALLORIGINS_RAW + encodeURIComponent(url), relayTime),
      tryFetchJina(url, relayTime + 2000),
      tryFetchJson(CORS_LOL + encodeURIComponent(url), relayTime),
    ]);
    return viaAll ?? viaJina ?? viaLol ?? null;
  }
  const viaAll = await tryFetchJson(ALLORIGINS_RAW + encodeURIComponent(url), relayTime);
  if (viaAll !== null) return viaAll;
  return null;
}
