import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteText, btcQuoteText } from '../ai-ticker.js';

const now = Date.parse('2026-10-01T20:00:00Z');
const quote = { symbol: 'ANTHROPIC', price_display: 'billion_usd', mark_price: 2132, mark_price_timestamp: new Date(now).toISOString() };
const btc = { price: '84534.01', time: '2026-10-01T20:00:00.279465897Z' };
test('Coinbase BTC spot price displays dollars and cents without valuation scaling', () => {
  assert.equal(btcQuoteText(btc, now), '$84,534.01');
  assert.equal(btcQuoteText({ ...btc, price: '100000' }, now), '$100,000.00');
});
test('invalid or stale BTC quotes never appear as live prices', () => {
  for (const price of [null, '', ' ', 'NaN', 'Infinity', '-1', '0', '123oops', true]) {
    assert.equal(btcQuoteText({ ...btc, price }, now), null);
  }
  assert.equal(btcQuoteText(null, now), null);
  assert.equal(btcQuoteText({ ...btc, time: 'bad' }, now), null);
  assert.equal(btcQuoteText(btc, now + 301000), null);
  assert.equal(btcQuoteText(btc, now - 61000), null);
});
test('MNX billions display as correctly scaled dollar valuations', () => {
  assert.equal(quoteText(quote, 'ANTHROPIC', now), '$2.132T');
  assert.equal(quoteText({ ...quote, symbol: 'OPENAI', mark_price: 1820 }, 'OPENAI', now), '$1.820T');
  assert.equal(quoteText({ ...quote, mark_price: 950.5 }, 'ANTHROPIC', now), '$950.5B');
});
test('wrong markets, invalid prices, and stale data never appear as live quotes', () => {
  for (const patch of [{ symbol: 'ANTHTOP26' }, { price_display: 'percentage' }, { mark_price: null }, { mark_price: -1 }, { mark_price: Infinity }, { mark_price_timestamp: 'bad' }]) {
    assert.equal(quoteText({ ...quote, ...patch }, 'ANTHROPIC', now), null);
  }
  assert.equal(quoteText(quote, 'ANTHROPIC', now + 300001), null);
  assert.equal(quoteText(quote, 'ANTHROPIC', now - 60001), null);
});
