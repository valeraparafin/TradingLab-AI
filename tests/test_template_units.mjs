// tests/test_template_units.mjs
// After migration, every risk template's SL/TP must convert to a sane fraction band:
// 0.001 (0.1%) <= pct <= 0.5 (50%). Catches both leftover fractions (too small) and
// un-migrated 30%-style values (too big).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { riskProfileToGuardrails } from '../src/agents/riskProfileToGuardrails.js';

const dir = path.join(process.cwd(), 'templates', 'risk');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let checked = 0;
for (const f of files) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const s = json.settings || json.content?.settings || {};
  if (s.stopLossPercent == null) continue;
  const g = riskProfileToGuardrails(s);
  assert.ok(g.stopLossPct >= 0.001 && g.stopLossPct <= 0.5,
    `${f}: stopLossPct ${g.stopLossPct} out of sane band (0.001..0.5)`);
  assert.ok(g.takeProfitPct >= 0.001 && g.takeProfitPct <= 0.6,
    `${f}: takeProfitPct ${g.takeProfitPct} out of sane band (0.001..0.6)`);
  checked++;
}
console.log(`  ok - ${checked} risk templates have sane SL/TP fractions after conversion`);
