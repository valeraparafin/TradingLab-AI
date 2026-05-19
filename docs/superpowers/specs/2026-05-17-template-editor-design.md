# Design Spec: Template Editor for Trading Bots

## Status
- **Date:** 2026-05-17
- **Status:** Approved
- **Owner:** Claude Code

## Overview
The Template Editor is a CRUD interface that allows users to manage trading logic and risk templates without manually editing JSON files on the server. It replaces the static file-editing workflow with a web-based management system.

## Core Principles
1. **File-Based Storage:** Templates continue to be stored as JSON files in `/templates/logic` and `/templates/risk` to maintain Git traceability and ease of manual debugging.
2. **Safety Lock:** A template cannot be edited or deleted if it is currently used by any active bot process.
3. **Master-Detail UX:** A side-by-side layout for efficient browsing and editing of multiple templates.

## Technical Architecture

### 1. Locking Mechanism
A template is considered **Locked** if any strategy using it is currently running.
- **Check Logic:**
    1. Query `strategies` table for all strategies where `config.metadata.logicTemplateId == templateId` or `config.metadata.riskTemplateId == templateId`.
    2. Check if any of these strategies have `status == 'running'` in the database OR are present in the `activeBots` Map in `server.js`.
- **Enforcement:**
    - UI: Disable "Edit" and "Delete" buttons.
    - API: Return `403 Forbidden` for `PUT` and `DELETE` requests on locked templates.

### 2. API Specification (`server.js`)

| Endpoint | Method | Description | Validation/Notes |
| :--- | :--- | :--- | :--- |
| `/api/templates` | `GET` | Lists all logic/risk templates | Includes `isLocked` and `usedBy` array |
| `/api/templates/:type/:id` | `GET` | Gets content of a specific template | `type` is `logic` or `risk` |
| `/api/templates/:type` | `POST` | Creates a new template | Generates ID via `slugify(name)` |
| `/api/templates/:type/:id` | `PUT` | Updates a template | **Lock Check Required** |
| `/api/templates/:type/:id` | `DELETE` | Deletes a template | **Lock Check Required** |
| `/api/templates/:type/:id/duplicate` | `POST` | Duplicates a template | Takes `newName` in body |

### 3. User Interface (Frontend)

#### Layout: Master-Detail Page
- **Top Bar:**
    - Tabs: `[ Logic ]` | `[ Risk ]`
    - Action: `[ + Create New ]`
- **Left Panel (Master):**
    - Search input for filtering templates.
    - List of template cards showing:
        - Name
        - Lock Status (🔒 / ✅)
        - Usage count (e.g., "Used by 3 strategies")
- **Right Panel (Detail):**
    - **Empty State:** Prompt to select a template.
    - **Editor State:**
        - Header: Name input, `[ Duplicate ]`, `[ Delete ]`, `[ Save ]`.
        - Main Area: JSON editor with syntax highlighting and basic validation.
        - Lock Banner: Visible when `isLocked: true`, listing active strategies and disabling the "Save" button.

## Data Flow
1. **Loading:** `Page Mount` $\rightarrow$ `GET /api/templates` $\rightarrow$ Populate Left List.
2. **Selecting:** `Click Template` $\rightarrow$ `GET /api/templates/:type/:id` $\rightarrow$ Populate Editor.
3. **Saving:** `Click Save` $\rightarrow$ `PUT /api/templates/:type/:id` $\rightarrow$ Server validates lock $\rightarrow$ Writes to disk $\rightarrow$ Success/Error response.
4. **Duplicating:** `Click Duplicate` $\rightarrow$ `POST /api/templates/.../duplicate` $\rightarrow$ Server creates copy $\rightarrow$ New template added to list.

## Success Criteria
- [ ] Users can create, edit, and delete templates via the UI.
- [ ] Templates are correctly saved as JSON files in the filesystem.
- [ ] Locked templates cannot be edited or deleted (verified via UI and API).
- [ ] The Master-Detail layout provides a fluid experience for managing multiple templates.
