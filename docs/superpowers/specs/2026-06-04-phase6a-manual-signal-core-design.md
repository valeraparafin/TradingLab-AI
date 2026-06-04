# Phase 6a — Manual Path on the Shared Signal Core — Design Spec

- **Date:** 2026-06-04
- **Branch:** `feat/signal-core`
- **Status:** Approved design, pending implementation plan
- **Parent spec:** `2026-06-02-signal-core-backtest-design.md` (§10 row 6 — "Characterization + live migration")

## 1. Problem & why this first

The end goal is to **backtest and optimize the real strategies**. The real,
actively-traded strategies with statistics are the **manual** ones
(`bot_engine.js`). The AI agent is currently a *simulated* heuristic and does not
trade — it is a future "smart" layer, addressed separately in Phase 6b.

The backtest shell decides trades with the new pure core
(`evaluateBar` → `deriveSignal`). Live manual bots decide with `bot_engine`'s own
inline logic. **Unless we prove the core decides the entry side the same way
`bot_engine` does (except deliberate fixes), backtest results say nothing about the
live manual bots** — they would be numbers from a parallel universe.

Phase 6a closes that gap for the **entry-signal (side) decision**: a
golden-master characterization that locks current behavior, plus a feature-flagged
swap of the live side decision onto the core, default OFF with instant rollback.

## 2. Current live behavior (the thing we characterize)

`bot_engine.js` `run()` loop, per symbol in the watchlist:

1. **Day-limit gate** (`countTodaysTrades >= maxTradesPerDay`) — skip symbol.
2. Fetch candles; read last `price`/`open`.
3. **Position lock:** `checkActivePosition(strategyId, symbol)`.
   - **If a position is open** (lines ~310–431): NO new entry. Monitor for exit —
     SL/TP by side (`BUY`: `price<=SL`→SL, `price>=TP`→TP; `SELL`: mirrored). On
     trigger: close position, record the closing trade, log. Else: update mark
     price / unrealized PnL. **This is the shell; it must stay identical.**
   - **If flat** (lines ~432+): compute the **entry side**, run safety checks,
     size, and place the order.
4. **Entry-side decision (lines ~437–467) — the seam we are changing:**
   ```js
   const logicType = strategyConfig.logic?.type || /* name-based fallback */ null;
   let side = "BUY";                               // default
   if (logicType) {
     strategyData = indicatorManager.calculate(logicType, candles);
     if (logicType === "Breakout" && strategyData.channel?.active) {
       side = price > top ? "BUY" : (price < bottom ? "SELL" : "BUY"); // inside → BUY (bug)
     } else if (logicType === "SMC") {
       side = trend === 1 ? "BUY" : (trend === -1 ? "SELL" : "BUY");   // neutral → BUY (bug)
     }
     // NOTE: VMC_CipherB and Reversal have NO side branch → side stays "BUY" always (bug)
   }
   ```
5. After `side`: `SafetyValidator.run(...)` → gates → inline sizing
   (`finalTradeSize`) and inline SL/TP (`price * (1 ± risk.stopLossPercent/100)`),
   then PAPER/LIVE order + `recordTrade` + `updateActivePosition`.

**Known entry-side bugs** (all "default to BUY"):
- SMC neutral (`trend === 0`) → BUY.
- Breakout price inside channel → BUY.
- VMC_CipherB / Reversal logic types → BUY always (no side branch exists).

## 3. Scope

**In scope (6a):**
1. Extract the verbatim entry-side rule into a pure, tested function
   `legacyManualSide(logicType, strategyData, price) → 'BUY' | 'SELL'`. `bot_engine`
   calls it on the OFF path — byte-identical to today.
2. Characterization (golden-master) tests: `legacyManualSide` (the real OFF code)
   vs core `deriveSignal`, asserting parity **except** the documented diffs (§5).
3. Feature flag `USE_SIGNAL_CORE_MANUAL` (env, default OFF; per-strategy config
   override) selecting the entry-side source. ON routes the side through
   `deriveSignal`; `HOLD` short-circuits the entry (no trade).
4. Shell regression: position-lock + exit logic identical in both flag states.

**Out of scope (deferred, documented):**
- Unifying `bot_engine`'s sizing / SL-TP / safety with `RiskPolicy`. 6a achieves
  **entry-signal (side/timing) parity**; risk-model parity (trade *magnitude*,
  SL/TP levels) is a deliberate later phase. Backtest faithfulness is therefore
  staged: signal parity now, risk parity later.
- The AI agent migration → **Phase 6b**.
- Any `frontend/` change.

## 4. Architecture — the flagged seam

Pure core / imperative shell boundary (parent spec §2) maps exactly onto the two
characterization layers:

```
        flat (no open position)            position open
                │                                │
                ▼                                ▼
   ┌─ entry-side decision (BRAIN) ─┐     shell: lock + exit (SL/TP)
   │  OFF: legacyManualSide(...)   │     ── UNCHANGED in 6a ──
   │  ON : deriveSignal(...).side  │
   │       HOLD → skip entry       │
   └───────────────────────────────┘
                │
                ▼
   safety checks → inline sizing/SL-TP → order   (UNCHANGED in 6a)
```

**Flag resolution** (idiomatic — project reads flags via `process.env.*`):
- `useSignalCore = strategyConfig.useSignalCore ?? (process.env.USE_SIGNAL_CORE_MANUAL === 'true')`
- Per-strategy config override beats env; env default is OFF (unset/anything but
  `'true'`). A single env flip is the global kill-switch; a config field opts one
  strategy in for observation before a global rollout.

