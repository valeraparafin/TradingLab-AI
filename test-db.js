import { initDB } from './db.js';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

async function testDB() {
    try {
        console.log('Testing database initialization...');
        await initDB();
        console.log('Database initialized successfully.');

        const db = await open({
            filename: './trading_lab.db',
            driver: sqlite3.Database
        });

        const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        console.log('Tables found in database:', tables.map(t => t.name));

        const expectedTables = ['strategies', 'trades', 'events', 'active_positions'];
        const missingTables = expectedTables.filter(t => !tables.some(row => row.name === t));

        if (missingTables.length > 0) {
            throw new Error(`Missing tables: ${missingTables.join(', ')}`);
        }

        console.log('All expected tables exist.');
        process.exit(0);
    } catch (error) {
        console.error('Database test failed:', error);
        process.exit(1);
    }
}

testDB();
