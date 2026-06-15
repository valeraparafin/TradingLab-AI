// scripts/seed-ai-agents.mjs
//
// Seeds a scenario matrix of paper-trading AI agents into ai_strategies so they
// appear in the /ai dashboard ready to Start. Idempotent: an agent whose name
// already exists (any archive state) is skipped, so this can be re-run safely.
//
//   node scripts/seed-ai-agents.mjs
//
// Risk-profile ids below are the seeded is_template=1 rows. If your DB differs,
// the script resolves each profile by NAME at runtime and warns on any miss.
//
// RR notes:
//  - SMC agents: RR is implied by the risk profile's TP/SL ratio.
//  - OrderBook agents: stops are structural (SL = broken level, TP = 2R) and the
//    risk profile's min_RR gate is force-disabled by applyOrderBookGuardrails;
//    the meaningful per-agent axis there is signal tightness (ob_config thresholds).

import { initDB, getDB } from '../db.js';
import { aiStrategyService } from '../src/server/services/aiStrategyService.js';

// ── OB threshold presets (match LiveObEngine / orderbook.json indicator keys) ──
const OB_LOOSE  = { imbThresh: 0.08, aggThresh: 0.12, minVelocity: 0.3, maxSpreadBps: 10, horizonMs: 60000, htfStep: 1 };
const OB_STRICT = { imbThresh: 0.15, aggThresh: 0.20, minVelocity: 0.8, maxSpreadBps: 5,  horizonMs: 60000, htfStep: 1 };
const OB_SCALP  = { imbThresh: 0.10, aggThresh: 0.15, minVelocity: 0.5, maxSpreadBps: 8,  horizonMs: 45000, htfStep: 1 };

// Scenario matrix. risk = risk-profile NAME (resolved to id at runtime).
const MATRIX = [
  // ── SMC (candle) — RR varies via the risk profile's TP/SL ──
  { name: 'SMC · Conservative · Majors 4H', logic: 'smc', risk: 'Conservative',
    tf: '4H', watchlist: 'BTCUSDT,ETHUSDT', mode: 'spot', portfolio: 1000 },
  { name: 'SMC · Aggressive · Majors 1H', logic: 'smc', risk: 'Aggressive',
    tf: '1H', watchlist: 'BTCUSDT,ETHUSDT,SOLUSDT', mode: 'futures', portfolio: 1000 },
  { name: 'SMC · VMC-Aggr · Alts 15m', logic: 'smc', risk: 'VMC Cipher B 5m Aggressive Risk',
    tf: '15m', watchlist: 'SOLUSDT,XRPUSDT,WIFUSDT', mode: 'futures', portfolio: 500 },
  { name: 'SMC · Scalp Majors · 5m', logic: 'smc', risk: 'Scalping Majors (BTC/ETH)',
    tf: '5m', watchlist: 'BTCUSDT,ETHUSDT', mode: 'spot', portfolio: 500 },
  { name: 'SMC · Scalp Alts · 5m', logic: 'smc', risk: 'Scalping Alts',
    tf: '5m', watchlist: 'SUIUSDT,WLDUSDT,TONUSDT', mode: 'spot', portfolio: 300 },

  // ── Order Book (live) — structural RR=2; axis is signal tightness ──
  { name: 'OB · Balanced · BTC 5m (loose)', logic: 'orderbook', risk: 'Conservative',
    tf: '5m', watchlist: 'BTCUSDT', mode: 'futures', portfolio: 500, ob: OB_LOOSE },
  { name: 'OB · Strict · Majors 5m', logic: 'orderbook', risk: 'Aggressive',
    tf: '5m', watchlist: 'BTCUSDT,ETHUSDT,SOLUSDT', mode: 'futures', portfolio: 500, ob: OB_STRICT },
  { name: 'OB · Scalp Alts · 5m', logic: 'orderbook', risk: 'Scalping Alts',
    tf: '5m', watchlist: 'SUIUSDT,WLDUSDT,TONUSDT', mode: 'futures', portfolio: 300, ob: OB_SCALP },

  // ── Order Book (expanded) — wider sweep over TF / risk / watchlist axes ──
  { name: 'OB · Scalp Majors · BTC strict 5m', logic: 'orderbook', risk: 'Scalping Majors (BTC/ETH)',
    tf: '5m', watchlist: 'BTCUSDT', mode: 'futures', portfolio: 500, ob: OB_STRICT },
  { name: 'OB · Conservative · Majors 15m', logic: 'orderbook', risk: 'Conservative',
    tf: '15m', watchlist: 'BTCUSDT,ETHUSDT,SOLUSDT', mode: 'futures', portfolio: 1000, ob: OB_SCALP },
  { name: 'OB · Aggressive · Alts loose 5m', logic: 'orderbook', risk: 'Aggressive',
    tf: '5m', watchlist: 'SUIUSDT,WLDUSDT,TONUSDT', mode: 'futures', portfolio: 300, ob: OB_LOOSE },
  { name: 'OB · Fast Scalp · BTC strict 5m', logic: 'orderbook', risk: 'Fast Scalping Risk',
    tf: '5m', watchlist: 'BTCUSDT', mode: 'futures', portfolio: 500, ob: OB_STRICT },
  { name: 'OB · Scalp Majors · Majors 15m', logic: 'orderbook', risk: 'Scalping Majors (BTC/ETH)',
    tf: '15m', watchlist: 'BTCUSDT,ETHUSDT', mode: 'futures', portfolio: 500, ob: OB_SCALP },
];

async function main() {
  await initDB();
  const db = getDB('ai');

  // Resolve risk-profile names → ids (templates only).
  const profiles = await db.all('SELECT id, name FROM ai_risk_profiles WHERE is_template = 1');
  const riskByName = new Map(profiles.map((p) => [p.name, p.id]));

  // Existing agent names (case-sensitive) for idempotency.
  const existing = new Set((await db.all('SELECT name FROM ai_strategies')).map((r) => r.name));

  let created = 0, skipped = 0, missingRisk = 0;
  for (const m of MATRIX) {
    if (existing.has(m.name)) { console.log(`  ↷ skip (exists): ${m.name}`); skipped++; continue; }
    const risk_profile_id = riskByName.get(m.risk);
    if (!risk_profile_id) {
      console.warn(`  ✗ risk profile not found: "${m.risk}" — skipping ${m.name}`);
      missingRisk++; continue;
    }
    const { id } = await aiStrategyService.createAgent({
      name: m.name,
      logic_template_id: m.logic,            // filename STRING — never Number()-coerce
      risk_profile_id,
      watchlist: m.watchlist,
      timeframe: m.tf,
      trade_mode: m.mode,
      paper_trading: 1,                      // paper only
      portfolio_value: m.portfolio,
      cycle_interval_ms: 300000,
      ob_config: m.ob ? JSON.stringify(m.ob) : null,
    });
    console.log(`  ✓ #${id}  ${m.name}  [${m.logic} / ${m.risk}]`);
    created++;
  }

  console.log(`\nDone. created=${created} skipped=${skipped} missingRisk=${missingRisk}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
