import { initDB } from '../db.js';
import { aiStrategyService } from '../src/server/services/aiStrategyService.js';

async function runSeed() {
    try {
        await initDB();
        await aiStrategyService.seedTemplates();
        console.log('Seed successful!');
    } catch (e) {
        console.error('Seed failed:', e);
        process.exit(1);
    }
}

runSeed();
