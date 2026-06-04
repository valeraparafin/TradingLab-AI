// tests/test_backtest_routes.js
// Structural test: assert the router exposes the 3 read routes. Importing the
// router does NOT open backtest.db (the service opens lazily on first call),
// so this stays a pure import-time check with no db side effects.
import assert from 'node:assert';
import router from '../src/server/routes/backtest.routes.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

assert.strictEqual(typeof router, 'function', 'express router is a function');
// Assert each path is registered AND as a GET (guards against an accidental POST).
const routes = router.stack.filter(l => l.route).map(l => ({ path: l.route.path, method: Object.keys(l.route.methods)[0] }));
const hasGet = (p) => routes.some(r => r.path === p && r.method === 'get');
assert.ok(hasGet('/groups'), 'GET /groups registered');
assert.ok(hasGet('/groups/:group'), 'GET /groups/:group registered');
assert.ok(hasGet('/runs/:id'), 'GET /runs/:id registered');
ok('backtest router exposes the 3 read GET routes');

console.log(`\n${passed} checks passed`);
