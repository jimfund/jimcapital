// One same-origin quote poll supplies every readout on the page. Provider
// requests and their shared cache live in the Worker, never in the browser.
export function formatPrice(price, unit) {
 if (!Number.isFinite(price)) return '—';
 if (unit === 'billion_usd') return price >= 1000 ? `$${(price / 1000).toFixed(3)}T` : `$${price.toFixed(1)}B`;
 return price.toLocaleString('en-US', unit === 'USD' || unit === 'JPY'
  ? { style: 'currency', currency: unit, minimumFractionDigits: 2, maximumFractionDigits: 2 }
  : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const listeners = new Set();
let latest = {}, timer, inFlight = false, started = false;
function emit() { for (const listener of listeners) listener(latest); }
function stale() {
 latest = Object.fromEntries(Object.entries(latest).map(([symbol, quote]) => [symbol, quote ? { ...quote, stale: true } : null]));
 emit();
}
async function refresh() {
 clearTimeout(timer);
 if (document.hidden || inFlight) return;
 inFlight = true;
 try {
  const response = await fetch('/api/markets/quotes', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Prices unavailable');
  const data = await response.json();
  if (!data.quotes || typeof data.quotes !== 'object') throw new Error('Invalid prices');
  latest = data.quotes;
  emit();
 } catch { stale(); }
 finally {
  inFlight = false;
  if (!document.hidden) timer = setTimeout(refresh, 5000);
 }
}
export function subscribeQuotes(listener) {
 listeners.add(listener);
 listener(latest);
 if (!started) {
  started = true;
  document.addEventListener('visibilitychange', () => {
   clearTimeout(timer);
   if (!document.hidden) { stale(); refresh(); }
  });
  window.addEventListener('offline', stale);
  window.addEventListener('online', refresh);
  refresh();
 }
 return () => listeners.delete(listener);
}
export function quoteState(element, quote) {
 element.dataset.state = quote ? (quote.stale ? 'stale' : 'live') : 'offline';
 element.title = quote
  ? `${quote.stale ? 'Saved price' : 'Latest price'} · ${new Date(quote.asOf).toLocaleString()} · Open price history`
  : 'Price unavailable · Open price history';
}
