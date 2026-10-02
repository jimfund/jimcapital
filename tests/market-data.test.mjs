import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createQuoteFeed, quoteState } from '../market-data.js';

const NOW = Date.now();
const initial = { SP500: { price: 6800, asOf: NOW, stale: false }, SOFTBANK: { price: 6385, asOf: NOW, stale: false } };
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
 const css = readFileSync(new URL('../price-history.css', import.meta.url), 'utf8');
 const dom = new JSDOM(`<style>.monitor { opacity: 1; } ${css}</style><section class="monitor"></section><script id="market-snapshot" type="application/json">${JSON.stringify({ quotes: initial })}</script>`, { pretendToBeVisual: true });
 const requests = [], states = [], doc = dom.window.document, monitor = doc.querySelector('.monitor');
 const feed = createQuoteFeed({ doc, win: dom.window, fetcher: () => new Promise(resolve => requests.push(resolve)) });
 feed.subscribe(quotes => { states.push(quotes); quoteState(monitor, quotes.SP500); });
 t.after(() => { feed.destroy(); dom.window.close(); });
 return { dom, doc, monitor, requests, states, feed };
}
test('first subscriber sees saved server prices while refresh is pending; partial and failed responses retain last good values', async t => {
 const { requests, states, feed, monitor, dom } = setup(t);
 assert.equal(states[0].SP500.price, 6800);
 requests.shift()(Response.json({ quotes: { SP500: null, SOFTBANK: { price: 6400, asOf: NOW + 1 } } })); await settle();
 assert.equal(states.at(-1).SP500.price, 6800); assert.equal(states.at(-1).SOFTBANK.price, 6400);
 assert.equal(monitor.dataset.state, 'stale'); assert.equal(dom.window.getComputedStyle(monitor).opacity, '1');
 for (const response of [new Response('', { status: 503 }), Response.json({ quotes: { SP500: { price: null, asOf: NOW + 2 } } }), Response.json({ quotes: { SP500: { price: 1, asOf: NOW - 1000 } } })]) {
  const pending = feed.refresh(); requests.shift()(response); await pending;
  assert.equal(states.at(-1).SP500.price, 6800); assert.equal(states.at(-1).SOFTBANK.price, 6400);
 }
 const pending = feed.refresh(); requests.shift()(Response.json({ quotes: { SP500: { price: 6810, asOf: NOW + 10 } } })); await pending;
 assert.equal(states.at(-1).SP500.price, 6810); assert.equal(monitor.dataset.state, 'live');
});
test('returning to the tab leaves prices and opacity steady; offline and reconnection never clear them', async t => {
 const { requests, states, doc, dom, monitor } = setup(t);
 requests.shift()(Response.json({ quotes: initial })); await settle();
 const count = states.length;
 Object.defineProperty(doc, 'hidden', { configurable: true, value: true }); doc.dispatchEvent(new dom.window.Event('visibilitychange'));
 Object.defineProperty(doc, 'hidden', { configurable: true, value: false }); doc.dispatchEvent(new dom.window.Event('visibilitychange'));
 assert.equal(states.length, count); assert.equal(monitor.dataset.state, 'live');
 dom.window.dispatchEvent(new dom.window.Event('offline'));
 assert.equal(states.at(-1).SP500.price, 6800); assert.equal(dom.window.getComputedStyle(monitor).opacity, '1');
 requests.shift()(Response.json({ quotes: initial })); await settle();
 dom.window.dispatchEvent(new dom.window.Event('online'));
 requests.shift()(Response.json({ quotes: initial })); await settle();
 assert.equal(monitor.dataset.state, 'live');
});
