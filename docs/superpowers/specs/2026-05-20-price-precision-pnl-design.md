---
name: Dynamic Price Precision and Server-side PnL Percentage
description: Implementation of asset-specific price precision and server-calculated PnL percentages for Active Positions
type: design
date: 2026-05-20
---

# Design: Dynamic Price Precision and Server-side PnL Percentage

## 1. Problem Statement
Currently, the "Active Positions" table in the Strategy Details page uses a hard-coded `.toFixed(2)` for all price and PnL values. This leads to:
- Loss of precision for low-value assets where a few cents represent significant movement.
- Lack of clarity in PnL display (absolute value is shown without currency or relative percentage).

## 2. Goals
- Implement dynamic price formatting based on the asset's actual exchange precision (tick size).
- Display PnL as both an absolute value in USDT and a relative percentage.
- Adhere to the architectural principle: **Math and Logic on Server, Display on Frontend**.

## 3. Technical Design

### 3.1 Backend Changes

#### A. Precision API
- **Endpoint**: `GET /api/precision?symbol=SYMBOL`
- **Logic**: Use the existing `PrecisionManager` to fetch the precision (decimal places) for the given symbol from the Binance API.
- **Response**: `{ "symbol": "BTCUSDT", "precision": 2 }`

#### B. Position Data Enhancement
- **Socket Event**: `position_active`
- **Change**: Add `pnl_percent` to the payload.
- **Calculation**: $\frac{\text{Unrealized PnL}}{\text{Position Cost}} \times 100$
- **Updated Payload**:
  ```json
  {
    "type": "position_active",
    "payload": {
      "symbol": "...",
      "entry_price": ...,
      "current_price": ...,
      "pnl": ...,
      "pnl_percent": ...,
      "stop_loss": ...,
      "take_profit": ...
    }
  }
  ```

### 3.2 Frontend Changes

#### A. Precision Integration
- **State**: Add `precision` state to `StrategyDetails.tsx`.
- **Fetch**: Request precision from the new API when the strategy is loaded or when a new position symbol is encountered.
- **Formatting**: Replace all instances of `.toFixed(2)` for prices (`entryPrice`, `currentPrice`, `sl`, `tp`) with `.toFixed(precision)`.

#### B. UI Updates (Active Positions Table)
- **PnL Column**: Update display format to `{sign}{pnl} USDT ({sign}{pnl_percent}%)`.
- **Types**: Update `Position` interface to include `pnl_percent: number`.

## 4. Success Criteria
- Prices for different assets (e.g., BTC vs. a low-priced altcoin) are displayed with their correct exchange precision.
- PnL column shows both absolute USDT value and relative percentage.
- No mathematical calculations for PnL% are performed on the frontend.
