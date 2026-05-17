import fs from 'fs';
import path from 'path';
import { resolveConfig } from '../src/config_resolver.js';

/**
 * Deeply compares two objects and returns the differences.
 * Only returns properties in 'current' that differ from 'template'.
 */
function getOverrides(template, current) {
  const overrides = {};
  for (const key in current) {
    if (JSON.stringify(current[key]) !== JSON.stringify(template[key])) {
      overrides[key] = current[key];
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : {};
}

/**
 * Extracts the settings object from a template file.
 */
function extractSettings(template) {
  return template.settings || template.content?.settings || template;
}

async function migrate() {
  const strategiesDir = path.join(process.cwd(), 'strategies');
  const backupDir = path.join(process.cwd(), 'strategies_backup');

  console.log('Creating backup of strategies...');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
  }

  const files = fs.readdirSync(strategiesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(strategiesDir, file);
    const backupPath = path.join(backupDir, file);

    try {
      // 1. Backup file
      fs.copyFileSync(filePath, backupPath);

      // 2. Load strategy
      const strategy = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // Handle cases where risk/logic might be at root or inside metadata
      const oldRisk = strategy.risk || strategy.metadata?.risk;
      const oldLogic = strategy.logic || strategy.metadata?.logic;

      const oldConfig = {
        risk: oldRisk,
        logic: oldLogic
      };

      // 3. Identify templates
      const riskTemplateId = strategy.riskTemplateId || strategy.metadata?.riskTemplateId || 'default_risk';
      const logicTemplateId = strategy.logicTemplateId || strategy.metadata?.logicTemplateId || 'default_logic';


      // 4. Load templates
      const riskTemplatePath = path.join(process.cwd(), 'templates', 'risk', `${riskTemplateId}.json`);
      const logicTemplatePath = path.join(process.cwd(), 'templates', 'logic', `${logicTemplateId}.json`);

      if (!fs.existsSync(riskTemplatePath) || !fs.existsSync(logicTemplatePath)) {
        console.error(`[${file}] Template files not found on disk. Skipping...`);
        continue;
      }

      const riskTemplateRaw = JSON.parse(fs.readFileSync(riskTemplatePath, 'utf8'));
      const logicTemplateRaw = JSON.parse(fs.readFileSync(logicTemplatePath, 'utf8'));

      const riskTemplate = extractSettings(riskTemplateRaw);
      const logicTemplate = extractSettings(logicTemplateRaw);

      // 5. Calculate diffs
      const riskOverrides = getOverrides(riskTemplate, strategy.risk || {});
      const logicOverrides = getOverrides(logicTemplate, strategy.logic || {});

      // 6. Create new strict config
      const newConfig = {
        ...strategy,
        riskTemplateId,
        logicTemplateId,
        riskOverrides,
        logicOverrides
      };

      // Remove old full objects
      delete newConfig.risk;
      delete newConfig.logic;
      if (newConfig.metadata) {
        delete newConfig.metadata.risk;
        delete newConfig.metadata.logic;
      }

      // 7. Verification
      try {
        resolveConfig(newConfig);
        // If resolveConfig didn't throw, the config is valid according to our strict schema.
        // We trust the resolver for migration.
      } catch (resolveErr) {
        console.error(`[${file}] resolveConfig validation failed: ${resolveErr.message}. Skipping...`);
        continue;
      }

      // 8. Write back
      fs.writeFileSync(filePath, JSON.stringify(newConfig, null, 2), 'utf8');
      console.log(`[${file}] Successfully migrated.`);

    } catch (err) {
      console.error(`[${file}] Error during migration:`, err);
    }
  }

  console.log('Migration complete.');
}

migrate().catch(console.error);
