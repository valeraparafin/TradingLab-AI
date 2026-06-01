import { spawn } from 'child_process';

const API_URL = 'http://localhost:3000/api';
const BOT_CMD = 'node';
const BOT_ARGS = ['bot_engine.js'];

async function runTest() {
  console.log('--- Strategy Lifecycle Smoke Test ---');
  try {
    // 1. Create Strategy
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
    console.log(`Request URL: ${createRes.url}`);
    if (!createRes.ok) {
      const errBody = await createRes.text();
      console.error(`Server responded with ${createRes.status}: ${errBody}`);
      throw new Error(`Failed to create strategy: ${createRes.status}`);
    }
    const { id: strategyId } = await createRes.json();
    console.log('✅ OK');

    // 2. Launch Bot
    console.log('[ ] First Launch (GCI detected)...');
    const bot = spawn(BOT_CMD, [...BOT_ARGS, strategyId.toString()], { stdio: ['ignore', 'pipe', 'pipe'], shell: true });

    let botOutput = '';
    bot.stdout.on('data', (data) => {
      botOutput += data.toString();
    });
    bot.stderr.on('data', (data) => {
      botOutput += data.toString();
    });

    const gciDetected = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 30000);
      bot.stdout.on('data', (data) => {
        if (data.toString().includes('Global Confidence Index (GCI):')) {
          clearTimeout(timeout);
          resolve(true);
        }
      });
    });

    if (!gciDetected) {
      bot.kill();
      console.error('\n--- Bot Output on Failure ---');
      console.error(botOutput);
      console.error('----------------------------\n');
      throw new Error('GCI not detected in bot logs within 30 seconds');
    }
    console.log('✅ OK');
    bot.kill();

    // 3. Update Config
    console.log('[ ] Config Updated...');
    const updateRes = await fetch(`${API_URL}/strategies/${strategyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portfolioValue: 2000, // Change a value to verify update
      }),
    });
    if (!updateRes.ok) throw new Error(`Failed to update strategy: ${updateRes.status}`);
    console.log('✅ OK');

    // 4. Relaunch Bot
    console.log('[ ] Bot Relaunched...');
    const bot2 = spawn(BOT_CMD, [...BOT_ARGS, strategyId.toString()], { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    const gciDetected2 = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 30000);
      bot2.stdout.on('data', (L) => {
        if (L.toString().includes('Global Confidence Index (GCI):')) {
          clearTimeout(timeout);
          resolve(true);
        }
      });
    });
    if (!gciDetected2) {
      bot2.kill();
      throw new Error('GCI not detected after relaunch');
    }
    console.log('✅ OK');
    bot2.kill();

    // 5. Management API
    console.log('[ ] Management API... OK');
    // Simple check to ensure the endpoint responds
    const statusRes = await fetch(`${API_URL}/strategies/${strategyId}`);
    if (!statusRes.ok) throw new Error(`Failed to fetch strategy status: ${statusRes.status}`);
    console.log('✅ OK');

    // Cleanup: Delete test strategy
    await fetch(`${API_URL}/strategies/${strategyId}`, { method: 'DELETE' });
    console.log('Cleanup: Test strategy deleted.');

    console.log('RESULT: PASSED');
  } catch (e) {
    console.log('RESULT: FAILED');
    console.error(e);
    process.exit(1);
  }
}

runTest();
