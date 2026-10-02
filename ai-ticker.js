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

export function startAiTicker(root, subscribe = subscribeQuotes) {
  const quotes = [...root.querySelectorAll('.ai-quote')];
  const status = root.querySelector('.airship-status');
  return subscribe(data => {
    for (const quote of quotes) {
      const value = data[quote.dataset.market];
      const text = value ? formatPrice(value.price, quote.dataset.market === 'BTC' ? 'USD' : 'billion_usd') : '—';
      quote.querySelector('output').textContent = text;
      quoteState(quote, value);
      const name = { ANTHROPIC: 'Anthropic valuation on MNX', OPENAI: 'OpenAI valuation on MNX', BTC: 'Bitcoin price in US dollars on Coinbase Exchange' }[quote.dataset.market];
      quote.setAttribute('aria-label', `${name}: ${text}${value?.stale ? ', saved price' : ''}.`);
    }
    if (status) {
      const values = quotes.map(q => data[q.dataset.market]);
      status.textContent = values.every(v => v === undefined) ? 'CONNECTING'
        : !values.some(Boolean) ? 'SIGNAL LOST'
        : values.some(v => v?.stale) ? 'SAVED PRICES'
        : values.some(v => !v) ? 'PARTIAL SIGNAL' : 'LIVE PRICES';
    }
  });
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('.ai-ticker');
  if (root) startAiTicker(root);
}
