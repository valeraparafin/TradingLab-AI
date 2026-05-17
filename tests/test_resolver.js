import { resolveConfig } from '../src/config_resolver.js';
import assert from 'assert';
import fs from 'fs';
import path from 'path';

function test() {
  console.log('Running Config Resolver Tests...');

  // Setup dummy templates for testing
  const riskDir = path.join(process.cwd(), 'templates', 'risk');
  const logicDir = path.join(process.cwd(), 'templates', 'logic');

  fs.writeFileSync(path.join(riskDir, 'test_risk.json'), JSON.stringify({
    settings: {
      maxTradesPerDay: 10,
      maxTradeSizeUSD: 200,
      riskPerTradePercent: 2,
      stopLossPercent: 3,
      takeProfitPercent: 6
    }
  }));

  fs.writeFileSync(path.join(logicDir, 'test_logic.json'), JSON.stringify({
    settings: {
      indicator: 'MACD',
      fastPeriod: 12,
      slowPeriod: 26
    }
  }));

  // Test 1: Successful merge with overrides
  console.log('Test 1: Merging templates with overrides...');
  const config1 = {
    riskTemplateId: 'test_risk',
    riskOverrides: { maxTradesPerDay: 20 },
    logicTemplateId: 'test_logic',
    logicOverrides: { fastPeriod: 15 }
  };
  const resolved1 = resolveConfig(config1);
  assert.strictEqual(resolved1.risk.maxTradesPerDay, 20, 'Risk override should supersede template');
  assert.strictEqual(resolved1.risk.maxTradeSizeUSD, 200, 'Template value should persist');
  assert.strictEqual(resolved1.logic.fastPeriod, 15, 'Logic override should supersede template');
  console.log('✅ Test 1 Passed');

  // Test 2: Validation failure (missing required field)
  console.log('Test 2: Validation failure (missing required field)...');
  fs.writeFileSync(path.join(riskDir, 'invalid_risk.json'), JSON.stringify({
    settings: {
      maxTradeSizeUSD: 200,
      // maxTradesPerDay missing
    }
  }));
  const config2 = {
    riskTemplateId: 'invalid_risk',
    logicTemplateId: 'test_logic'
  };
  assert.throws(() => resolveConfig(config2), /validation failed/, 'Should throw error when required risk field is missing');
  console.log('✅ Test 2 Passed');

  // Test 3: Template not found
  console.log('Test 3: Template not found...');
  const config3 = {
    riskTemplateId: 'non_existent',
    logicTemplateId: 'test_logic'
  };
  assert.throws(() => resolveConfig(config3), /Risk template not found/, 'Should throw error when risk template is missing');
  console.log('✅ Test 3 Passed');

  console.log('\nAll tests passed successfully!');
}

try {
  test();
} catch (err) {
  console.error('❌ Test failed:');
  console.error(err);
  process.exit(1);
}
