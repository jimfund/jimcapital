import { getQuotes, getHistory } from './markets.js';
import { formatPrice } from '../market-data.js';

// The first display uses D1 only. An unavailable provider must never delay
// the homepage; the normal API polls refresh this snapshot in the background.
export async function withMarketSnapshot(response, db, now = Date.now()) {
 if (response.status !== 200 || !response.headers.get('Content-Type')?.includes('text/html')) return response;
 const [quotes, history] = await Promise.allSettled([
  getQuotes(db, now, fetch, { cacheOnly: true }),
  getHistory(db, 'SOFTBANK', '1d', now, fetch, { cacheOnly: true }),
 ]);
 const snapshot = { quotes: quotes.status === 'fulfilled' ? quotes.value.quotes : {},
  softbank: history.status === 'fulfilled' ? history.value : null };
 const encoded = JSON.stringify(snapshot).replace(/</g, '\\u003c');
 let page = (await response.text()).replace('<script id="market-snapshot" type="application/json">{}</script>',
  `<script id="market-snapshot" type="application/json">${encoded}</script>`);
 for (const [id, symbol] of [['spx-price', 'SP500'], ['softbank-price', 'SOFTBANK']]) {
  const price = snapshot.quotes[symbol]?.price;
  if (Number.isFinite(price)) page = page.replace(new RegExp(`(<output[^>]*id="${id}"[^>]*>)[^<]*`), (_, opening) => opening + formatPrice(price, 'points'));
 }
 const headers = new Headers(response.headers);
 for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Last-Modified']) headers.delete(name);
 headers.set('Cache-Control', 'no-store');
 return new Response(page, { status: response.status, headers });
}
