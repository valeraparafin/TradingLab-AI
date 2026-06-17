// tests/test_logreg.js
// Logistic regression core for Phase 3 meta-labeling. Standardized features, L2-regularized
// batch gradient descent. The meta-model predicts P(win) for a primary RangeFilter+ADX signal;
// correctness here gates the whole Phase 3 verdict, so it is TDD'd (not a research-script exemption).
import assert from 'node:assert';
import { LogisticRegression } from '../src/backtest/logreg.js';

let passed = 0;
const ok = (n) => { console.log(`  ok - ${n}`); passed++; };

// --- learns a linearly separable boundary (x0 + x1 > 0 => class 1) ---
{
  const X = [], y = [];
  // deterministic grid, label by a known linear rule with a clear margin
  let seed = 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let k = 0; k < 400; k++) {
    const a = rnd() * 4 - 2, b = rnd() * 4 - 2;
    if (Math.abs(a + b) < 0.3) continue; // drop the ambiguous margin band
    X.push([a, b]);
    y.push(a + b > 0 ? 1 : 0);
  }
  const model = new LogisticRegression({ lr: 0.5, epochs: 800, l2: 0.0 });
  model.fit(X, y);

  // accuracy on the (separable) training set should be near-perfect
  let correct = 0;
  for (let i = 0; i < X.length; i++) correct += (model.predict(X[i]) >= 0.5 ? 1 : 0) === y[i] ? 1 : 0;
  const acc = correct / X.length;
  assert.ok(acc > 0.95, `separable accuracy ${acc.toFixed(3)} > 0.95`);

  // both feature weights should be positive and roughly equal (symmetric rule a+b)
  const w = model.weights;
  assert.ok(w[0] > 0 && w[1] > 0, `weights positive: ${w.map((v) => v.toFixed(2))}`);
  ok('logreg: learns a linearly separable boundary with correct-sign weights');
}

// --- standardization makes fit invariant to feature scale ---
{
  const Xa = [], Xb = [], y = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let k = 0; k < 300; k++) {
    const a = rnd() * 4 - 2, b = rnd() * 4 - 2;
    if (Math.abs(a + b) < 0.3) continue;
    Xa.push([a, b]);
    Xb.push([a * 1000, b * 0.001]); // wildly different scales, same information
    y.push(a + b > 0 ? 1 : 0);
  }
  const ma = new LogisticRegression({ lr: 0.5, epochs: 800 }); ma.fit(Xa, y);
  const mb = new LogisticRegression({ lr: 0.5, epochs: 800 }); mb.fit(Xb, y);
  const accOf = (m, X) => { let c = 0; for (let i = 0; i < X.length; i++) c += (m.predict(X[i]) >= 0.5 ? 1 : 0) === y[i] ? 1 : 0; return c / X.length; };
  assert.ok(accOf(mb, Xb) > 0.95, `scaled-feature accuracy ${accOf(mb, Xb).toFixed(3)} > 0.95 (standardization works)`);
  ok('logreg: internal standardization makes it scale-invariant');
}

// --- predict returns a calibrated-ish probability in (0,1) ---
{
  const model = new LogisticRegression({ lr: 0.3, epochs: 200 });
  model.fit([[0, 0], [1, 1], [-1, -1], [2, 2], [-2, -2]], [1, 1, 0, 1, 0]);
  const p = model.predict([5, 5]);
  assert.ok(p > 0 && p < 1, `probability in (0,1): ${p}`);
  assert.ok(p > 0.5, `strong positive input => p>0.5: ${p}`);
  ok('logreg: predict yields a probability in (0,1)');
}

console.log(`\n${passed} passed`);
