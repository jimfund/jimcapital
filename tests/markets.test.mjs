import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { getQuotes, getHistory, marketResponse } from '../cloud/markets.js';
import { fetchCandles, fetchQuotes, QUOTE_GROUPS, RANGES } from '../cloud/market-providers.js';
import { claimRefresh } from '../cloud/market-store.js';
import { withMarketSnapshot } from '../cloud/market-homepage.js';

const NOW = Date.parse('2026-10-01T20:10:00Z');
const HOUR = 3600000, DAY = HOUR * 24;
function database() {
 const sqlite = new DatabaseSync(':memory:');
 for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
 let queries = 0;
 return {
  sqlite, get queries() { return queries; },
  prepare(sql) {
   const statement = sqlite.prepare(sql); let args = [];
   return {
    bind(...values) { assert.ok(values.length <= 100, 'D1 parameter limit'); args = values; return this; },
    first() { queries++; return statement.get(...args) || null; },
    all() { queries++; return { results: statement.all(...args) }; },
    run() { queries++; return { meta: { changes: Number(statement.run(...args).changes) } }; },
   };
  },
  batch(statements) { sqlite.exec('BEGIN'); try { const result = statements.map(s => s.run()); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
 };
}
function provider(now = NOW) {
 const calls = [];
 const fetcher = async (url, options) => {
  assert.equal(options.headers['User-Agent'], 'jim.capital/1.0 (+https://jim.capital)');
  url = new URL(url); const body = options?.body ? JSON.parse(options.body) : null;
  calls.push({ url, body });
  if (body?.type === 'metaAndAssetCtxs') return Response.json([{ universe: ['xyz:SP500', 'xyz:SOFTBANK', 'xyz:JPY'].map(name => ({ name })) }, [{ markPx: '6800.5' }, { markPx: '50' }, { markPx: '150' }]]);
  if (/\/markets\/\d+$/.test(url.pathname)) return Response.json({ symbol: url.pathname.endsWith('/11') ? 'ANTHROPIC' : 'OPENAI', price_display: 'billion_usd', mark_price: 2000, mark_price_timestamp: new Date(now).toISOString() });
  if (url.pathname.endsWith('/ticker')) return Response.json({ price: '84534.01', time: new Date(now).toISOString() });
  let from, to, step;
  if (body) { from = body.req.startTime; to = body.req.endTime; step = { '5m': 300000, '1h': HOUR, '1d': DAY }[body.req.interval]; }
  else if (url.hostname === 'api.app.mnx.fi') { step = { '5m': 300000, '1h': HOUR, '1d': DAY }[url.searchParams.get('interval')]; from = now - Number(url.searchParams.get('lookback_ms')); to = now; }
  else { from = Date.parse(url.searchParams.get('start')); to = Date.parse(url.searchParams.get('end')); step = Number(url.searchParams.get('granularity')) * 1000; assert.ok(to - from <= 299 * step); }
  const points = [];
  for (let time = Math.ceil(from / step) * step; time <= to; time += step) points.push({ time, price: body?.req.coin === 'xyz:JPY' ? 150 : 100 + time / DAY % 10 });
  if (body) return Response.json(points.map(p => ({ t: p.time, c: String(p.price), s: body.req.coin, i: body.req.interval })));
  if (url.hostname === 'api.app.mnx.fi') return Response.json({ market_id: Number(url.pathname.split('/')[3]), interval: url.searchParams.get('interval'), candlesticks: points.slice(-Number(url.searchParams.get('limit'))).map(p => ({ time: p.time / 1000, close: p.price })) });
  return Response.json(points.reverse().map(p => [p.time / 1000, 1, 2, 1, p.price, 10]));
 };
 return { calls, fetcher };
}

test('quote cache skips provider calls until each feed expires and shares concurrent requests', async () => {
 const db = database(), p = provider();
 const results = await Promise.all(Array.from({ length: 5 }, () => getQuotes(db, NOW, p.fetcher)));
 assert.equal(p.calls.length, 4);
 assert.equal(results[0].quotes.SOFTBANK.price, 7500);
 assert.equal(results[0].quotes.BTC.price, 84534.01);
 assert.equal(results[0].quotes.SP500.stale, false);
 await getQuotes(db, NOW + 4000, p.fetcher); assert.equal(p.calls.length, 4);
 await getQuotes(db, NOW + 6000, p.fetcher); assert.equal(p.calls.length, 5);
 assert.equal(p.calls.at(-1).body.type, 'metaAndAssetCtxs');
 await getQuotes(db, NOW + 31000, p.fetcher); assert.equal(p.calls.length, 9);
});
test('one failed feed retains its saved quote, marks it stale, and backs off without blanking other feeds', async t => {
 t.mock.method(console, 'warn', () => {});
 const db = database(), p = provider(); await getQuotes(db, NOW, p.fetcher);
 let failures = 0;
 const fetcher = (url, options) => { if (String(url).includes('/markets/11')) { failures++; throw new Error('offline'); } return p.fetcher(url, options); };
 const result = await getQuotes(db, NOW + 31000, fetcher);
 assert.equal(result.quotes.ANTHROPIC.stale, true); assert.equal(result.quotes.ANTHROPIC.price, 2000);
 assert.equal(result.quotes.OPENAI.stale, false); assert.equal(result.quotes.BTC.stale, false);
 await getQuotes(db, NOW + 35000, fetcher); assert.equal(failures, 1);
});
test('a partial XYZ refresh retains the missing instrument with its original timestamp', async () => {
 const db = database(), p = provider(); await getQuotes(db, NOW, p.fetcher);
 const partial = (url, options) => JSON.parse(options.body || '{}').type === 'metaAndAssetCtxs'
  ? Response.json([{ universe: [{ name: 'xyz:SP500' }] }, [{ markPx: '6900' }]]) : p.fetcher(url, options);
 const result = await getQuotes(db, NOW + 6000, partial);
 assert.equal(result.quotes.SP500.price, 6900); assert.equal(result.quotes.SP500.stale, false);
 assert.equal(result.quotes.SOFTBANK.price, 7500); assert.equal(result.quotes.SOFTBANK.stale, true);
 assert.equal(result.quotes.SOFTBANK.asOf, NOW); assert.equal(result.quotes.SOFTBANK.fetchedAt, NOW);
});
test('expired quotes and history return before slow providers and then refresh for the next visitor', async t => {
 const db = database(), p = provider();
 await getQuotes(db, NOW, p.fetcher); await getHistory(db, 'SOFTBANK', '1d', NOW, p.fetcher);
 let release;
 const gate = new Promise(resolve => { release = resolve; });
 t.after(release);
 const background = [], options = { waitUntil: promise => background.push(promise) };
 const next = provider(NOW + 61000), slow = async (...args) => { await gate; return next.fetcher(...args); };
 const responses = Promise.all([getQuotes(db, NOW + 61000, slow, options), getHistory(db, 'SOFTBANK', '1d', NOW + 61000, slow, options)]);
 let timeout;
 const [quotes, history] = await Promise.race([responses, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Blocked on provider')), 1000); })]).finally(() => clearTimeout(timeout));
 assert.equal(quotes.quotes.SP500.price, 6800.5); assert.equal(quotes.quotes.SP500.stale, true);
 assert.ok(history.points.length); assert.equal(history.stale, true); assert.equal(next.calls.length, 0);
 assert.ok(background.length); release(); await Promise.all(background);
 const refreshed = await getQuotes(db, NOW + 62000, next.fetcher);
 assert.equal(refreshed.quotes.SP500.asOf, NOW + 61000); assert.equal(refreshed.quotes.SP500.stale, false);
});
test('homepage embeds real saved prices and history without any provider call, and still serves HTML if D1 is unavailable', async t => {
 const db = database(), p = provider();
 await getQuotes(db, NOW, p.fetcher); await getHistory(db, 'SOFTBANK', '1d', NOW, p.fetcher);
 let calls = 0; t.mock.method(globalThis, 'fetch', () => { calls++; throw new Error('offline'); });
 const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
 const page = () => new Response(source, { headers: { 'Content-Type': 'text/html', ETag: 'original' } });
 const response = await withMarketSnapshot(page(), db, NOW + 61000), html = await response.text();
 assert.ok(html.includes('id="spx-price">6,800.50</output>')); assert.ok(html.includes('id="softbank-price">7,500.00</output>'));
 const snapshot = JSON.parse(html.match(/<script id="market-snapshot" type="application\/json">(.*?)<\/script>/s)[1]);
 assert.ok(snapshot.softbank.points.length); assert.equal(snapshot.quotes.SP500.stale, true); assert.equal(calls, 0);
 assert.equal(response.headers.get('ETag'), null);
 const unavailable = await withMarketSnapshot(page(), { prepare() { throw new Error('D1 offline'); } }, NOW);
 assert.equal(unavailable.status, 200); assert.ok((await unavailable.text()).includes('market-snapshot'));
 const cold = await withMarketSnapshot(page(), database(), NOW);
 assert.equal(cold.status, 200); assert.equal(calls, 0);
});
test('history reuses cached candles, backfills only the missing prefix and refreshes a short tail', async () => {
 const db = database(), p = provider();
 const week = await getHistory(db, 'SP500', '1w', NOW, p.fetcher);
 assert.equal(week.points.length, 169); assert.equal(p.calls.length, 1);
 await getHistory(db, 'SP500', '1w', NOW + 1000, p.fetcher); assert.equal(p.calls.length, 1);
 const month = await getHistory(db, 'SP500', '1m', NOW + 2000, p.fetcher);
 assert.equal(month.points.length, 721); assert.equal(p.calls.length, 2);
 assert.equal(p.calls[1].body.req.endTime, week.from - 1);
 await getHistory(db, 'SP500', '1m', NOW + 301000, p.fetcher);
 assert.equal(p.calls.length, 3);
 assert.ok(p.calls[2].body.req.startTime >= NOW - 2 * HOUR);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM market_candles').get().n, 721);
});
test('a concurrent wider history request receives the backfill it needs', async () => {
 const db = database(), p = provider();
 const [week, month] = await Promise.all([getHistory(db, 'SP500', '1w', NOW, p.fetcher), getHistory(db, 'SP500', '1m', NOW, p.fetcher)]);
 assert.equal(week.partial, false); assert.equal(month.partial, false); assert.equal(month.points.length, 721);
 assert.equal(p.calls.length, 2);
});
test('provider outages return saved history and retry backoff preserves it', async t => {
 t.mock.method(console, 'warn', () => {});
 const db = database(), p = provider(); const original = await getHistory(db, 'BTC', '1w', NOW, p.fetcher);
 let failures = 0; const fail = () => { failures++; throw new Error('offline'); };
 const saved = await getHistory(db, 'BTC', '1w', NOW + 301000, fail);
 assert.equal(saved.stale, true); assert.deepEqual(saved.points, original.points);
 const wider = await getHistory(db, 'BTC', '1m', NOW + 302000, fail);
 assert.equal(wider.partial, true); assert.equal(failures, 1);
 assert.equal(await getHistory(db, 'OPENAI', '1w', NOW, fail), null);
});
test('SoftBank converts matching candles only, and the month load stays below 50 D1 statements', async () => {
 const db = database(), p = provider();
 const result = await getHistory(db, 'SOFTBANK', '1m', NOW, p.fetcher);
 assert.equal(result.points.length, 721); assert.ok(db.queries < 50, `${db.queries} queries`);
 assert.ok(Math.abs(result.points[0].price - (100 + result.points[0].time / DAY % 10) * 150) < .00001);
 const missing = provider(); const fetcher = async (url, options) => {
  const r = await missing.fetcher(url, options);
  return JSON.parse(options.body).req.coin === 'xyz:JPY' ? Response.json((await r.json()).slice(1)) : r;
 };
 const less = await getHistory(database(), 'SOFTBANK', '1w', NOW, fetcher);
 assert.equal(less.points.length, 168);
});
test('MNX explicitly requests marks and expands its trailing window only when needed', async () => {
 const db = database(), p = provider();
 await getHistory(db, 'ANTHROPIC', '1m', NOW, p.fetcher);
 const first = p.calls[0].url.searchParams;
 assert.equal(first.get('source'), 'mark_price'); assert.ok(Number(first.get('limit')) > 720);
 await getHistory(db, 'ANTHROPIC', '1m', NOW + 301000, p.fetcher);
 const tail = p.calls[1].url.searchParams;
 assert.ok(Number(tail.get('limit')) < 10); assert.ok(Number(tail.get('lookback_ms')) < 3 * HOUR);
});
test('Coinbase backfills fit its bucket limit, sort ascending, and deduplicate page boundaries', async () => {
 const p = provider();
 const data = await getHistory(database(), 'BTC', '1y', NOW, p.fetcher);
 assert.equal(p.calls.length, 2); assert.equal(data.points.length, 366);
 assert.equal(new Set(data.points.map(p => p.time)).size, 366);
 assert.ok(data.points.every((p, i) => !i || p.time > data.points[i - 1].time));
});
test('invalid provider values, timestamps, units and mismatched candles are rejected', async () => {
 const btc = QUOTE_GROUPS.find(g => g.key === 'coinbase');
 for (const price of [null, '', ' ', 'NaN', 'Infinity', '-1', '0', '123oops', true]) await assert.rejects(fetchQuotes(btc, NOW, async () => Response.json({ price, time: new Date(NOW).toISOString() })));
 for (const time of [NOW - 300001, NOW + 60001]) await assert.rejects(fetchQuotes(btc, NOW, async () => Response.json({ price: '100', time: new Date(time).toISOString() })));
 await assert.rejects(fetchQuotes(QUOTE_GROUPS[1], NOW, async () => Response.json({ symbol: 'WRONG', price_display: 'billion_usd', mark_price: 2000, mark_price_timestamp: new Date(NOW).toISOString() })));
 await assert.rejects(fetchCandles('xyz:SP500', RANGES['1w'], NOW - DAY, NOW, async () => Response.json([{ s: 'xyz:WRONG', i: '1h', t: NOW, c: '5' }])));
});
test('persistent leases exclude another Worker and expire after an interrupted refresh', async () => {
 const db = database();
 assert.ok(await claimRefresh(db, 'shared', NOW));
 assert.equal(await claimRefresh(db, 'shared', NOW + 1000), null);
 assert.ok(await claimRefresh(db, 'shared', NOW + 30001));
});
test('brief provider rate limits retry within the request; longer limits fail into the cache backoff', async () => {
 const p = provider(); let attempts = 0;
 const data = await fetchCandles('coinbase:BTC-USD', RANGES['1w'], NOW - DAY, NOW, (url, options) => {
  attempts++;
  return attempts === 1 ? new Response('Busy', { status: 429, headers: { 'Retry-After': '0' } }) : p.fetcher(url, options);
 });
 assert.equal(attempts, 2); assert.equal(data.length, 24);
 attempts = 0;
 await assert.rejects(fetchCandles('coinbase:BTC-USD', RANGES['1w'], NOW - DAY, NOW, () => {
  attempts++; return new Response('Busy', { status: 429, headers: { 'Retry-After': '30' } });
 }));
 assert.equal(attempts, 1);
});
test('public market routes reject unknown symbols, ranges and methods before touching providers', async () => {
 for (const query of ['symbol=__proto__', 'symbol=BTC&range=all', 'symbol=BTC%27%3BDELETE', '']) {
  const r = await marketResponse(new Request('https://example.com/api/markets/history?' + query), database()); assert.equal(r.status, 400);
 }
 assert.equal((await marketResponse(new Request('https://example.com/api/markets/quotes', { method: 'POST' }), database())).status, 405);
});
