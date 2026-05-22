import express from 'express';
import { getDB } from '../../db/db.js';
import { Server } from 'socket.io';

const router = express.Router();

// Middleware to inject Socket.io instance into request
router.use((req, res, next) => {
  if (!req.app.locals.io) {
    return res.status(500).json({ error: 'Socket.io not initialized' });
  }
  req.io = req.app.locals.io;
  next();
});

/**
 * POST /
 * Endpoint for bot_engine.js to report real-time events.
 */
router.post('/', async (req, res) => {
  const eventData = req.body;
  const strategyId = eventData.strategyId;
  console.log(`[Event Received] Strategy ${strategyId}: ${eventData.type}`);

  try {
    const db = getDB();
    // Automatically mark strategy as running in DB since it's sending events
    await db.run('UPDATE strategies SET status = ? WHERE id = ?', ['running', strategyId]);

    // Insert main event to get eventId
    const result = await db.run(
      'INSERT INTO events (strategy_id, type, payload, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [strategyId, eventData.type, JSON.stringify(eventData.payload || {})]
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
  req.io.emit('event:update', eventData);
  res.sendStatus(200);
});

export default router;
