import { TF_MS, parseCandle, candlesUrl, parseFunding, parseContract, fundingUrl, contractsUrl } from './marketParse.js';

/** Internal: GET a BitGet public endpoint and return parsed `data` (throws on API error). */
async function getBitget(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`BitGet HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== '00000') throw new Error(`BitGet API ${json.code}: ${json.msg}`);
  return json.data || [];
}

/** Fetch one page of Binance candles from `startTime`. Returns parsed Candle[] (ascending). */
export async function fetchCandlesPage({ symbol, timeframe, startTime, limit = 1000 }, fetchImpl = fetch) {
  const res = await fetchImpl(candlesUrl({ symbol, timeframe, startTime, limit }));
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`Binance error: ${json.msg || JSON.stringify(json)}`);
  return json.map(parseCandle).sort((a, b) => a.time - b.time);
}

/** Fetch one page of BitGet funding rows. Returns parsed [{time, rate}] (ascending). */
export async function fetchFundingPage({ symbol, pageSize = 100, pageNo = 1 }, fetchImpl = fetch) {
  const data = await getBitget(fundingUrl({ symbol, pageSize, pageNo }), fetchImpl);
  return data.map(parseFunding).sort((a, b) => a.time - b.time);
}

/** Fetch a single BitGet contract spec (mmr injected — not provided by the API). */
export async function fetchContract({ symbol, mmr }, fetchImpl = fetch) {
  const data = await getBitget(contractsUrl({ symbol }), fetchImpl);
  if (!data.length) throw new Error(`No contract for ${symbol}`);
  return parseContract(data[0], mmr);
}

/**
 * Incrementally download Binance candles into the repo. Idempotent: resumes from the
 * last stored candle, forward-paginates (Binance returns ascending), advances by the
 * max timestamp seen, and stops on no forward progress or past `to`.
 * @returns {Promise<number>} total NEW rows inserted.
 */
export async function downloadCandles(repo, { symbol, timeframe, from, to = Date.now(), pageLimit = 1000 }, fetchImpl = fetch) {
  const tfMs = TF_MS[timeframe];
  if (!tfMs) throw new Error(`Unknown timeframe: ${timeframe}`);

  const last = await repo.lastCandleTime(symbol, timeframe);
  let cursor = last != null ? Math.max(from, last + tfMs) : from;
  let total = 0;

  while (cursor <= to) {
    const page = await fetchCandlesPage({ symbol, timeframe, startTime: cursor, limit: pageLimit }, fetchImpl);
    if (!page.length) break;
    const inRange = page.filter(c => c.time >= from && c.time <= to);
    total += await repo.upsertCandles(symbol, timeframe, inRange);
    const maxTs = page[page.length - 1].time;
    const next = maxTs + tfMs;
    if (next <= cursor) break; // no forward progress → stop
    cursor = next;
  }
  return total;
}
