import { spawn } from 'child_process';

const API_URL = 'http://localhost:3000/api';
const BOT_CMD = 'node';
const BOT_ARGS = ['bot_engine.js'];

async function runTest() {
  console.log('--- Strategy Lifecycle Smoke Test ---');
  try {
    const strategyName = `SmokeTest_${Date.now()}`;
    console.log(`[ ] Strategy Created (${strategyName})...`);
    const createRes = await fetch(`${API_URL}/strategies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: strategyName,
        riskTemplateId: 'default_risk',
        logicTemplateId: 'default_logic',
        watchlist: ['BTCUSDT', 'ETHUSDT'],
        portfolioValue: 1000,
      }),
    });
    const { id: strategyId } = await createRes.json();
    console.log('✅ OK');

    console.log('[ ] First Launch (GCI detected)...');
    const bot = spawn(BOT_CMD, [...BOT_ARGS, strategyId.toString()], { stdio: ['ignore', 'pipe', 'pipe'], shell: true });

    const gciDetected = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 30000);
      bot.stdout.on('data', (data) => {
        console.log(`BOT LOG: ${data.toString()}`);
        if (data.toString().includes('Global Confidence Index (GCI):')) {
          clearTimeout(timeout);
          resolve(true);
        }
      });
    });

    console.log(`GCI Detected: ${gciDetected}`);
    bot.kill();
  } catch (e) {
    console.error('Error:', e);
  }
}

runTest();
