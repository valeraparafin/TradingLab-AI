import React, { useEffect, useState } from 'react';
import { assetApi, type AssetPrecision } from '../lib/api';
import { Card } from '../components/ui/components';

export const AssetsPage = () => {
  const [assets, setAssets] = useState<AssetPrecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchAssets = async () => {
    try {
      const res = await assetApi.getAssets();
      setAssets(res.data);
    } catch (err) {
      console.error('Failed to fetch assets', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await assetApi.syncAssets();
      await fetchAssets();
    } catch (err) {
      console.error('Sync failed', err);
      alert('Failed to synchronize assets');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Asset Precisions</h2>
          <p className="text-muted-foreground">Manage and verify symbol precision data from Binance</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
        >
          {syncing ? 'Syncing...' : 'Sync with Binance'}
        </button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-muted text-muted-foreground text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-3 border-b">Symbol</th>
                <th className="px-6 py-3 border-b">Price Precision</th>
                <th className="px-6 py-3 border-b">Quantity Precision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-10 text-center text-muted-foreground">
                    No assets found. Please trigger a sync.
                  </td>
                </tr>
              ) : (
                assets.map((asset) => (
                  <tr key={asset.symbol} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-3 font-mono font-medium">{asset.symbol}</td>
                    <td className="px-6 py-3">{asset.pricePrecision}</td>
                    <td className="px-6 py-3">{asset.quantityPrecision}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
