import { subscribeQuotes, formatPrice, quoteState } from './market-data.js';

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
  root.querySelector('.ticker-track').append(copy);
  const duplicates = [...copy.querySelectorAll('.ai-quote')];
  function display(quote, value, data) {
    for (const item of [quote, duplicates[quotes.indexOf(quote)]]) {
      item.querySelector('output').textContent = value;
      quoteState(item, data);
    }
  }
  subscribeQuotes(data => {
    for (const quote of quotes) {
      const value = data[quote.dataset.market];
      display(quote, value ? formatPrice(value.price, quote.dataset.market === 'BTC' ? 'USD' : 'billion_usd') : '—', value);
    }
  });
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('.ai-ticker');
  if (root) startAiTicker(root);
}