**ON-path entry logic:**
```js
const raw = indicatorManager.calculate(logicType, candles);   // unchanged call
const signal = deriveSignal(logicType, raw, { price, candles });
if (signal.side === 'HOLD') {
  // documented fix: no spurious entry when flat with no real signal
  log/skip; continue to next symbol;
}
side = signal.side;   // 'BUY' | 'SELL'
// falls through to existing safety + sizing + execution unchanged
```
`strategyData` for the safety validator stays the same `raw` object, so safety
checks are unaffected by the flag.

**`logicType` normalization:** `deriveSignal` upper-cases internally
(`SMC|VMC_CIPHERB|BREAKOUT|REVERSAL`). `bot_engine`'s resolved `logicType`
("Breakout"/"SMC"/template `type`) is passed through as-is; an unknown/unsupported
type on the ON path is treated as a configuration error surfaced in logs, OFF path
behavior is unchanged.

## 5. Documented intentional diffs (asserted explicitly)

| Case | Legacy `bot_engine` side | Core `deriveSignal` | Test assertion |
|---|---|---|---|
| SMC `trend === 1` | BUY | BUY | **equal** |
| SMC `trend === -1` | SELL | SELL | **equal** |
| SMC `trend === 0` (neutral) | BUY | **HOLD** | documented diff #1 |
| Breakout active, `price > top` | BUY | BUY | **equal** |
| Breakout active, `price < bottom` | SELL | SELL | **equal** |
| Breakout active, inside channel | BUY | **HOLD** | documented diff #1 |
| Breakout channel inactive | BUY (default) | **HOLD** | documented diff #1 |
| VMC_CipherB (wt cross up/down) | BUY (always) | **BUY/SELL by wt-cross** | documented diff #2 |
| VMC_CipherB (no cross) | BUY | **HOLD** | documented diff #2 |
| Reversal (rejection bull/bear) | BUY (always) | **BUY/SELL by rejection** | documented diff #3 |
| Reversal (no rejection) | BUY | **HOLD** | documented diff #3 |

Diffs #1–#3 are exactly the three intentional changes named in the parent spec
(§4): neutral→HOLD, WaveTrend gains a real side, Reversal uses rejection logic.

## 6. Testing plan

Plain `node:assert` scripts, run via `node tests/<file>.js` from repo root. No test
framework, no new dependencies. Candle/indicator fixtures are small inline objects
(the shapes `IndicatorManager.calculate` returns per logic type), not network data.

1. **`test_legacy_manual_side.js`** — pins `legacyManualSide` against the verbatim
   rule (BUY default; SMC trend mapping with neutral→BUY; Breakout inside→BUY;
   VMC/Reversal→BUY). Proves the extraction is byte-identical to the old inline code.
2. **`test_manual_characterization.js`** — the golden-master: for a battery of
   `(logicType, strategyData, price)` fixtures, compare `legacyManualSide` vs
   `deriveSignal(...).side`, asserting equality on the "equal" rows of §5 and the
   exact documented value on the diff rows. This is the safety net.
3. **`test_manual_flag_routing.js`** — unit test of the seam helper (the function
   that resolves the flag and returns the side / HOLD-skip signal): OFF → legacy
   side; ON → core side; ON + HOLD → skip sentinel. Pure, no DB.
4. **Shell regression note** — the position-lock/exit branch is not touched by 6a;
   it has no dependency on the flag. Covered by inspection + the existing
   integration smoke (no behavioral edit to assert).

All four must be green; the existing backtest test suite must stay green
(`register_edit` after edits to keep the index fresh).

## 7. Conventions

- **Casing:** snake_case in DB/JSON storage, camelCase in JS runtime. `logicType`,
  `useSignalCore` are camelCase runtime keys. No `*Pct` math here.
- **Server-side logic priority:** all of this is engine-side; no frontend.
- **Determinism:** the entry-side decision stays pure (no `Date.now()`/random);
  `legacyManualSide` and `deriveSignal` are both pure functions of their inputs.
- **Strangler discipline (parent §10):** OFF = current behavior, byte-identical.
  The branch does **not** merge until all phases are green and flags default OFF.

## 8. Module layout (paths finalized in the plan)

- `src/manual/legacyManualSide.js` — extracted verbatim OFF-path side rule (new).
- `src/manual/resolveEntrySide.js` *(optional)* — the flag-resolving seam helper
  used by `bot_engine` (OFF→legacy, ON→core, HOLD→skip), or inlined into
  `bot_engine.js` if cleaner.
- `bot_engine.js` — calls the seam instead of the inline `if (logicType) {...}`
  block; otherwise unchanged.
- `tests/test_legacy_manual_side.js`, `tests/test_manual_characterization.js`,
  `tests/test_manual_flag_routing.js` — new.

## 9. Risks & mitigations

- **Risk:** extraction subtly changes the OFF decision. **Mitigation:** test #1
  pins it verbatim; OFF path is the default, so any drift is caught before it can
  affect anyone.
- **Risk:** ON path skips a trade the old code would have taken (neutral→HOLD).
  **Mitigation:** this is the intended fix; flag defaults OFF, opt-in per strategy,
  bounded to *entry when flat* (position-lock means it cannot churn open positions).
- **Risk:** sizing/SL-TP still diverge from the backtest shell. **Mitigation:**
  explicitly out of scope and documented (§3); 6a only claims signal parity.

## 10. Non-goals (6a)

Risk-model unification (RiskPolicy in the manual path); AI agent migration (6b);
multi-symbol roll-up; any frontend; new dependencies; changes to the position-lock
or exit logic.
