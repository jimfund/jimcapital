export function quoteText(market, symbol, now = Date.now()) {
  const price = market?.mark_price;
  const timestamp = Date.parse(market?.mark_price_timestamp);
  if (market?.symbol !== symbol || market.price_display !== 'billion_usd'
    || typeof price !== 'number' || !Number.isFinite(price) || price < 0
    || !Number.isFinite(timestamp) || now - timestamp > 300000 || timestamp - now > 60000) return null;
  return price >= 1000 ? `$${(price / 1000).toFixed(3)}T` : `$${price.toFixed(1)}B`;
}

export function btcQuoteText(quote, now = Date.now()) {
  const raw = quote?.price;
  const price = typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  const timestamp = Date.parse(quote?.time);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)
    || now - timestamp > 300000 || timestamp - now > 60000) return null;
  return price.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function startAiTicker(root) {
  const quotes = [...root.querySelectorAll('.ai-quote')];
  const copy = root.querySelector('.ticker-copy').cloneNode(true);
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  root.querySelector('.ticker-track').append(copy);
  const duplicates = [...copy.querySelectorAll('.ai-quote')];
  function display(quote, value, state) {
    for (const item of [quote, duplicates[quotes.indexOf(quote)]]) {
      item.querySelector('output').textContent = value;
      item.dataset.state = state;
    }
  }
  let timer, inFlight = false;
  const clear = quote => display(quote, '—', 'offline');
  async function refresh() {
    clearTimeout(timer);
    if (document.hidden || inFlight) return;
    inFlight = true;
    await Promise.allSettled(quotes.map(async quote => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const isBtc = quote.dataset.market === 'BTC';
        const endpoint = isBtc ? 'https://api.exchange.coinbase.com/products/BTC-USD/ticker'
          : `https://api.app.mnx.fi/v0/markets/${quote.dataset.marketId}`;
        const response = await fetch(endpoint, {
          signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) throw new Error('Quote unavailable');
        const data = await response.json();
        const value = isBtc ? btcQuoteText(data) : quoteText(data, quote.dataset.market);
        if (value === null) throw new Error('Quote unavailable');
        display(quote, value, 'live');
      } catch { clear(quote); }
      finally { clearTimeout(timeout); }
    }));
    inFlight = false;
    if (!document.hidden) timer = setTimeout(refresh, 30000);
  }
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden) { quotes.forEach(clear); refresh(); }
  });
  window.addEventListener('offline', () => quotes.forEach(clear));
  window.addEventListener('online', refresh);
  refresh();
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('.ai-ticker');
  if (root) startAiTicker(root);
}
