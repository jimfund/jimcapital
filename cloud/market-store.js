// Persistent cache and short refresh leases shared by all visitors/Workers.
// No runtime schema creation: tables are provisioned by the D1 migration.
export async function readCache(db, key) {
 const row = await db.prepare('SELECT * FROM market_cache WHERE key=?').bind(key).first();
 return row ? { ...row, data: row.payload ? JSON.parse(row.payload) : null } : null;
}
export async function claimRefresh(db, key, now) {
 const lease = now + 30_000;
 const result = await db.prepare(`INSERT INTO market_cache (key,lease_until) VALUES (?,?)
  ON CONFLICT(key) DO UPDATE SET lease_until=excluded.lease_until
  WHERE market_cache.lease_until<=? AND market_cache.retry_at<=?`).bind(key, lease, now, now).run();
 return result.meta.changes ? lease : null;
}
export function cacheWrite(db, key, data, expiresAt, lease) {
 return db.prepare('UPDATE market_cache SET payload=?,expires_at=?,retry_at=0,lease_until=0 WHERE key=? AND lease_until=?')
  .bind(JSON.stringify(data), expiresAt, key, lease);
}
export async function failRefresh(db, key, lease, now) {
 await db.prepare('UPDATE market_cache SET lease_until=0,retry_at=? WHERE key=? AND lease_until=?').bind(now + 15_000, key, lease).run();
}
export async function readCandles(db, series, interval, from, to) {
 return (await db.prepare('SELECT time,close AS price FROM market_candles WHERE series=? AND interval=? AND time>=? AND time<=? ORDER BY time')
  .bind(series, interval, from, to).all()).results;
}
export function candleWrites(db, series, interval, candles) {
 const statements = [];
 // Reuse the series/interval bindings: 49 pairs + 2 = 100 parameters.
 // Even the two-series month chart fits within D1's free query limit.
 for (let start = 0; start < candles.length; start += 49) {
  const part = candles.slice(start, start + 49);
  statements.push(db.prepare(`WITH incoming(time,close) AS (VALUES ${part.map(() => '(?,?)').join(',')})
   INSERT INTO market_candles (series,interval,time,close) SELECT ?,?,time,close FROM incoming WHERE true
   ON CONFLICT(series,interval,time) DO UPDATE SET close=excluded.close`)
   .bind(...part.flatMap(c => [c.time, c.price]), series, interval));
 }
 return statements;
}
