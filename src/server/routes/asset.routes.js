import express from 'express';
import { assetService } from '../services/asset.service.js';

const router = express.Router();

/**
 * POST /sync
 * Manually triggers synchronization of asset precision from Binance.
 */
router.post('/sync', async (req, res) => {
  try {
    await assetService.sync();
    res.json({ 
      status: 'success', 
      message: `Synced ${assetService.assets.size} assets from Binance.` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const assets = await assetService.getAssets();
    res.json(assets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;