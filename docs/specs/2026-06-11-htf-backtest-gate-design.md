# HTF Backtest Gate — Design (Spec 4, backtest-only)

**Date:** 2026-06-11
**Branch:** `feat/htf-filter`
**Status:** design — awaiting user review before plan

## Goal

Make the existing HTF trend filter **usable as an opt-in gate inside a backtest run**, so a
gated re-simulation can be produced on demand. The gate must NOT touch live trading or any
strategy config. One sentence: *add a `--htf` flag to `run-backtest.js` that, when set,
denies entries taken against the higher-timeframe trend.*

## Background (what already exists, unchanged)

Spec 3 shipped the building blocks and a post-hoc measurement (see
`docs/research/2026-06-06-htf-filter-measurement.md`):

- `aggregateHTF(candles, ratio)` — closed-only LTF→HTF resampler, drops the forming bucket
  (no look-ahead). `src/core/aggregateHTF.js`.
- `classifyHTFTrend(htf, opts)` — returns `{emaBand, emaSlope, adxRegime}`, each
  `UP|DOWN|NEUTRAL`. `src/core/classifyHTFTrend.js`.
- `scripts/analyze-htf-filter.js` — post-processes `simulate()` trades; does NOT gate.

The measurement's binding conclusions, which constrain this spec:

1. **emaBand only.** `adxRegime` under-filters (leaks losers into `neutral`); `emaSlope` is
   not better. Ship the gate with `emaBand` semantics only; keep the other two definitions in
   `classifyHTFTrend` for research but do not expose them as gate modes (YAGNI).
2. **Loss-reducer, not profit-maker.** Honest (no-look-ahead) result: gating the `against`
   bucket cuts the worst losses on VMC_CIPHERB / REVERSAL but does not by itself make a
   strategy profitable. On SMC the gate is inert (`against` ≈ 0). The tool's value is a
   faithful **gated re-run**, not a promise of profit.
3. The post-hoc bucketing is not a re-simulation: removing early trades changes which later
   trades are eligible (position-locking). A gate active **inside** `simulate` is the honest
   measurement. This spec provides exactly that.

## Scope

### In scope
- A pure decorator `withHtfGate(decide, opts)` that wraps any `decide` function.
- CLI flags on `backtest/run-backtest.js` to enable and parameterize the gate.
- Unit tests for the decorator.

### Out of scope (explicit — do not touch)
- `src/core/pipeline.js` (`evaluateBar`) — shared by live; must stay untouched.
- `src/agents/RiskPolicy.js`, `bot_engine.js`, `src/validators/safety-rules.js` — live path.
  The dead `htf_location` stub in `safety-rules.js` stays as-is (still unused).
- Strategy JSON / DB configs — the gate is a backtest-run option, never persisted on a
  strategy.
- BREAKOUT re-measurement (now possible after the entry fix in `2d3d8b6`) — tracked
  separately, not part of this spec.

## Architecture

### Why a decorator, not an `evaluateBar` edit

`simulate(p, decide = evaluateBar)` already accepts the decision function as a parameter
(`src/backtest/simulator.js:27`), and `runOne(...)` already forwards an optional `p.decide`
into it (`backtest/run-backtest.js:77-80`). Live (`bot_engine.js`) calls `evaluateBar`
directly and never goes through `simulate`. Therefore wrapping `decide` gates the backtest
**and only the backtest** — zero risk to live by construction. No shared code is modified.

### The decorator

`src/backtest/htfGate.js`:

```js
import { aggregateHTF } from '../core/aggregateHTF.js';
import { classifyHTFTrend } from '../core/classifyHTFTrend.js';

/** with/against/neutral for a side given an UP/DOWN/NEUTRAL verdict. */
export function bucketOf(side, verdict) {
  if (verdict === 'NEUTRAL') return 'neutral';
  if (verdict === 'UP') return side === 'BUY' ? 'with' : 'against';
  return side === 'SELL' ? 'with' : 'against'; // DOWN
}

/**
 * Wrap a decide function with an HTF emaBand gate. When the inner decision is a PERMIT
 * whose order side runs AGAINST the HTF emaBand trend, flip it to DENY. `with` and
 * `neutral` pass through unchanged. Pure: derives the HTF verdict from ctx.candles only
 * (closed-only aggregation → no look-ahead).
 *
 * @param {(ctx,account)=>{signal,decision}} decide inner decision fn (e.g. evaluateBar)
 * @param {{ratio:number, emaPeriod:number, band:number}} opts
 * @returns {(ctx,account)=>{signal,decision}}
 */
export function withHtfGate(decide, opts) {
  const { ratio, emaPeriod, band } = opts;
  return (ctx, account) => {
    const result = decide(ctx, account);
    const d = result && result.decision;
    if (!d || d.decision !== 'PERMIT' || !d.order) return result;

    const htf = aggregateHTF(ctx.candles, ratio);
    const verdict = classifyHTFTrend(htf, { emaPeriod, band }).emaBand;
    if (bucketOf(d.order.side, verdict) === 'against') {
      return {
        signal: result.signal,
        decision: { decision: 'DENY', reason: `HTF gate: ${d.order.side} against ${verdict} trend (emaBand)` },
      };
    }
    return result;
  };
}
```

Notes:
- **No look-ahead:** `aggregateHTF(ctx.candles, ratio)` over the simulator window (which ends
  at `close[i]`) drops the forming bucket — identical discipline to the analyzer.
- **NEUTRAL passes** (bucket `neutral`): in an HTF range the gate is inert, both sides allowed.
  This is the deliberate over-filter safeguard already built into `classifyHTFTrend`.
