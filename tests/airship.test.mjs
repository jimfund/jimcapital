import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { screenMatrix, SCREEN_CORNERS, SCREEN_WIDTH, SCREEN_HEIGHT } from '../airship.js';
import { startAiTicker } from '../ai-ticker.js';

test('the screen perspective keeps all four text-plane corners inside the billboard at different sizes', () => {
 const inputs = [[0, 0], [SCREEN_WIDTH, 0], [SCREEN_WIDTH, SCREEN_HEIGHT], [0, SCREEN_HEIGHT]];
 for (const scale of [1, 680 / 1672, 488 / 1672, .1]) {
  const m = screenMatrix(scale);
  inputs.forEach(([x, y], i) => {
   const w = m[3] * x + m[7] * y + m[15];
   const projected = [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
   projected.forEach((v, j) => assert.ok(Math.abs(v - SCREEN_CORNERS[i][j] * scale) < .00001));
  });
 }
});
test('all three live quotes fit separate rows, retain their own history links and report stale or unavailable feeds', () => {
 const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
 const root = dom.window.document.querySelector('.market-airship');
 let render;
 const stop = startAiTicker(root, fn => { render = fn; fn({}); return () => {}; });
 const status = () => root.querySelector('.airship-status').textContent;
 const output = market => root.querySelector(`[data-market="${market}"] output`).textContent;
 const quotes = { ANTHROPIC: { price: 2132, asOf: Date.now(), stale: false }, OPENAI: { price: 1820, asOf: Date.now(), stale: false }, BTC: { price: 84534.01, asOf: Date.now(), stale: false } };
 assert.equal(status(), 'CONNECTING');
 render(quotes);
 assert.equal(status(), 'LIVE PRICES');
 assert.equal(output('ANTHROPIC'), '$2.132T'); assert.equal(output('OPENAI'), '$1.820T'); assert.equal(output('BTC'), '$84,534.01');
 for (const link of root.querySelectorAll('.ai-quote')) {
  assert.equal(link.tagName, 'A'); assert.equal(new URL(link.getAttribute('href'), 'https://jim.capital').searchParams.get('symbol'), link.dataset.market);
  assert.ok(link.getAttribute('aria-label').includes(link.querySelector('output').textContent));
 }
 render({ ...quotes, OPENAI: null }); assert.equal(status(), 'PARTIAL SIGNAL'); assert.equal(output('OPENAI'), '—'); assert.equal(output('BTC'), '$84,534.01');
 render({ ...quotes, ANTHROPIC: { ...quotes.ANTHROPIC, stale: true } }); assert.equal(status(), 'SAVED PRICES');
 assert.equal(root.querySelector('[data-market="ANTHROPIC"]').dataset.state, 'stale');
 render({ ANTHROPIC: null, OPENAI: null, BTC: null }); assert.equal(status(), 'SIGNAL LOST');
 assert.equal(root.querySelectorAll('.ai-quote').length, 3);
 stop(); dom.window.close();
});
