// scripts/seed-range-filter-strategies.mjs
//
// Seeds the validated RangeFilter (VMC Swing) strategies from strategies/*.json into the
// `strategies` table so they appear in the dashboard ready to Start. Idempotent: a strategy whose
// name already exists is skipped, so this can be re-run safely.
//
//   node scripts/seed-range-filter-strategies.mjs
//
// Each JSON file is a createStrategy payload: { name, logicTemplateId, riskTemplateId, settings }.
// The logic/risk templates live in templates/{logic,risk}/range_filter.json; the ADX regime gate
// (the proven core lever) is enforced live via the rf_regime_adx safety check.
import fs from 'fs';
import path from 'path';
import { initDB, getDB } from '../db.js';
import { strategyService } from '../src/server/services/strategy.service.js';

const FILES = ['range_filter_1h_majors.json', 'range_filter_15m_alts.json'];

async function main() {
  await initDB();
  const db = getDB();
  const existing = new Set((await db.all('SELECT name FROM strategies')).map((r) => r.name));

  let created = 0, skipped = 0;
  for (const file of FILES) {
    const payload = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'strategies', file), 'utf8'));
    delete payload._notes;
    if (existing.has(payload.name)) { console.log(`  ↷ skip (exists): ${payload.name}`); skipped++; continue; }
    const { id } = await strategyService.createStrategy(payload);
    console.log(`  ✓ #${id}  ${payload.name}  [${payload.logicTemplateId} / ${payload.riskTemplateId}]`);
    created++;
  }
  console.log(`\nDone. created=${created} skipped=${skipped}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
