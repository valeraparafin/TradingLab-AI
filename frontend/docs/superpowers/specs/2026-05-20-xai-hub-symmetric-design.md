# Design Spec: XAI Intelligence Hub (Symmetric Minimalist)

## Date: 2026-05-20
## Status: Final Design (Approved)

## 1. Purpose
To transform the XAI Intelligence Hub from a collection of disparate bars into a unified, professional instrument panel. The goal is to provide instant, intuitive understanding of whether a strategy's safety rules are Bullish, Bearish, or Neutral, while maintaining a high-end minimalist aesthetic and supporting multi-asset strategies.

## 2. Visual Concept: "Symmetric Minimalist"
The design avoids "AI slop" aesthetics (no heavy glows, no generic gradients). It focuses on geometric precision and a clean, light-themed palette.

### Core Visual Primitive: The Symmetric Bar
Instead of a 0-100% progress bar, every indicator is represented by a bar centered at zero.

- **Center Point**: A subtle vertical marker at 50%.
- **Directionality**: 
  - Values $\rightarrow$ grow to the **Right** (Positive/Bullish/Active).
  - Values $\leftarrow$ grow to the **Left** (Negative/Bearish/Inactive).
- **Geometry**: 
  - Thickness: 8px (Balanced presence).
  - Radius: Full rounding (`rounded-full`).
  - Track: Light grey (`zinc-100`).

### 3. Color Palette
| State | Color | Tailwind Class | Meaning |
| :--- | :--- | :--- | :--- |
| **Strong Bullish/Active** | Emerald | `bg-emerald-500` | High confidence / Signal Matched |
| **Weak Bullish/Positive** | Soft Emerald | `bg-emerald-300` | Developing momentum |
| **Neutral** | Zinc | `bg-zinc-400` | Balanced/Inactive |
| **Weak Bearish/Negative** | Soft Rose | `bg-rose-300` | Developing bearishness |
| **Strong Bearish/Inactive** | Rose | `bg-rose-500` | High confidence failure / Strong Bearish |

## 4. Indicator Mapping Logic

| Indicator Type | Calculation Logic | Visual Representation | Label |
| :--- | :--- | :--- | :--- |
| **Oscillators** (WaveTrend, MFI) | `Math.abs(value)` for width, `sign(value)` for direction | Symmetric bar growing L or R | `±XX.X%` |
| **Binary Signals** (Cross, Diamond) | `pass ? 100 : 0` | Full Right (Pass) or Full Left (Fail) | `ACTIVE` / `INACTIVE` |
| **Trend/States** (Trend Detected) | `Bullish=100, Bearish=-100, Neutral=0` | Full Right / Full Left / Center | `BULLISH` / `BEARISH` / `NEUTRAL` |

## 5. Multi-Asset Support (Multi-Symbol)
Since a strategy can trade multiple instruments, the Hub must avoid "data flickering" and provide per-symbol context.

### Data Architecture
- State will transition from single values to a Map: `{ [symbol: string]: { gci: number, results: RuleResult[] } }`.
- Incoming Socket.io events will be stored per symbol.

### Symbol Selector UI
- **Symbol Pills**: A horizontal scrollable list of symbols (e.g., BTCUSDT, ETHUSDT) placed at the top of the XAI Hub.
- **Status Indicator**: Each pill contains a tiny color-coded dot reflecting that symbol's current GCI.
- **Active State**: The selected symbol is highlighted; all gauges and rules update to show that symbol's data.
- **Deep Linking**: Clicking the "AI" icon in the "Active Positions" table will automatically select the corresponding symbol in the Hub.

## 6. Component Architecture

### `SymmetricBar` (Internal Component)
- **Props**: `value` (normalized -1 to 1), `type` (oscillator | binary).
- **Animation**: `framer-motion` spring transition for the `width` and `left` properties.
- **Hover**: Subtle `translate-y-[-2px]` and an overlay showing the `actual` raw value from the backend.

### `RuleConfidenceList` (Parent)
- **Layout**: Responsive grid (1 col mobile, 3 cols desktop).
- **Container**: White card (`bg-white`), `border-zinc-200`, `shadow-sm`.
- **Header**: `zinc-50` background, `zinc-400` uppercase tracking text.

## 7. Success Criteria
- No "burned" edges or intrusive glows.
- All indicators (including WaveTrend) follow the same symmetric visual language.
- Zero confusion between "0%" (empty) and "-60%" (strong signal left).
- Immediate visual recognition of Bullish (Right) vs Bearish (Left).
- Seamless switching between different trading symbols without data overlap.
