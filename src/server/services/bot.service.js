import { spawn } from 'child_process';
import { getDB } from '../../../db.js';

class BotService {
  constructor(io) {
    this.activeBots = new Map();
    this.io = io;
  }

  async spawnBot(strategyId) {
    const botProcess = spawn('node', ['bot_engine.js'], {
      stdio: 'inherit',
      env: { ...process.env, STRATEGY_ID: strategyId }
    });

    botProcess.on('exit', (code) => {
      console.log(`Bot for strategy ${strategyId} exited with code ${code}`);
      this.activeBots.delete(Number(strategyId));
      getDB().run('UPDATE strategies SET status = ? WHERE id = ?', ['stopped', strategyId]).catch(console.error);
      this.io.emit('event:update', {
        strategyId,
        type: 'status_change',
        payload: { status: 'stopped' }
      });
    });

    this.activeBots.set(Number(strategyId), botProcess);
    await getDB().run(
      'UPDATE strategies SET status = ?, last_run = CURRENT_TIMESTAMP WHERE id = ?',
      ['running', strategyId]
    );

    this.io.emit('event:update', {
      strategyId,
      type: 'status_change',
      payload: { status: 'running' }
    });

    return botProcess;
  }

  async stopBot(strategyId) {
    const botProcess = this.activeBots.get(Number(strategyId));
    if (botProcess) {
      botProcess.kill('SIGTERM');
      this.activeBots.delete(Number(strategyId));
    }
    const db = getDB();
    await db.run('UPDATE strategies SET status = ? WHERE id = ?', ['stopped', strategyId]);
    this.io.emit('event:update', {
      strategyId,
      type: 'status_change',
      payload: { status: 'stopped' }
    });
  }

  async restartBot(strategyId) {
    await this.stopBot(strategyId);
    return this.spawnBot(strategyId);
  }

  isActive(strategyId) {
    return this.activeBots.has(Number(strategyId));
  }
}

export const botService = new BotService();