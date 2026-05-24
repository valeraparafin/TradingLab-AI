import { spawn } from 'child_process';

const API_URL = 'http://localhost:3000/api';
const BOT_CMD = 'node';
const BOT_ARGS = ['bot_engine.js'];

async function runTest() {
  console.log('--- Strategy Lifecycle Smoke Test ---');
  try {
    // 1. Create Strategy
    console.log('[ ] Strategy Created...');
    const createRes = await fetch(`${API_URL}/strategies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'SmokeTest_Strategy',
        riskTemplateId: 'default_risk',
        logicTemplateId: 'default_logic',
        watchlist: ['BTCUSDT', 'ETHUSDT'],
        portfolioValue: 1000,
      }),
    });
    if (!createRes.ok) throw new Error(`Failed to create strategy: ${createRes.status}`);
    const { id: strategyId } = await createRes.json();
    console.log('✅ OK');

    console.log('RESULT: PASSED');
  } catch (e) {
    console.log('RESULT: FAILED');
    console.error(e);
    process.exit(1);
  }
}

runTest();
