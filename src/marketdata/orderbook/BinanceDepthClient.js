// src/marketdata/orderbook/BinanceDepthClient.js
import WebSocket from 'ws';

const ENDPOINTS = {
  spot: {
    ws: (sym) => `wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@depth@100ms`,
    rest: (sym, limit) => `https://api.binance.com/api/v3/depth?symbol=${sym.toUpperCase()}&limit=${limit}`,
    hasTape: false,
  },
  fut: {
    ws: (sym) => `wss://fstream.binance.com/ws/${sym.toLowerCase()}@depth@100ms/${sym.toLowerCase()}@aggTrade`,
    rest: (sym, limit) => `https://fapi.binance.com/fapi/v1/depth?symbol=${sym.toUpperCase()}&limit=${limit}`,
    hasTape: true,
  },
};

/**
 * Thin IO for ONE venue: opens the depth (+ futures aggTrade) websocket and fetches the
 * REST snapshot. Emits raw parsed frames through the handlers; all book/sequence logic
 * lives in LocalOrderBook. Reconnects with exponential backoff.
 */
export class BinanceDepthClient {
  constructor({ symbol, venue, depthLimit = 20, onDepth, onTrade, onSnapshot, onStatus, maxBackoffMs = 30000 }) {
    this.symbol = symbol;
    this.venue = venue;
    this.depthLimit = depthLimit;
    this.endpoints = ENDPOINTS[venue];
    this.onDepth = onDepth || (() => {});
    this.onTrade = onTrade || (() => {});
    this.onSnapshot = onSnapshot || (() => {});
    this.onStatus = onStatus || (() => {});
    this.maxBackoffMs = maxBackoffMs;
    this.backoff = 1000;
    this.ws = null;
    this.closed = false;
  }

  async fetchSnapshot() {
    const url = this.endpoints.rest(this.symbol, this.depthLimit);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`snapshot ${this.venue} ${this.symbol} HTTP ${res.status}`);
    const data = await res.json();
    // futures uses E (event time); both use bids/asks + lastUpdateId.
    return { lastUpdateId: data.lastUpdateId, bids: data.bids, asks: data.asks };
  }

  connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.endpoints.ws(this.symbol));
    this.ws = ws;
    ws.on('open', () => { this.backoff = 1000; this.onStatus('open'); });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.e === 'depthUpdate') {
        this.onDepth({ U: msg.U, u: msg.u, pu: msg.pu, b: msg.b, a: msg.a, t: msg.E });
      } else if (msg.e === 'aggTrade') {
        this.onTrade({ t: msg.T, p: Number(msg.p), q: Number(msg.q), m: msg.m });
      }
    });
    ws.on('close', () => { this.onStatus('close'); this._reconnect(); });
    ws.on('error', () => { try { ws.close(); } catch { /* ignore */ } });
  }

  _reconnect() {
    if (this.closed) return;
    setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, this.maxBackoffMs);
  }

  close() { this.closed = true; if (this.ws) try { this.ws.close(); } catch { /* ignore */ } }
}
