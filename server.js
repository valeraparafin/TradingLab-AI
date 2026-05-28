import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promises as fsp } from 'fs';
import { z } from 'zod';
import { initDB, getDB, createStatsView } from './db.js';

import { botService } from './src/server/services/bot.service.js';
import { strategyService } from './src/server/services/strategy.service.js';
import { assetService } from './src/server/services/asset.service.js';
import templateRouter from './src/server/routes/template.routes.js';
import strategyRouter from './src/server/routes/strategy.routes.js';
import analyticsRouter from './src/server/routes/analytics.routes.js';
import assetRouter from './src/server/routes/asset.routes.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

app.use('/api/templates', templateRouter);
app.use('/api', strategyRouter);
app.use('/api/strategies', strategyRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/assets', assetRouter);



/**
 * POST /event
 * Endpoint for bot_engine.js to report real-time events.
 */
app.post('/event', async (req, res) => {
  const eventData = req.body;
  const strategyId = eventData.strategyId;
  console.log(`[Event Received] Strategy ${strategyId}: ${eventData.type}`);

  try {
    const db = getDB();
    // Automatically mark strategy as running in DB since it's sending events
    await db.run('UPDATE strategies SET status = ? WHERE id = ?', ['running', strategyId]);

    // Insert main event to get eventId
    const result = await db.run(
      'INSERT INTO events (strategy_id, type, payload, timestamp) VALUES (?, ?, ?, ?)',
      [strategyId, eventData.type, JSON.stringify(eventData.payload || {}), Date.now()]
    );
    const eventId = result.lastID;

    // If safety_check event with results, store rule scores
    if (eventData.type === 'safety_check' && Array.isArray(eventData.payload?.results)) {
      await Promise.all(
        eventData.payload.results.map(result =>
          db.run(
            'INSERT INTO event_scores (event_id, rule_id, score, actual_value) VALUES (?, ?, ?, ?)',
            [eventId, result.label, result.score, result.actual]
          )
        )
      );
    }
  } catch (err) {
    console.error(`[Event Error] Failed to process event for strategy ${strategyId}: ${err.message}`);
  }

  // Emit to all connected WebSocket clients
  io.emit('event:update', eventData);
  res.sendStatus(200);
});

async function syncStrategies() {
  // This function is now a legacy stub.
  // Strategies are managed via API and DB, not via the /strategies folder.
  console.log(`[Sync] Strategy synchronization from filesystem is disabled (SSOT mode).`);
}

// ─── Initialization ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDB();
    await createStatsView();
    await assetService.init();
    await syncStrategies();
    botService.setIo(io);
    // Reset all strategy statuses to 'stopped' on startup since child processes are gone
    await getDB().run('UPDATE strategies SET status = ? WHERE status = ?', ['stopped', 'running']);
    httpServer.listen(PORT, () => {
      console.log(`🚀 Orchestrator Server running on http://localhost:${PORT}`);
      console.log(`🔌 WebSocket server enabled`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
