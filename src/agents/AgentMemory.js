import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';

export class AgentMemory {
    constructor() {
        this.db = null;
    }

    async init() {
        this.db = await open({
            filename: path.join(process.cwd(), 'trading_lab.db'),
            driver: sqlite3.Database
        });

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS agent_episodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                input TEXT,
                reasoning TEXT,
                action TEXT,
                observation TEXT,
                result TEXT
            );
        `);
    }

    async saveEpisode(episode) {
        if (!this.db) await this.init();
        const { agent_id, input, reasoning, action, observation, result } = episode;
        await this.db.run(
            'INSERT INTO agent_episodes (agent_id, input, reasoning, action, observation, result) VALUES (?, ?, ?, ?, ?, ?)',
            [agent_id, JSON.stringify(input), reasoning, action, observation, result]
        );
    }

    async getRecentEpisodes(agent_id, limit = 10) {
        if (!this.db) await this.init();
        return await this.db.all(
            'SELECT * FROM agent_episodes WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?',
            [agent_id, limit]
        );
    }

    async searchEpisodes(query) {
        if (!this.db) await this.init();
        return await this.db.all(
            'SELECT * FROM agent_episodes WHERE reasoning LIKE ? OR observation LIKE ? ORDER BY timestamp DESC',
            [`%${query}%`, `%${query}%`]
        );
    }
}

export const agentMemory = new AgentMemory();
