import { getDB } from '../../../db.js';

/**
 * Converts a Binance tickSize/stepSize string into a decimal precision.
 * Binance pads the value with trailing zeros (e.g. "0.00100000"), so naively
 * counting characters after the dot yields 8 for nearly every symbol. We parse
 * the number first so trailing zeros drop, then count the significant decimals
 * (handling exponential form like "1e-7" for very small ticks).
 * @param {string|number|undefined} step
 * @returns {number} decimal places (default 2 when absent/invalid)
 */
export function tickSizeToPrecision(step) {
  const n = parseFloat(step);
  if (!(n > 0)) return 2;
  const s = n.toString();
  if (s.includes('e-')) return parseInt(s.split('e-')[1], 10);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

class AssetService {
  constructor() {
    this.assets = new Map();
  }

  /**
   * Initializes assets: loads from DB first for instant start, 
   * then syncs with API in background.
   */
  async init() {
    await this.loadFromDb();
    
    if (this.assets.size === 0) {
      console.log('[AssetService] DB empty. Performing initial sync...');
      await this.sync();
    } else {
      console.log(`[AssetService] Initialized with ${this.assets.size} assets from DB.`);
    }
  }

  /**
   * Synchronizes asset precision data from Binance API to Database and Memory.
   */
  async sync() {
    console.log('[AssetService] Syncing assets from Binance...');
    try {
      const res = await fetch('https://api.binance.com/api/v3/exchangeInfo');
      if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
      const data = await res.json();

      const db = getDB();
      
      for (const s of data.symbols) {
        if (s.status !== 'TRADING') continue;

        const priceFilter = s.filters.find(f => f.filterType === 'PRICE_FILTER');
        const pricePrecision = this._calculatePrecision(priceFilter?.tickSize);

        const lotFilter = s.filters.find(f => f.filterType === 'LOT_SIZE');
        const quantityPrecision = this._calculatePrecision(lotFilter?.stepSize);

        await db.run(
          `INSERT OR REPLACE INTO assets (symbol, price_precision, quantity_precision, updated_at) 
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [s.symbol, pricePrecision, quantityPrecision]
        );

        this.assets.set(s.symbol, {
          pricePrecision,
          quantityPrecision
        });
      }

      console.log(`[AssetService] Successfully synced ${this.assets.size} assets.`);
    } catch (err) {
      console.error(`[AssetService] Sync failed: ${err.message}`);
    }
  }

  /**
   * Loads assets from the local database into memory.
   */
  async loadFromDb() {
    try {
      const db = getDB();
      const rows = await db.all('SELECT * FROM assets');
      for (const row of rows) {
        this.assets.set(row.symbol, {
          pricePrecision: row.price_precision,
          quantityPrecision: row.quantity_precision
        });
      }
      console.log(`[AssetService] Loaded ${this.assets.size} assets from DB.`);
    } catch (err) {
      console.error(`[AssetService] Critical: Could not load assets from DB: ${err.message}`);
    }
  }

  async getAssets() {
    return Array.from(this.assets.entries()).map(([symbol, data]) => ({
      symbol,
      ...data
    }));
  }

  getPrecision(symbol) {
    const asset = this.assets.get(symbol);
    return asset ? asset.pricePrecision : 2;
  }

  getQuantityPrecision(symbol) {
    const asset = this.assets.get(symbol);
    return asset ? asset.quantityPrecision : 2;
  }

  _calculatePrecision(stepSize) {
    return tickSizeToPrecision(stepSize);
  }
}

export const assetService = new AssetService();
