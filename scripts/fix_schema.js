import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

async function migrate() {
    const dbPath = path.join(process.cwd(), 'trading_lab.db');
    console.log(`Connecting to database: ${dbPath}`);

    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    try {
        // 1. Ensure size_usd exists in active_positions
        console.log('Checking active_positions for size_usd...');
        const tableInfo = await db.all("PRAGMA table_info(active_positions)");
        const hasSizeUsd = tableInfo.some(col => col.name === 'size_usd');
        const hasTotalCost = tableInfo.some(col => col.name === 'total_cost');

        if (!hasSizeUsd) {
            console.log('Adding size_usd column to active_positions...');
            await db.exec('ALTER TABLE active_positions ADD COLUMN size_usd REAL');
            console.log('Column size_usd added.');
        }

        // Ensure side column exists in active_positions
        const tableInfo2 = await db.all("PRAGMA table_info(active_positions)");
        if (!tableInfo2.some(col => col.name === 'side')) {
            console.log('Adding side column to active_positions...');
            await db.exec('ALTER TABLE active_positions ADD COLUMN side TEXT');
            console.log('Column side added.');
        }

        if (hasTotalCost) {
            console.log('Synchronizing total_cost to size_usd...');
            await db.exec('UPDATE active_positions SET size_usd = total_cost WHERE size_usd IS NULL');
            console.log('Synchronization complete.');
        }

        // 2. Ensure size_usd exists in trades
        console.log('Checking trades for size_usd...');
        const tradesInfo = await db.all("PRAGMA table_info(trades)");
        if (!tradesInfo.some(col => col.name === 'size_usd')) {
            console.log('Adding size_usd column to trades...');
            await db.exec('ALTER TABLE trades ADD COLUMN size_usd REAL');
            console.log('Column size_usd added.');
        }

        console.log('Schema migration successful!');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await db.close();
    }
}

migrate();
