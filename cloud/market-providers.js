const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const RANGES = {
 '1d': { duration: DAY, interval: '5m', step: 5 * MINUTE, ttl: MINUTE, retention: 3 * DAY },
 '1w': { duration: 7 * DAY, interval: '1h', step: HOUR, ttl: 5 * MINUTE, retention: 40 * DAY },
 '1m': { duration: 30 * DAY, interval: '1h', step: HOUR, ttl: 5 * MINUTE, retention: 40 * DAY },
 '1y': { duration: 365 * DAY, interval: '1d', step: DAY, ttl: 30 * MINUTE, retention: 400 * DAY },
};
export const MARKETS = {
 SP500: { name: 'S&P 500 · XYZ', unit: 'points', series: ['xyz:SP500'], source: 'XYZ on Hyperliquid · perpetual trade closes. The live readout uses the mark price.' },
 SOFTBANK: { name: 'SoftBank · XYZ', unit: 'JPY', series: ['xyz:SOFTBANK', 'xyz:JPY'], source: 'XYZ perpetual trade closes × matching USD/JPY closes · estimated yen price. The live readout uses mark prices.' },
 ANTHROPIC: { name: 'Anthropic · MNX', unit: 'billion_usd', series: ['mnx:11'], source: 'MNX valuation futures · mark-price closes, in billions of US dollars.' },
 OPENAI: { name: 'OpenAI · MNX', unit: 'billion_usd', series: ['mnx:12'], source: 'MNX valuation futures · mark-price closes, in billions of US dollars.' },
 BTC: { name: 'Bitcoin', unit: 'USD', series: ['coinbase:BTC-USD'], source: 'Coinbase Exchange · BTC/USD spot trade closes.' },
};

function number(value, zero = false) {
 if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || String(value).trim() !== String(value)) throw new Error('Invalid price');
 const n = Number(value);
 if (!Number.isFinite(n) || (zero ? n < 0 : n <= 0)) throw new Error('Invalid price');
 return n;
}
function timestamp(value, now) {
 const time = Date.parse(value);
 if (!Number.isFinite(time) || time > now + MINUTE || time < now - 5 * MINUTE) throw new Error('Stale quote');
 return time;
}
async function json(url, options, fetcher) {
 const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(7000), headers: {
  ...options?.headers, Accept: 'application/json', 'User-Agent': 'jim.capital/1.0 (+https://jim.capital)',
 } });
 if (!response.ok) throw new Error(`Price provider returned ${response.status}: ${(await response.text()).slice(0, 160)}`);
 return response.json();
}
export const QUOTE_GROUPS = [
 { key: 'xyz', ttl: 5000, symbols: ['SP500', 'SOFTBANK'] },
 { key: 'mnx:11', ttl: 30_000, symbols: ['ANTHROPIC'] },
 { key: 'mnx:12', ttl: 30_000, symbols: ['OPENAI'] },
 { key: 'coinbase', ttl: 30_000, symbols: ['BTC'] },
];
export async function fetchQuotes(group, now, fetcher = fetch) {
 if (group.key === 'xyz') {
  const data = await json('https://api.hyperliquid.xyz/info', {
   method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: 'xyz' }),
  }, fetcher);
  const [meta, contexts] = Array.isArray(data) ? data : [];
  if (!Array.isArray(meta?.universe) || !Array.isArray(contexts)) throw new Error('Invalid XYZ response');
  const price = name => number(contexts[meta.universe.findIndex(a => a.name === name && !a.isDelisted)]?.markPx);
  const quotes = {};
  // A missing/delisted instrument must not take down the other readout.
  try { quotes.SP500 = { price: price('xyz:SP500'), asOf: now }; } catch { /* unavailable */ }
  try { quotes.SOFTBANK = { price: number(price('xyz:SOFTBANK') * price('xyz:JPY')), asOf: now }; } catch { /* unavailable */ }
  if (!Object.keys(quotes).length) throw new Error('XYZ quotes unavailable');
  return quotes;
 }
 if (group.key === 'coinbase') {
  const d = await json('https://api.exchange.coinbase.com/products/BTC-USD/ticker', {}, fetcher);
  return { BTC: { price: number(d.price), asOf: timestamp(d.time, now) } };
 }
 const id = group.key.split(':')[1], symbol = group.symbols[0];
 const d = await json(`https://api.app.mnx.fi/v0/markets/${id}`, {}, fetcher);
 if (d.symbol !== symbol || d.price_display !== 'billion_usd') throw new Error('Wrong MNX market');
 return { [symbol]: { price: number(d.mark_price, true), asOf: timestamp(d.mark_price_timestamp, now) } };
}

export async function fetchCandles(series, range, from, to, fetcher = fetch) {
 let raw;
 if (series.startsWith('mnx:')) {
  // MNX supports a trailing window, not arbitrary start/end. Its limit is
  // reduced for incremental refreshes; older backfills necessarily overlap.
  const limit = Math.min(5000, Math.ceil((to - from) / range.step) + 2);
  const params = new URLSearchParams({ interval: range.interval, source: 'mark_price', limit: String(limit), lookback_ms: String(Math.max(MINUTE, to - from + range.step)) });
  const d = await json(`https://api.app.mnx.fi/v0/markets/${series.split(':')[1]}/candlesticks?${params}`, {}, fetcher);
  if (!Array.isArray(d.candlesticks) || d.market_id !== Number(series.split(':')[1]) || d.interval !== range.interval) throw new Error('Invalid MNX history');
  raw = d.candlesticks.map(c => [c.time * 1000, c.close]);
 } else if (series.startsWith('xyz:')) {
  const d = await json('https://api.hyperliquid.xyz/info', {
   method: 'POST', headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ type: 'candleSnapshot', req: { coin: series, interval: range.interval, startTime: from, endTime: to } }),
  }, fetcher);
  if (!Array.isArray(d) || d.some(c => c.s !== series || c.i !== range.interval)) throw new Error('Invalid XYZ history');
  raw = d.map(c => [c.t, c.c]);
 } else {
  // Coinbase limits each request to 300 buckets. Keep requests bounded and
  // fetch disjoint windows; providers can still return overlapping rows.
  const windows = [];
  for (let start = from; start <= to; start += range.step * 299) windows.push([start, Math.min(to, start + range.step * 299)]);
  const pages = await Promise.all(windows.map(async ([start, end]) => {
   const params = new URLSearchParams({ granularity: String(range.step / 1000), start: new Date(start).toISOString(), end: new Date(end).toISOString() });
   const d = await json(`https://api.exchange.coinbase.com/products/BTC-USD/candles?${params}`, {}, fetcher);
   if (!Array.isArray(d)) throw new Error('Invalid Coinbase history');
   return d.map(c => [c[0] * 1000, c[4]]);
  }));
  raw = pages.flat();
 }
 const unique = new Map();
 for (const [time, value] of raw) {
  if (!Number.isSafeInteger(time) || time <= 0 || time % range.step !== 0) throw new Error('Invalid candle time');
  const price = number(value, series.startsWith('mnx:'));
  if (time >= from && time <= to) unique.set(time, { time, price });
 }
 return [...unique.values()].sort((a, b) => a.time - b.time);
}
