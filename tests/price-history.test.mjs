import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { mountPriceHistory, chartGeometry } from '../price-history.js';
import { formatPrice } from '../market-data.js';

const NOW = Date.parse('2026-10-01T20:00:00Z'), HOUR = 3600000;
const history = { symbol: 'BTC', name: 'Bitcoin', unit: 'USD', source: 'Coinbase spot closes.', range: '1w', interval: '1h', step: HOUR, updatedAt: NOW, stale: false, partial: false,
 points: [{ time: NOW - HOUR * 2, price: 80000 }, { time: NOW - HOUR, price: 81000 }, { time: NOW, price: 82000 }] };
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(t, fetcher = async () => Response.json(history), url = 'https://example.com/') {
 const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), { url });
 const { document } = dom.window;
 dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
 dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
 t.mock.method(globalThis, 'fetch', fetcher);
 const dialog = mountPriceHistory(document);
 t.after(() => { dialog.close(); dom.window.close(); });
 return { dom, document, dialog, $: s => dialog.querySelector(s) };
}
test('price formatting keeps yen, dollar prices and billion-dollar valuations distinct', () => {
 assert.equal(formatPrice(7500, 'JPY'), '¥7,500.00');
 assert.equal(formatPrice(2132, 'billion_usd'), '$2.132T');
 assert.equal(formatPrice(950.5, 'billion_usd'), '$950.5B');
 assert.equal(formatPrice(84534.01, 'USD'), '$84,534.01');
});
test('chart uses actual timestamps, breaks missing intervals, and renders flat or single prices', () => {
 const points = [{ time: NOW, price: 1 }, { time: NOW + HOUR, price: 2 }, { time: NOW + HOUR * 4, price: 2 }];
 const chart = chartGeometry(points, HOUR);
 assert.equal((chart.path.match(/M/g) || []).length, 2);
 assert.equal(chart.x(points[1].time), 180);
 for (const data of [[points[0]], points.map(p => ({ ...p, price: 2 }))]) assert.ok(!/NaN|Infinity/.test(chartGeometry(data, HOUR).path));
});
test('clicking a market opens its history, keyboard inspection works, range controls request the chosen period, and close restores focus', async t => {
 const calls = [];
 const { document, dialog, dom, $ } = setup(t, async url => { calls.push(url); return Response.json(history); });
 const btc = document.querySelector('[data-market="BTC"]'); btc.click(); await settle();
 assert.equal(dialog.open, true); assert.equal($('select').value, 'BTC');
 assert.equal(calls[0], '/api/markets/history?symbol=BTC&range=1w');
 assert.equal($('.history-price').textContent, '$82,000.00');
 assert.equal($('.history-plot').hidden, false);
 $('.history-plot').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
 assert.equal($('.history-price').textContent, '$81,000.00');
 assert.ok($('.history-plot').getAttribute('aria-label').includes('$81,000.00'));
 $('[data-range="1y"]').click(); await settle();
 assert.ok(calls.at(-1).endsWith('range=1y')); assert.equal($('[data-range="1y"]').getAttribute('aria-pressed'), 'true');
 $('.history-close').click();
 assert.equal(document.activeElement, document.querySelector('.ai-ticker')); assert.equal(dialog.open, false);
 document.querySelector('.monitor').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
 assert.ok(calls.at(-1).includes('symbol=SP500'));
});
test('an earlier response cannot overwrite a newly selected market', async t => {
 const requests = [];
 const { document, dialog, dom, $ } = setup(t, url => new Promise(resolve => requests.push({ url, resolve })));
 document.querySelector('#price-history-button').click();
 $('select').value = 'BTC'; $('select').dispatchEvent(new dom.window.Event('change'));
 requests[1].resolve(Response.json(history)); await settle();
 requests[0].resolve(Response.json({ ...history, points: [{ time: NOW, price: 1 }] })); await settle();
 assert.equal($('.history-price').textContent, '$82,000.00'); assert.equal(dialog.getAttribute('aria-busy'), 'false');
});
test('failure has a working retry, saved data is labelled, and empty history does not draw invented prices', async t => {
 let attempts = 0;
 const { document, $ } = setup(t, async () => {
  attempts++;
  if (attempts === 1) return new Response('', { status: 503 });
  return Response.json({ ...history, stale: true, partial: true });
 });
 document.querySelector('#price-history-button').click(); await settle();
 assert.equal($('.history-plot').hidden, true); assert.equal($('.history-retry').hidden, false);
 $('.history-retry').click(); await settle();
 assert.equal($('.history-plot').hidden, false); assert.match($('.history-status').textContent, /Saved history/);
 assert.match($('.history-status').textContent, /Only part/);
 t.mock.method(globalThis, 'fetch', async () => Response.json({ ...history, points: [] }));
 $('[data-range="1d"]').click(); await settle();
 assert.equal($('.history-plot').hidden, true); assert.match($('.history-status').textContent, /No candles/);
});
test('board editing never opens a history dialog', async t => {
 const { document, dialog } = setup(t, () => { throw new Error('Should not fetch in editor'); }, 'https://example.com/?edit=1');
 document.querySelector('.monitor').click(); document.querySelector('#price-history-button').click(); await settle();
 assert.equal(dialog.open, false);
});
