# Contributing to OmegaTrade Ultra

Thanks for your interest in improving the terminal! This guide covers
everything you need to make a focused, reviewable contribution.

## Ground rules

1. **Zero mock data.** Never display a number that did not come from a live
   provider feed or is not derived from real trades. Empty states with an
   explanation beat fabricated prices, always.
2. **Causal only.** Any ML change must pass the leakage suite: the model
   trains on past bars and forecasts future bars - never the reverse.
3. **Provenance everywhere.** New data paths must report their `source`, and
   the UI must show which live feed is behind the view.

## Setup

```bash
git clone https://github.com/flawsom/Stocks.git
cd Stocks
bun install
bun run dev        # http://localhost:8080
```

No API keys are required - the keyless provider mesh keeps everything live.

## Branches and commits

- Branch from `main`, name it by type:
  `feature/<desc>` · `fix/<desc>` · `docs/<desc>` · `test/<desc>` · `chore/<desc>`
- Use Conventional Commits:

```text
feat(ml): add momentum-regime filter to ensemble voting
fix(providers): respect Polygon per-minute budget on pagination
docs(readme): document env.example variables
test(backtest): cover zero-signal edge cases
```

- Keep each commit focused: one idea, one commit. Reviewers should be able
  to read the diff in one sitting.

## Before opening a PR

Run the full local gate - CI runs the same suites:

```bash
bun tsc -b --noEmit                      # typecheck
bun run build                            # production build
bun run scripts/ml-test.mts              # ML engine behavior
bun run scripts/backtest-test.mts        # backtester
bun run scripts/eyequant-test.mts        # safety systems
bun run scripts/journal-test.mts         # decision journal
bun run scripts/leakage-test.mts         # no-cheating guarantee
bun run scripts/repo-hygiene-test.mts    # docs/manifest/CI wiring
```

## Pull requests

1. Describe what changed and why; link the issue if one exists.
2. Keep PRs small and single-purpose.
3. New behavior needs coverage in the relevant suite.
4. A maintainer reviews and merges - expect honest, detailed review.

## Good first contributions

- Add a provider to the crypto mesh (`src/lib/providers.ts`)
- Extend the scanner with a new column (`src/lib/scanner.ts`)
- Improve docs or the README - doc drift is a real bug
- Write a hygiene or behavior test for an uncovered path
