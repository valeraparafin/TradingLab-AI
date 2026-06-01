/**
 * test_concurrency.mjs
 * Verifies that multiple agents can run concurrently and stopping one
 * does not affect the other.
 *
 * Expects a LIVE server at http://localhost:3000 (start with `npm run server`).
 */

import assert from 'node:assert';

const BASE = 'http://localhost:3000';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { ok: res.ok, status: res.status, body: await res.json() };
}

async function post(path, data) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

// Poll until the server is responsive or timeout expires
async function waitForServer(maxMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${BASE}/api/agents`, { signal: AbortSignal.timeout(1500) });
      const body = await res.json();
      if (body.success !== undefined) return true;
    } catch (_) { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// ── Main test ──────────────────────────────────────────────────────────────────

const ready = await waitForServer();
assert.ok(ready, 'Server did not become ready within 15s');

const suffix = Date.now();

// 1. Create two agents
const { ok: ok1, body: b1 } = await post('/api/agents', {
  name: `ConcAgent_A_${suffix}`,
  watchlist: 'BTCUSDT',
  timeframe: '1H',
  trade_mode: 'spot',
  paper_trading: 1,
  portfolio_value: 1000,
  cycle_interval_ms: 999999,  // very long interval — won't actually trade
});
assert.ok(ok1, `Create agent A failed: ${JSON.stringify(b1)}`);
const idA = b1.data.id;

const { ok: ok2, body: b2 } = await post('/api/agents', {
  name: `ConcAgent_B_${suffix}`,
  watchlist: 'ETHUSDT',
  timeframe: '1H',
  trade_mode: 'spot',
  paper_trading: 1,
  portfolio_value: 1000,
  cycle_interval_ms: 999999,
});
assert.ok(ok2, `Create agent B failed: ${JSON.stringify(b2)}`);
const idB = b2.data.id;

// 2. Start both agents
const { ok: startOkA, body: startBodyA } = await post('/api/agents/start', { agent_id: idA });
assert.ok(startOkA, `Start agent A failed (status): ${JSON.stringify(startBodyA)}`);

const { ok: startOkB, body: startBodyB } = await post('/api/agents/start', { agent_id: idB });
assert.ok(startOkB, `Start agent B failed (status): ${JSON.stringify(startBodyB)}`);

// 3. Assert both are running
const { body: listAfterStart } = await get('/api/agents');
assert.ok(listAfterStart.success, 'Failed to list agents after start');
const agents = listAfterStart.data;

const agentA_running = agents.find(a => a.id === idA);
const agentB_running = agents.find(a => a.id === idB);

assert.ok(agentA_running, `Agent A (id=${idA}) not found in list`);
assert.ok(agentB_running, `Agent B (id=${idB}) not found in list`);
assert.equal(agentA_running.status, 'running', `Agent A should be running, got: ${agentA_running.status}`);
assert.equal(agentB_running.status, 'running', `Agent B should be running, got: ${agentB_running.status}`);

// 4. Stop only Agent A
const { ok: stopOkA, body: stopBodyA } = await post('/api/agents/stop', { agent_id: idA });
assert.ok(stopOkA, `Stop agent A failed: ${JSON.stringify(stopBodyA)}`);

// 5. Assert A is stopped, B is still running
const { body: listAfterStop } = await get('/api/agents');
assert.ok(listAfterStop.success, 'Failed to list agents after stop');
const agentsAfter = listAfterStop.data;

const agentA_after = agentsAfter.find(a => a.id === idA);
const agentB_after = agentsAfter.find(a => a.id === idB);

assert.ok(agentA_after, `Agent A not found after stop`);
assert.ok(agentB_after, `Agent B not found after stop`);
assert.equal(agentA_after.status, 'stopped', `Agent A should be stopped, got: ${agentA_after.status}`);
assert.equal(agentB_after.status, 'running', `Agent B should still be running, got: ${agentB_after.status}`);

// 6. Cleanup: stop B, archive both
await post('/api/agents/stop', { agent_id: idB });
await post(`/api/agents/${idA}/archive`, {});
await post(`/api/agents/${idB}/archive`, {});

console.log('OK test_concurrency');
