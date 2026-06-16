# Live Order-Book Feed + Feature Extractor + Recorder (SP1) — Design Spec

**Date:** 2026-06-14
**Status:** DESIGN — pending user review → writing-plans → implementation.
**Type:** live-data infrastructure (first of four sub-projects toward an order-book-confirmed
breakout AI strategy).

## Context: why this exists

Two frozen blind-test scouts (B+ scalp-breakout, post-pump-dump swing) proved the **candle-only**
skeleton of the ProScalper trader's strategy is ≈ 0 after costs, and that the real edge is the
**order book / tape** — the timing oracle for both his upside breakout and his post-pump breakdown
("скатывается"). Those two setups are, in the trader's mind, **one breakout strategy** with two
directions. The order book is invisible historically (no free L2 depth), so the edge was never
testable. This sub-project builds the missing piece: a live L2 + tape feed that also **records to
disk**, turning "un-backtestable" into "replayable going forward."

This is **SP1** of a 4-part decomposition (each its own spec → plan → implementation):

1. **SP1 (this spec)** — live OB feed + feature extractor + recorder. Foundation; no trading.
2. **SP2** — `withOrderBookGate` + the unified order-book signal. The order book drives **two**
   setup families: (a) **breakout-confirm** (scalp up / post-pump-down breakdown — take the break
   only when the book confirms impulse), and (b) **bounce-off-density / "отскок от плотности"**
   (price approaches a large resting wall that *holds* — not eaten — → mean-reversion entry off the
   wall, as on TON/SUI). Both families read the SAME SP1 features. Deterministic gate decides;
   paper-forward decision log (gated vs ungated).
3. **SP3** — LLM analyst consuming OB features + candles + context → `QualitativeProposal`;
   gate still vetoes.
4. **SP4** — wire into the live `AgentOrchestrator.runCycle` + the `/ai` cockpit (Order Flow lens).

**Discipline:** edge source = live L2 + LLM judgment; the deterministic OB gate decides, the LLM
judges on top; feed = Binance public websockets (free, keyless) — **futures depth as the primary
book + spot depth as an additional confirmation**; execution stays BitGet/paper futures;
**paper-forward only** (L2 has no history to backtest).

**Dual book — futures primary, spot confirms (from the trader):** the ProScalper trades and reads
the **futures** order book (the DOM ladder he executes on, e.g. GPSUSDT BINANCE-FUT) — that is the
primary signal. He **additionally** checks the **spot** book, because spot exposes liquidity/volume
the futures DOM hides ("на фьючерсах этого не видно"). So a breakout is taken on the futures book
and *confirmed* against the spot book. The strongest signal is on **illiquid microcaps** (GPSUSDT)
where a single wall (1–30M coins at one level) dominates the touch. SP1 therefore ingests **both**
books per symbol: futures depth (primary) and spot depth (confirmation).

---

## Section 1 — Architecture & data flow

One service maintains, **per symbol, two** correct local order books from live Binance streams —
**futures (primary)** and **spot (confirmation)** — computes numeric features from each, and records
raw frames to disk for replay. No trading, gate, or LLM in SP1 — data only.

Data flow (Binance canonical "manage a local order book", run once per book / venue):

1. On start, per symbol per venue: open the depth-diff ws and **buffer** events.
   - futures: `wss://fstream.binance.com/ws/<symbol>@depth@100ms`
   - spot: `wss://stream.binance.com:9443/ws/<symbol>@depth@100ms`
2. Fetch the REST snapshot (top-N, e.g. 20 levels) → `lastUpdateId`.
   - futures: `https://fapi.binance.com/fapi/v1/depth`
   - spot: `https://api.binance.com/api/v3/depth`
