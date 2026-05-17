# Design Spec: Strategy Archiving and Deletion System

## Date: 2026-05-17
## Status: Approved

### 1. Overview
The goal is to implement a "Recycle Bin" pattern for trading strategies. Instead of immediate deletion, strategies will first be moved to an archive. Only from the archive can they be permanently deleted. This prevents accidental loss of trading history and configuration.

### 2. Data Model Changes

#### Database (`trading_lab.db`)
- **Table `strategies`**: Add a new column `is_archived` (BOOLEAN, default: `FALSE`).
- **Existing constraints**: The `ON DELETE CASCADE` on the `trades`, `events`, and `active_positions` tables will be leveraged for permanent deletion.

#### File System (`/strategies`)
- **Archiving**: The `.json` configuration file remains on disk.
- **Permanent Deletion**: The `.json` configuration file is deleted from the `/strategies` folder.

### 3. API Design (Backend - `server.js`)

#### `POST /api/strategies/archive`
- **Input**: `{ "strategyId": number }`
- **Logic**:
    1. Call `stopBot(strategyId)` to ensure the process is killed.
    2. Update `strategies` table: `SET is_archived = TRUE WHERE id = ?`.
- **Response**: `{ "status": "archived", "strategyId": number }`

#### `POST /api/strategies/restore`
- **Input**: `{ "strategyId": number }`
- **Logic**: Update `strategies` table: `SET is_archived = FALSE WHERE id = ?`.
- **Response**: `{ "status": "restored", "strategyId": number }`

#### `DELETE /api/strategies/:id`
- **Input**: `strategyId` (URL parameter)
- **Logic**:
    1. Verify `is_archived === TRUE`. If not, return `400 Bad Request` (must archive first).
    2. Delete record from `strategies` table.
    3. Delete corresponding `.json` file from `/strategies` directory using the slugified name.
- **Response**: `{ "status": "permanently_deleted", "strategyId": number }`

#### `GET /api/strategies` (Update)
- **Query Param**: `archived` (boolean).
- **Logic**:
    - If `archived=true` $\rightarrow$ return only strategies where `is_archived = TRUE`.
    - If `archived=false` or omitted $\rightarrow$ return only strategies where `is_archived = FALSE`.

### 4. User Interface Design (Frontend - `StrategyHub.tsx`)

#### Layout
- **Tab Navigation**: Add a tab switcher: `[ Active Strategies ]` | `[ Archive ]`.

#### Active Tab
- **Action**: Add "Archive" button to each strategy row.
- **UX**: Confirmation dialog: *"Archive this strategy? It will be stopped and moved to the archive."*

#### Archive Tab
- **Action 1: Restore**: Button to move strategy back to the active list.
- **Action 2: Permanently Delete**: Red button.
- **UX**: Strict confirmation modal: *"WARNING! This operation is irreversible. All trade history and the configuration file will be permanently deleted."*

### 5. Success Criteria
- [ ] Strategies can be moved to archive and disappear from the main list.
- [ ] Archived strategies are automatically stopped.
- [ ] Archived strategies can be restored to the active list.
- [ ] Only archived strategies can be permanently deleted.
- [ ] Permanent deletion removes both the DB record and the physical `.json` file.
- [ ] UI clearly separates active and archived strategies.
