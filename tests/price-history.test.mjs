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
function setup(t, fetcher = async () => Response.json(history), url = 'https://example.com/graphs?symbol=BTC&range=1w') {
 const dom = new JSDOM(readFileSync(new URL('../graphs.html', import.meta.url), 'utf8'), { url });
 const { document } = dom.window;
 t.mock.method(globalThis, 'fetch', fetcher);
 const view = mountPriceHistory(document), panel = view.element;
 t.after(() => { view.destroy(); dom.window.close(); });
 return { dom, document, panel, $: s => panel.querySelector(s) };
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
test('a direct graph URL selects its market and period; keyboard inspection and range controls work', async t => {
 const calls = [];
 const { document, panel, dom, $ } = setup(t, async url => { calls.push(url); return Response.json(history); });
 await settle();
 assert.equal($('select').value, 'BTC');
 assert.equal(calls[0], '/api/markets/history?symbol=BTC&range=1w');
 assert.equal($('.history-price').textContent, '$82,000.00');
 assert.equal($('.history-plot').hidden, false);
 $('.history-plot').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
 assert.equal($('.history-price').textContent, '$81,000.00');
 assert.ok($('.history-plot').getAttribute('aria-label').includes('$81,000.00'));
 $('[data-range="1y"]').click(); await settle();
 assert.ok(calls.at(-1).endsWith('range=1y')); assert.equal($('[data-range="1y"]').getAttribute('aria-pressed'), 'true');
 assert.equal(new URL(document.location.href).searchParams.get('range'), '1y');
 assert.equal(document.querySelector('dialog'), null);
});
test('an earlier response cannot overwrite a newly selected market', async t => {
 const requests = [];
 const { document, panel, dom, $ } = setup(t, url => new Promise(resolve => requests.push({ url, resolve })));
 $('select').value = 'BTC'; $('select').dispatchEvent(new dom.window.Event('change'));
 requests[1].resolve(Response.json(history)); await settle();
 requests[0].resolve(Response.json({ ...history, points: [{ time: NOW, price: 1 }] })); await settle();
 assert.equal($('.history-price').textContent, '$82,000.00'); assert.equal(panel.getAttribute('aria-busy'), 'false');
});
test('failure has a working retry, saved data is labelled, and empty history does not draw invented prices', async t => {
 let attempts = 0;
 const { document, $ } = setup(t, async () => {
  attempts++;
  if (attempts === 1) return new Response('', { status: 503 });
  return Response.json({ ...history, stale: true, partial: true });
 });
 await settle();
 assert.equal($('.history-plot').hidden, true); assert.equal($('.history-retry').hidden, false);
 $('.history-retry').click(); await settle();
 assert.equal($('.history-plot').hidden, false); assert.match($('.history-status').textContent, /Saved history/);
 assert.match($('.history-status').textContent, /Only part/);
 t.mock.method(globalThis, 'fetch', async () => Response.json({ ...history, points: [] }));
 $('[data-range="1d"]').click(); await settle();
 assert.equal($('.history-plot').hidden, true); assert.match($('.history-status').textContent, /No candles/);
});
test('graphs defaults to SoftBank over 24 hours and does not mount on the homepage', async t => {
 const calls = [];
 const { $ } = setup(t, async url => { calls.push(url); return Response.json(history); }, 'https://example.com/graphs');
 await settle();
 assert.equal($('select').value, 'SOFTBANK');
 assert.equal(calls[0], '/api/markets/history?symbol=SOFTBANK&range=1d');
 assert.equal($('[data-range="1d"]').getAttribute('aria-pressed'), 'true');
 const home = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), { url: 'https://example.com/' });
 assert.equal(mountPriceHistory(home.window.document), null);
 assert.equal(home.window.document.querySelector('.popout-tools'), null);
 assert.equal(home.window.document.querySelector('.softbank-tracker').hasAttribute('data-history'), false);
 home.window.close();
});
