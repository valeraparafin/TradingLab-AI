import assert from 'node:assert';
import { initDB } from '../db.js';
import { aiStrategyService as svc } from '../src/server/services/aiStrategyService.js';

await initDB();

const created = await svc.createAgent({
  name: 'Test Agent ' + Date.now(),
  watchlist: 'BTCUSDT,ETHUSDT',
  timeframe: '4H',
  logic_template_id: null,
  risk_profile_id: null,
  trade_mode: 'spot',
  paper_trading: 1,
  portfolio_value: 5000,
  cycle_interval_ms: 60000,
});
assert.ok(created.id, 'createAgent returns an id');

const fetched = await svc.getAgent(created.id);
assert.equal(fetched.watchlist, 'BTCUSDT,ETHUSDT');
assert.equal(fetched.timeframe, '4H');

await svc.updateAgent(created.id, { timeframe: '1H' });
assert.equal((await svc.getAgent(created.id)).timeframe, '1H');

await svc.archiveAgent(created.id);
assert.equal((await svc.getAgent(created.id)).is_archived, 1);

const active = await svc.listAgents(false);
assert.ok(!active.find(a => a.id === created.id), 'archived agent excluded from active list');
console.log('OK test_ai_agents');
