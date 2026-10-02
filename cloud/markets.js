import { MARKETS, RANGES, QUOTE_GROUPS, fetchQuotes, fetchCandles } from './market-providers.js';
import { readCache, claimRefresh, cacheWrite, failRefresh, readCandles, candleWrites } from './market-store.js';

const pending = new WeakMap();
async function coalesce(db, key, run) {
 let map = pending.get(db);
 if (!map) pending.set(db, map = new Map());
 if (map.has(key)) return map.get(key);
 const promise = run();
 map.set(key, promise);
 try { return await promise; } finally { map.delete(key); }
}
async function refreshed(db, key, fresh, update, now) {
 return coalesce(db, key, async () => {
  let row = await readCache(db, key);
  if (fresh(row) || row?.retry_at > now) return row;
  const lease = await claimRefresh(db, key, now);
  if (!lease) {
   // Cold requests racing another Worker wait briefly. Existing history is
   // returned immediately rather than making visitors wait on a provider.
   if (!row?.data) for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    row = await readCache(db, key);
    if (row?.data || row?.retry_at > now) break;
   }
   return row;
  }
  try {
   row = await readCache(db, key);
   if (fresh(row)) {
    await db.prepare('UPDATE market_cache SET lease_until=0 WHERE key=? AND lease_until=?').bind(key, lease).run();
    return row;
   }
   await update(row, lease);
  } catch (error) {
   console.warn('Market refresh failed', key, error.message);
   await failRefresh(db, key, lease, now);
  }
  return readCache(db, key);
 });
}

export async function getQuotes(db, now = Date.now(), fetcher = fetch) {
 const groups = await Promise.all(QUOTE_GROUPS.map(async group => {
  const key = `quote:${group.key}`;
  const row = await refreshed(db, key, row => row?.data && row.expires_at > now, async (_row, lease) => {
   const values = await fetchQuotes(group, now, fetcher);
   await cacheWrite(db, key, { values, fetchedAt: now }, now + group.ttl, lease).run();
  }, now);
  return Object.fromEntries(group.symbols.map(symbol => {
   const quote = row?.data?.values[symbol];
   return [symbol, quote ? { ...quote, fetchedAt: row.data.fetchedAt, stale: row.expires_at <= now || now - quote.asOf > 300_000 } : null];
  }));
 }));
 return { quotes: Object.assign({}, ...groups) };
}

export async function getSeries(db, series, range, from, now, fetcher = fetch) {
 const key = `history:${series}:${range.interval}`;
 const fresh = row => row?.data && row.data.from <= from && row.expires_at > now;
 const update = async (previous, lease) => {
  const old = previous?.data;
  let segments;
  if (!old || old.through < from) segments = [[from, now]];
  else {
   segments = [];
   if (from < old.from) segments.push([from, old.from - 1]);
   if (previous.expires_at <= now) segments.push([Math.max(from, Math.floor(old.through / range.step) * range.step - range.step), now]);
  }
  // MNX only has trailing windows. One appropriately sized request also
  // updates the tail when loading an older range.
  if (series.startsWith('mnx:') && segments.length) segments = [[Math.min(...segments.map(s => s[0])), now]];
  const pages = await Promise.all(segments.map(([start, end]) => fetchCandles(series, range, start, end, fetcher)));
  const merged = new Map(pages.flat().map(c => [c.time, c]));
  const cutoff = Math.floor((now - range.retention) / range.step) * range.step;
  const coverageFrom = old && old.through >= from ? Math.min(old.from, from) : from;
  const through = segments.some(([, end]) => end === now) ? now : old.through;
  await db.batch([
   ...candleWrites(db, series, range.interval, [...merged.values()]),
   db.prepare('DELETE FROM market_candles WHERE series=? AND interval=? AND time<?').bind(series, range.interval, cutoff),
   cacheWrite(db, key, { from: Math.max(cutoff, coverageFrom), through, updatedAt: now }, through + range.ttl, lease),
  ]);
 };
 let row = await refreshed(db, key, fresh, update, now);
 // A wider request may have joined a narrower refresh in this Worker.
 // Recheck coverage before returning, then backfill its missing prefix.
 if (row?.data && row.data.from > from && row.retry_at <= now && row.lease_until <= now) {
  row = await refreshed(db, key, fresh, update, now);
 }
 const candles = await readCandles(db, series, range.interval, from, now);
 return { candles, updatedAt: row?.data?.updatedAt ?? null, stale: !row?.data || row.expires_at <= now, partial: !row?.data || row.data.from > from, available: !!row?.data };
}

export async function getHistory(db, symbol, rangeName, now = Date.now(), fetcher = fetch) {
 const market = MARKETS[symbol], range = RANGES[rangeName];
 const from = Math.floor((now - range.duration) / range.step) * range.step;
 const series = await Promise.all(market.series.map(s => getSeries(db, s, range, from, now, fetcher)));
 if (series.some(s => !s.available && !s.candles.length)) return null;
 let points = series[0].candles;
 if (series.length === 2) {
  const fx = new Map(series[1].candles.map(c => [c.time, c.price]));
  points = points.filter(c => fx.has(c.time)).map(c => ({ time: c.time, price: c.price * fx.get(c.time) }));
 }
 return { symbol, name: market.name, unit: market.unit, source: market.source, range: rangeName, interval: range.interval, step: range.step, from, to: now,
  updatedAt: Math.min(...series.map(s => s.updatedAt ?? 0)), stale: series.some(s => s.stale), partial: series.some(s => s.partial), points };
}

export async function marketResponse(request, db) {
 const url = new URL(request.url);
 const reply = (body, status = 200) => Response.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 503 ? { 'Retry-After': '3' } : {}),
 } });
 if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405);
 try {
  if (url.pathname === '/api/markets/quotes') return reply(await getQuotes(db));
  if (url.pathname !== '/api/markets/history') return reply({ error: 'Not found.' }, 404);
  const symbol = url.searchParams.get('symbol'), range = url.searchParams.get('range') || '1w';
  if (!Object.hasOwn(MARKETS, symbol) || !Object.hasOwn(RANGES, range)) return reply({ error: 'Choose a supported market and time range.' }, 400);
  const result = await getHistory(db, symbol, range);
  return result ? reply(result) : reply({ error: 'Price history is temporarily unavailable. Please try again.' }, 503);
 } catch (error) {
  console.error('Market data unavailable', error.message);
  return reply({ error: 'Price data is temporarily unavailable. Please try again.' }, 503);
 }
}
