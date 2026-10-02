// One same-origin quote poll supplies every readout on the page. Provider
// requests and their shared cache live in the Worker, never in the browser.
export function formatPrice(price, unit) {
 if (!Number.isFinite(price)) return '—';
 if (unit === 'billion_usd') return price >= 1000 ? `$${(price / 1000).toFixed(3)}T` : `$${price.toFixed(1)}B`;
 return price.toLocaleString('en-US', unit === 'USD' || unit === 'JPY'
  ? { style: 'currency', currency: unit, minimumFractionDigits: 2, maximumFractionDigits: 2 }
  : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function readMarketSnapshot(doc = globalThis.document) {
 try {
  const value = JSON.parse(doc?.getElementById('market-snapshot')?.textContent || '{}');
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
 } catch { return {}; }
}
export function mergeQuotes(previous, incoming) {
 const next = {};
 for (const symbol of ['SP500', 'SOFTBANK', 'ANTHROPIC', 'OPENAI', 'BTC']) {
  const saved = previous[symbol], quote = incoming?.[symbol];
  const valid = quote && Number.isFinite(quote.price) && quote.price >= 0 && Number.isFinite(quote.asOf);
  next[symbol] = valid && (!saved || quote.asOf >= saved.asOf) ? quote
   : saved ? { ...saved, stale: true } : null;
 }
 return next;
}
export function createQuoteFeed({ doc = document, win = window, fetcher = fetch, initial = readMarketSnapshot(doc).quotes || {} } = {}) {
 const listeners = new Set();
 let latest = Object.keys(initial).length ? mergeQuotes({}, initial) : {}, timer, inFlight = false, started = false, disposed = false, controller;
 function emit() { for (const listener of listeners) listener(latest); }
 function stale() { latest = mergeQuotes(latest, {}); emit(); }
 async function refresh() {
  clearTimeout(timer);
  if (disposed || doc.hidden || inFlight) return;
  inFlight = true; controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
   const response = await fetcher('/api/markets/quotes', { cache: 'no-store', signal: controller.signal });
   if (!response.ok) throw new Error('Prices unavailable');
   const data = await response.json();
   if (!data.quotes || typeof data.quotes !== 'object' || Array.isArray(data.quotes)) throw new Error('Invalid prices');
   if (disposed) return;
   latest = mergeQuotes(latest, data.quotes); emit();
  } catch { if (!disposed) stale(); }
  finally {
   clearTimeout(timeout); inFlight = false;
   if (!disposed && !doc.hidden) timer = setTimeout(refresh, 5000);
  }
 }
 function visibility() {
  clearTimeout(timer);
  if (!doc.hidden) refresh();
 }
 return {
  refresh,
  subscribe(listener) {
   listeners.add(listener); listener(latest);
   if (!started) {
    started = true;
    doc.addEventListener('visibilitychange', visibility);
    win.addEventListener('offline', stale); win.addEventListener('online', refresh);
    refresh();
   }
   return () => listeners.delete(listener);
  },
  destroy() {
   disposed = true; clearTimeout(timer); controller?.abort(); listeners.clear();
   doc.removeEventListener('visibilitychange', visibility);
   win.removeEventListener('offline', stale); win.removeEventListener('online', refresh);
  },
 };
}
let feed;
export function subscribeQuotes(listener) {
 feed ||= createQuoteFeed();
 return feed.subscribe(listener);
}
export function quoteState(element, quote) {
 element.dataset.state = quote ? (quote.stale ? 'stale' : 'live') : 'offline';
}
