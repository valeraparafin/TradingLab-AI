# Reliability & Infrastructure Roadmap

This document outlines the technical improvements needed to transition from Paper Trading to a production-ready live trading system.

## 1. Exchange Synchronization (Reconciliation)
- [ ] **Current State**: Local DB is the source of truth.
- [ ] **Goal**: Implement a synchronization loop that checks real exchange positions against the local DB.
- [ ] **Details**: 
    - Periodically fetch open positions from BitGet API.
    - Automatically close local positions if they are no longer open on the exchange.
    - Alert the user if a position exists on the exchange but not in the DB.

## 2. Professional Order Execution
- [ ] **Current State**: Market orders triggered by bot monitoring.
- [ ] **Goal**: Use exchange-side Stop-Loss and Take-Profit orders.
- [ ] **Details**:
    - Immediately place SL/TP limit orders upon opening a position.
    - This ensures the trade is closed even if the bot server is offline.

## 3. Network & API Resilience
- [ ] **Current State**: Basic try-catch blocks.
- [ ] **Goal**: Implement robust error handling for API calls.
- [ ] **Details**:
    - Exponential backoff for API rate limits (429 errors).
    - Circuit breaker pattern for exchange connectivity issues.

## 4. Disaster Recovery
- [ ] **Current State**: Local SQLite DB.
- [ ] **Goal**: Ensure data persistence and recovery.
- [ ] **Details**:
    - Automated database backups.
    - Health-check heartbeat to notify the user if the bot process crashes.
