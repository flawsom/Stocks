// Repo hygiene suite: guards the documentation and metadata contracts the
// README, PWA and CI promise. Run: bun run scripts/repo-hygiene-test.mts
import { readFileSync, existsSync } from "node:fs";

let fails = 0;
const check = (n: string, c: boolean, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " - " + x : ""}`); if (!c) fails++; };

const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

// 1. README contracts
const readme = read("README.md");
check("README exists and is non-trivial", readme.length > 5000, `${readme.length} chars`);
check("README documents all 5 markets", ["stocks", "forex", "crypto", "indices", "futures"].every(m => readme.toLowerCase().includes(m)));
check("README references every local test suite", ["ml-test", "backtest-test", "eyequant-test", "journal-test", "leakage-test", "repo-hygiene-test"].every(t => readme.includes(t)));
check("README has zero em dashes", !readme.includes("—"));

// 2. Environment contract
check("env.example exists", existsSync("env.example"));
const envExample = read("env.example");
for (const key of ["VITE_FINNHUB_KEY", "VITE_TWELVE_DATA_KEY", "VITE_POLYGON_KEY", "VITE_ALPHA_VANTAGE_KEY"]) {
  check(`env.example declares ${key}`, envExample.includes(key));
}

// 3. PWA contract
const manifest = read("public/manifest.json");
check("PWA manifest is valid JSON with name + icons", (() => { try { const m = JSON.parse(manifest); return !!m.name && Array.isArray(m.icons) && m.icons.length > 0; } catch { return false; } })());
const indexHtml = read("index.html");
check("index.html links the manifest", indexHtml.includes('/manifest.json'));
check("index.html declares theme-color", indexHtml.includes("theme-color"));

// 4. CI wiring
const ci = read(".github/workflows/ci.yml");
check("CI runs typecheck", ci.includes("tsc -b --noEmit"));
check("CI runs the build", ci.includes("bun run build"));
check("CI runs the ML suite", ci.includes("ml-test.mts"));
check("CI runs the leakage suite", ci.includes("leakage-test.mts"));
check("CI runs the journal suite", ci.includes("journal-test.mts"));
// Production deploys on Vercel: SPA routing + caching are enforced via vercel.json
const vercel = read("vercel.json");
check("vercel.json rewrites SPA routes", vercel.includes('"rewrites"') && vercel.includes('/index.html'));
check("vercel.json caches hashed assets immutably", vercel.includes("max-age=31536000, immutable"));

// 5. Contributor metadata
const pkg = JSON.parse(read("package.json") || "{}");
check("package.json lists contributors", Array.isArray(pkg.contributors) && pkg.contributors.length >= 2, (pkg.contributors || []).join(" | "));
check("CONTRIBUTING.md exists", existsSync("CONTRIBUTING.md"));

// 6. Custom domain pin (Vercel owns production; CNAME documents the domain)
check("public/CNAME pins the custom domain", read("public/CNAME").trim() === "stocks.unifies.codes");

// 7. License present
check("LICENSE exists", existsSync("LICENSE"));

console.log(fails === 0 ? "\nREPO HYGIENE PASSED ✅" : `\n${fails} HYGIENE CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