3. Drop buffered events older than the snapshot, apply the snapshot, then apply diff events by
   **sequence continuity** (`U`/`u`). On a gap → that book is marked `stale` and re-snapshotted.
   (Note: futures and spot use slightly different diff-sync rules — `pu`/`u` chaining on futures vs
   `U`/`u` overlap on spot; `LocalOrderBook` takes the venue's rule as a parameter.)
4. In parallel, the **futures** `<symbol>@aggTrade` ws → rolling window of recent prints (the tape;
   the prints the trader watches on the ladder are the futures tape).
5. Each update: each `LocalOrderBook` → `obFeatures` (book) + `tapeFeatures` (futures tape) →
   exposed via `getFeatures(symbol)` (synchronous snapshot, futures primary + spot confirm) and an
   event.
6. `Recorder` writes **every** raw diff and trade for both venues to JSONL with timestamps → a
   private L2 dataset.

**Honesty invariant:** the **primary** book is futures. Until the futures book is synced,
`getFeatures` returns `{ ready:false }` and the SP2 gate must treat it as "no confirmation" →
veto/HOLD. The spot book is a *confirmation* layer with its own `spotReady` flag: if spot is stale
or the symbol has no spot listing, `ready` can still be `true` on futures, but the spot-confirm
features are flagged absent so the gate can choose to require or relax spot confirmation. We never
trade on a stale futures book. Worst case = "missed a trade," never "traded on garbage."

**Boundary (YAGNI):** Binance public futures + spot only, top-N depth only, no BitGet book, no
gate/LLM/execution in SP1. Tape from futures only (spot tape not needed for confirmation).

**Symbol mapping & illiquid coins:** the signal is strongest on illiquid microcaps (GPSUSDT). The
primary (futures) symbol always exists for a coin we trade; the **spot** symbol may be absent
(futures-only listing). The feed takes an explicit `{ futures, spot }` ticker pair per watched
symbol; a missing spot symbol → `spotReady:false` (never crashes), futures stays primary. Illiquid
books are **sparse** (few, wide levels) — depth window and top-N must tolerate empty/wide rungs; the
near-touch wall is preserved as the signal even when deeper levels are empty.

## Section 2 — Components & feature contract

Discipline: pure core + thin IO (same as `pumpDump.js` / `scalpBreakout.js`).

| File | Responsibility | Type |
|------|----------------|:--:|
| `src/marketdata/orderbook/BinanceDepthClient.js` | Thin IO for one venue: ws `@depth@100ms` (+ `@aggTrade` on futures), REST snapshot, emits raw events. Reconnect/backoff. Venue (`futures`\|`spot`) + endpoints injected. | IO |
| `src/marketdata/orderbook/LocalOrderBook.js` | Applies snapshot + diffs; keeps sorted bids/asks (top-N); detects gap → `stale`. Pure logic over passed-in events; the venue sequence rule (`U`/`u` spot vs `pu`/`u` futures) is a constructor param. | core |
| `src/marketdata/orderbook/obFeatures.js` | **PURE** `computeBookFeatures(book)` → numbers from book state. | core |
| `src/marketdata/orderbook/tapeFeatures.js` | **PURE** `computeTapeFeatures(trades, now)` → numbers from the tape window. | core |
| `src/marketdata/orderbook/Recorder.js` | Appends raw diffs/trades to JSONL (rotation by symbol/day). | IO |
| `src/marketdata/orderbook/replay.js` | Reads JSONL → runs through `LocalOrderBook` + features (offline replay). | core |
| `src/marketdata/orderbook/OrderBookFeed.js` | Orchestrator: holds a futures + spot `LocalOrderBook` per symbol, merges into the dual-book `getFeatures(symbol)` snapshot + event; drives Recorder for both venues. | IO |
| `scripts/record-orderbook.mjs` | CLI: record-only mode (no trading). | driver |
| `tests/test_local_orderbook.mjs`, `tests/test_ob_features.mjs`, `tests/test_tape_features.mjs` | Unit tests on fixtures. | test |

**Feature contract — `getFeatures(symbol)`** (consumed later by the SP2 gate and SP3 LLM):

`getFeatures` returns a dual-book snapshot: `futures` (primary book + tape) and `spot` (confirmation
book). `ready` tracks the futures book; `spotReady` tracks the spot book independently. The
per-book feature object (`computeBookFeatures`) is the same shape for both venues.

```js
{
  ready: true,              // futures book synced; false → gate must not trade
  spotReady: true,          // spot confirmation available; false → spot.* is null
  ts: 1718380000123,        // snapshot time (ms)
  symbol: 'GPSUSDT',
  futures: {                // PRIMARY — Binance futures depth + tape
    // --- book (computeBookFeatures) ---
    mid: 0.007583,
    spread: 0.000001,
    microprice: 0.0075831,
    bidDepthNbps: 412000,   // Σ size on the bid side within X bps of mid (USD)
    askDepthNbps: 187000,
    imbalance: 0.375,       // (bid-ask)/(bid+ask) within window ∈ [-1,1]
    nearWallBid: { px: 0.00758, sizeUsd: 220000, distBps: 4.0 }, // largest level near touch
    nearWallAsk: { px: 0.00760, sizeUsd: 305000, distBps: 22.0 },
    // --- tape (computeTapeFeatures), window ~last N sec ---
    lastPrice: 0.007583,
    printVelocity: 12.4,      // trades/sec
    aggressorImbalance: 0.61, // (buy-aggr - sell-aggr)/total ∈ [-1,1]
    buyVolUsd: 88000, sellVolUsd: 21000,
  },
  spot: {                   // CONFIRMATION — Binance spot depth (book only; null if !spotReady)
    mid: 0.007580,
    spread: 0.000002,
    microprice: 0.0075801,
    bidDepthNbps: 980000,   // spot often deeper — exposes liquidity the futures DOM hides
    askDepthNbps: 240000,
    imbalance: 0.606,
    nearWallBid: { px: 0.00757, sizeUsd: 540000, distBps: 17.0 },
    nearWallAsk: { px: 0.00760, sizeUsd: 130000, distBps: 22.0 },
  }
}
```

**Explicitly NOT in SP1 (YAGNI):** the "wall-eaten event" (detecting a near-touch level being
rapidly consumed) needs history of states over time — a behavioral feature. It is built in **SP2**
inside the gate (which already needs cross-tick memory). SP1 stays a pure per-tick **snapshot**:
it emits raw `nearWall*` + `imbalance` for both books, and the gate computes the dynamics and the
futures-vs-spot agreement. No hidden time-state in SP1.

## Section 3 — Error handling / staleness + recording format + replay

Feed state machine (**per book** — futures and spot each run their own; `ready` follows the futures
book, `spotReady` the spot book): `INIT → SYNCING → READY → STALE → SYNCING …`

| State | When | `getFeatures().ready` |
|-------|------|:--:|
| `INIT` | before first snapshot | `false` |
| `SYNCING` | buffering diffs, awaiting/applying REST snapshot | `false` |
| `READY` | book synced, sequence continuous | `true` |
| `STALE` | `U/u` gap, ws reconnect, or `bestBid ≥ bestAsk` | `false` |

Transitions into `STALE` always trigger an auto re-snapshot (backoff). `ready:false` is not an
error surfaced outward — it is the normal "do not trade now" signal that the SP2 gate respects.

Guards:
- **Sequence-guard:** the next diff must satisfy `U ≤ lastUpdateId+1 ≤ u`; otherwise `STALE`.
- **Heartbeat / force-resync:** no updates for > `staleMs` (e.g. 10s) → `STALE`. Plus a scheduled
  re-snapshot every N minutes (insurance against drift).
- **Sanity:** `bestBid < bestAsk` and top-N non-empty, else `STALE`.
- **Reconnect:** exponential backoff (cap, e.g. 1s→30s); book invalid until re-snapshot.
- **Snapshot throttle:** snapshots queued/throttled to avoid REST rate limits with many symbols.

Recording format (JSONL, one line per event; `v` = venue `fut`|`spot`):
```jsonl
{"t":1718380000123,"sym":"GPSUSDT","v":"fut","k":"snapshot","lastUpdateId":77001,"bids":[["0.00758","220000"]],"asks":[["0.00760","305000"]]}
{"t":1718380000223,"sym":"GPSUSDT","v":"fut","k":"depth","U":77002,"u":77010,"pu":77001,"b":[["0.00758","195000"]],"a":[["0.00760","305000"]]}
{"t":1718380000231,"sym":"GPSUSDT","v":"fut","k":"trade","p":"0.007583","q":"14000","m":false}
{"t":1718380000260,"sym":"GPSUSDT","v":"spot","k":"depth","U":55102,"u":55108,"b":[["0.00757","540000"]],"a":[["0.00760","130000"]]}
{"t":1718380000900,"sym":"GPSUSDT","v":"fut","k":"state","state":"STALE","reason":"seq_gap"}
```
- One file per `symbol/venue/UTC-day`, rotated at midnight:
  `data/orderbook/GPSUSDT/fut/2026-06-14.jsonl` and `.../spot/2026-06-14.jsonl`.
- Raw frames written exactly as received (including snapshots and `state` events), so replay is
  bit-for-bit reproducible.
- These files are **data, not code**: untracked (like `market_data.db`), added to `.gitignore`.

Replay (`replay.js`): reads JSONL → feeds `LocalOrderBook` the same snapshots/diffs → emits an
**identical** feature stream to the live one. This is what turns "can't backtest" into "can replay":
the recorded books are debugged offline and (in SP2) the gate is run against them.

## Section 4 — Testing

All logic is pure functions on fixtures; IO (ws/REST/disk) is thin and not unit-tested.

**`tests/test_local_orderbook.mjs`** — the fragile sequence logic:
- snapshot + ordered diffs → assert final bids/asks state (top-N, sorting, level removal on size `0`).
- sequence gap (`U > lastUpdateId+1`) → state `STALE`.
- stale diff (`u ≤ lastUpdateId`) after snapshot → ignored, stays `READY`.
- `bestBid ≥ bestAsk` → `STALE`.

**`tests/test_ob_features.mjs`** — `computeBookFeatures(book)` on a fixture book:
- `mid` / `spread` / `microprice` arithmetic;
- `bidDepthNbps` / `askDepthNbps` sum only levels within X bps;
- `imbalance` ∈ [−1,1], correct sign;
- `nearWall*` picks the largest near-touch level with correct `distBps`;
- empty / one-sided book → `ready:false`.

**`tests/test_tape_features.mjs`** — `computeTapeFeatures(trades, now)`:
- window drops prints older than `windowMs`;
- `aggressorImbalance` from the `m` (maker side) flag computed correctly;
- `printVelocity` = trade count / window;
- empty window → zeros, not NaN.

**Replay as integration test:** on a small recorded JSONL fixture, `replay.js` must emit the same
feature stream that `LocalOrderBook` produced while recording (determinism / reproducibility).

**Manual smoke (not CI):** `node scripts/record-orderbook.mjs --symbols XRPUSDT --minutes 2` —
real connection, writes a file, prints a few `getFeatures` snapshots. Verifies live IO, not a test.

---

## Out of scope (SP1)

The gate, the breakout signal, the LLM, live execution, the cockpit wiring (all SP2–SP4); BitGet
order book; full-depth book (top-N only); the "wall-eaten" behavioral feature (SP2); multi-exchange.
