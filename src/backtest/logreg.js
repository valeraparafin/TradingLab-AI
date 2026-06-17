// src/backtest/logreg.js
// Logistic regression for Phase 3 meta-labeling. Standardized features (z-score, fit on train),
// L2-regularized batch gradient descent. Deterministic: no randomness, no I/O. The meta-model
// predicts P(win) for a primary RangeFilter+ADX signal; we then take only signals above a
// probability threshold. Plain JS so it runs in the same offline harness as the simulator.

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export class LogisticRegression {
  constructor({ lr = 0.1, epochs = 500, l2 = 0.0 } = {}) {
    this.lr = lr;
    this.epochs = epochs;
    this.l2 = l2;
    this.weights = null; // per-feature, in standardized space
    this.bias = 0;
    this.mean = null;
    this.std = null;
  }

  // z-score standardization params from the training matrix (per column).
  _standardize(X) {
    const n = X.length, d = X[0].length;
    this.mean = new Array(d).fill(0);
    this.std = new Array(d).fill(0);
    for (const row of X) for (let j = 0; j < d; j++) this.mean[j] += row[j];
    for (let j = 0; j < d; j++) this.mean[j] /= n;
    for (const row of X) for (let j = 0; j < d; j++) this.std[j] += (row[j] - this.mean[j]) ** 2;
    for (let j = 0; j < d; j++) this.std[j] = Math.sqrt(this.std[j] / n) || 1;
  }

  _z(row) {
    return row.map((v, j) => (v - this.mean[j]) / this.std[j]);
  }

  fit(X, y) {
    const n = X.length, d = X[0].length;
    this._standardize(X);
    const Z = X.map((r) => this._z(r));
    this.weights = new Array(d).fill(0);
    this.bias = 0;
    for (let e = 0; e < this.epochs; e++) {
      const gw = new Array(d).fill(0);
      let gb = 0;
      for (let i = 0; i < n; i++) {
        const p = sigmoid(this._dot(Z[i]) + this.bias);
        const err = p - y[i];
        for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
        gb += err;
      }
      for (let j = 0; j < d; j++) {
        this.weights[j] -= this.lr * (gw[j] / n + this.l2 * this.weights[j]);
      }
      this.bias -= this.lr * (gb / n);
    }
    return this;
  }

  _dot(z) {
    let s = 0;
    for (let j = 0; j < z.length; j++) s += this.weights[j] * z[j];
    return s;
  }

  // P(class = 1) for a raw (un-standardized) feature row.
  predict(row) {
    return sigmoid(this._dot(this._z(row)) + this.bias);
  }
}