- **Insufficient HTF history** → `classifyHTFTrend` returns all-`NEUTRAL` → pass. Early bars in
  the window are never wrongly blocked.
- `bucketOf` is duplicated from `analyze-htf-filter.js` (4 trivial lines). Deliberate: it
  avoids modifying the tested analyzer to share a helper. If a third consumer appears, extract
  then.

### CLI integration

`backtest/run-backtest.js` `main()` only. Read flags, build `opts`, and pass a wrapped
`decide` into `runOne`:

```js
// after guardrails/costs are built, before runOne(...)
let decide; // undefined → simulate uses evaluateBar
if (args.htf) {
  const { withHtfGate } = await import('../src/backtest/htfGate.js');
  const { evaluateBar } = await import('../src/core/pipeline.js');
  const htfOpts = {
    ratio: args.htfRatio != null ? Number(args.htfRatio) : 4,
    emaPeriod: args.htfEma != null ? Number(args.htfEma) : 50,
    band: args.htfBand != null ? Number(args.htfBand) : 0.005,
  };
  decide = withHtfGate(evaluateBar, htfOpts);
  console.log(`[backtest] HTF gate ON (emaBand, ratio=${htfOpts.ratio}, ema=${htfOpts.emaPeriod}, band=${htfOpts.band})`);
}
// pass decide through to runOne(btRepo, { ..., decide });
```

**`runOne` needs no change.** It already destructures `p.decide` and forwards it as the
second arg to `simulate(..., p.decide)` (`backtest/run-backtest.js:77-80`); when `main`
omits it, `p.decide` is `undefined` and `simulate` falls back to `evaluateBar`. The only edit
is in `main`: add `decide` to the object literal passed to `runOne(btRepo, { …, decide })`.

**Flags (camelCase, matching existing `--riskPerTrade` convention):**

| Flag | Default | Meaning |
|------|---------|---------|
| `--htf` | off | Enable the gate (presence = on). |
| `--htfRatio` | 4 | LTF→HTF multiple (e.g. 4 for 1H→4H). |
| `--htfEma` | 50 | EMA period for emaBand. |
| `--htfBand` | 0.005 | Neutral band fraction for emaBand. |

`parseArgs` (from `download-data.js`) already yields `args.htf`, `args.htfRatio`, etc. by key;
confirm boolean handling for the bare `--htf` during implementation (treat any present value,
including `true`, as on).

## Data flow

```
CLI --htf … → main() builds htfOpts + decide = withHtfGate(evaluateBar, htfOpts)
            → runOne(..., { decide })
            → simulate({candles, config, …}, decide)
                 per flat bar i:
                   inner = evaluateBar(ctx, account)         // signal + PERMIT/DENY
                   if PERMIT: htf = aggregateHTF(ctx.candles, ratio)
                              if bucketOf(side, emaBand) === 'against' → DENY
            → trades reflect the gated run; metrics/persistence unchanged
```

## Error handling

- The decorator is pure and total: any branch that cannot classify (empty/short HTF) yields
  `NEUTRAL` → pass. It never throws on thin data.
- It only ever turns PERMIT→DENY. It never fabricates a PERMIT, never alters size/SL/TP, never
  changes the signal. A DENY from the inner `decide` passes straight through.
- No new I/O. No change to persistence, metrics, or the futures path.

## Testing strategy

`tests/test_htf_gate.mjs` (standalone `node`, manual `ok()` counter — matches the repo's
existing `tests/*.mjs` harness):

1. **against → DENY:** stub `decide` returns PERMIT BUY; feed candles whose HTF emaBand is
   DOWN → decorator returns DENY with the HTF reason.
2. **with → passthrough:** PERMIT BUY, HTF emaBand UP → unchanged PERMIT (same order object).
3. **neutral → passthrough:** PERMIT in an HTF range (NEUTRAL) → unchanged PERMIT.
4. **inner DENY → passthrough:** stub returns DENY → decorator returns it untouched (no HTF
   work attempted).
5. **thin HTF history → passthrough:** fewer than `emaPeriod` HTF bars → NEUTRAL → PERMIT.
6. **bucketOf table:** BUY/SELL × UP/DOWN/NEUTRAL → expected with/against/neutral.

Plus a regression check that the existing suite (`tests/test_simulator.js`,
`tests/test_aggregate_htf.mjs`, `tests/test_classify_htf_trend.mjs`,
`tests/test_analyze_htf_filter.mjs`) still passes — no shared code changed, so they must.

## Verification (manual, after implementation)

Run the same cell with and without `--htf` and eyeball that gating reduces trade count and
moves PnL in the measurement-predicted direction (inert on SMC; trims `against` losses on a
counter-trend logic):

```
node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic VMC_CIPHERB --from 2024-06-01
node backtest/run-backtest.js --symbol BTCUSDT --tf 1H --logic VMC_CIPHERB --from 2024-06-01 --htf
```

Expected: the `--htf` run shows fewer trades and reduced gross loss on VMC; an SMC cell is
near-identical (gate inert). This confirms the gated re-run behaves as the post-hoc analysis
predicted.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Accidental coupling to live | Decorator wraps `decide` only; `evaluateBar` untouched; live never calls `simulate`. |
| Look-ahead via the forming HTF bucket | `aggregateHTF` drops it by construction; covered by its existing tests. |
| `parseArgs` boolean handling for bare `--htf` | Verified during implementation; test 1 exercises the on-path. |
| `bucketOf` duplication drifts from analyzer | 4 lines, both covered by tests; extract only if a third consumer appears. |
