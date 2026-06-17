// backtest/universe-correlation.mjs
// Research/analysis (not production): how independent is our 36-symbol universe really? Crypto
// alts mostly track BTC, so "36 symbols positive" overstates diversification. We quantify it:
//   - daily log-return correlation matrix across symbols (common-date intersection),
//   - eigen-decomposition (Jacobi) -> largest eigenvalue share (the "market/BTC factor"),
//   - effective number of independent bets via participation ratio Neff = (Σλ)^2 / Σλ^2,
//   - a greedy decorrelated basket (farthest-point selection by correlation distance).
// Read-only on market_data.db. Usage: node backtest/universe-correlation.mjs --tf 15m --minDays 300 --corrCap 0.6
import path from 'path';
import { openMarketDb } from '../src/data/marketDataSchema.js';
import { MarketDataRepo } from '../src/data/MarketDataRepo.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const tf = arg('tf', '15m');
const minDays = Number(arg('minDays', '300'));
const corrCap = Number(arg('corrCap', '0.6'));
const DAY = 86400000;

// Daily log returns from intraday candles: last close per UTC day, then log(c_d / c_{d-1}).
function dailyReturns(candles) {
  const lastClose = new Map();
  for (const c of candles) lastClose.set(Math.floor(c.time / DAY), c.close);
  const days = [...lastClose.keys()].sort((a, b) => a - b);
  const rets = new Map();
  for (let i = 1; i < days.length; i++) {
    const c0 = lastClose.get(days[i - 1]), c1 = lastClose.get(days[i]);
    if (c0 > 0 && c1 > 0) rets.set(days[i], Math.log(c1 / c0));
  }
  return rets;
}

// Jacobi eigenvalue algorithm for a real symmetric matrix -> sorted-desc eigenvalues.
function jacobiEigenvalues(A0) {
  const n = A0.length;
  const A = A0.map((r) => r.slice());
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-12) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return Array.from({ length: n }, (_, i) => A[i][i]).sort((a, b) => b - a);
}

(async () => {
  const db = await openMarketDb(path.join(process.cwd(), 'market_data.db'));
  const repo = new MarketDataRepo(db);
  const symbols = (await db.all('SELECT DISTINCT symbol FROM candles WHERE timeframe = ? ORDER BY symbol', tf)).map((r) => r.symbol);

  const series = [];
  for (const sym of symbols) {
    const candles = await repo.getCandles(sym, tf, 0, Number.MAX_SAFE_INTEGER);
    const rets = dailyReturns(candles);
    if (rets.size >= minDays) series.push({ sym, rets });
  }
  await db.close();
  const dropped = symbols.length - series.length;

  // Common-date intersection across the kept symbols.
  let commonDays = null;
  for (const { rets } of series) {
    const ks = new Set(rets.keys());
    commonDays = commonDays === null ? ks : new Set([...commonDays].filter((d) => ks.has(d)));
  }
  const days = [...commonDays].sort((a, b) => a - b);
  const k = series.length, T = days.length;
  console.log(`Universe correlation (${tf}): ${k}/${symbols.length} symbols with >=${minDays} daily returns (${dropped} dropped as too new), ${T} common days\n`);

  // Standardized return matrix -> correlation matrix.
  const cols = series.map(({ rets }) => days.map((d) => rets.get(d)));
  const mean = cols.map((c) => c.reduce((a, b) => a + b, 0) / T);
  const sd = cols.map((c, j) => Math.sqrt(c.reduce((a, b) => a + (b - mean[j]) ** 2, 0) / (T - 1)));
  const Z = cols.map((c, j) => c.map((v) => (v - mean[j]) / (sd[j] || 1)));
  const C = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let a = 0; a < k; a++) for (let b = a; b < k; b++) {
    let s = 0; for (let t = 0; t < T; t++) s += Z[a][t] * Z[b][t];
    C[a][b] = C[b][a] = s / (T - 1);
  }

  // Average off-diagonal correlation.
  let off = 0, cnt = 0;
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) { off += C[a][b]; cnt++; }
  const avgCorr = off / cnt;

  // Eigen-spectrum: market factor + effective number of bets.
  const eig = jacobiEigenvalues(C);
  const sumL = eig.reduce((a, b) => a + b, 0);
  const sumL2 = eig.reduce((a, b) => a + b * b, 0);
  const Neff = (sumL * sumL) / sumL2;

  console.log(`Average pairwise correlation : ${avgCorr.toFixed(3)}`);
  console.log(`Largest eigenvalue (market)  : ${eig[0].toFixed(2)} = ${(100 * eig[0] / k).toFixed(1)}% of total variance`);
  console.log(`2nd / 3rd eigenvalue          : ${eig[1].toFixed(2)} / ${eig[2].toFixed(2)}`);
  console.log(`Effective independent bets    : Neff = ${Neff.toFixed(1)}  (of ${k} symbols)`);
  console.log(`Diversification ratio         : ${(Neff / k).toFixed(2)}  (1.0 = fully independent)\n`);

  // Greedy decorrelated basket: farthest-point selection. Seed BTC if present.
  const idx = (s) => series.findIndex((x) => x.sym === s);
  const picked = [idx('BTCUSDT') >= 0 ? idx('BTCUSDT') : 0];
  while (true) {
    let best = -1, bestMaxCorr = Infinity;
    for (let c = 0; c < k; c++) {
      if (picked.includes(c)) continue;
      const maxCorr = Math.max(...picked.map((p) => Math.abs(C[c][p])));
      if (maxCorr < bestMaxCorr) { bestMaxCorr = maxCorr; best = c; }
    }
    if (best < 0 || bestMaxCorr > corrCap) break;
    picked.push(best);
  }
  console.log(`Decorrelated basket (pairwise |corr| <= ${corrCap}): ${picked.length} symbols`);
  console.log('  ' + picked.map((i) => series[i].sym).join(', '));
})();
