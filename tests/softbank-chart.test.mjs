import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { softbankGeometry, nearestPoint, mountSoftbankChart, timeAgo } from '../softbank-chart.js';
import { historyUrl } from '../history-navigation.js';

const DAY = 86400000, STEP = 300000, NOW = Date.parse('2026-10-02T00:00:00Z');
const sample = { symbol: 'SOFTBANK', to: NOW, step: STEP, stale: false, points: Array.from({ length: 289 }, (_, i) => ({ time: NOW - DAY + i * STEP, price: 6000 + i })) };
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(t, fetcher = async () => Response.json(sample), initial) {
 t.mock.method(Date, 'now', () => NOW);
 const dom = new JSDOM('<section class="softbank-tracker"><output id="softbank-price">—</output></section>', { url: 'https://example.com/', pretendToBeVisual: true });
 const doc = dom.window.document, root = doc.querySelector('section');
 let listener;
 const chart = mountSoftbankChart(root, { doc, fetcher, initial, subscribe(fn) { listener = fn; fn({ SOFTBANK: { price: 6385.83, asOf: NOW, stale: false } }); return () => {}; } });
 const svg = root.querySelector('svg');
 // Matches the board's transformed on-screen width rather than native SVG width.
 svg.getBoundingClientRect = () => ({ left: 100, width: 145, top: 120, height: 48 });
 t.after(() => { chart.destroy(); dom.window.close(); });
 return { dom, doc, root, svg, chart, quote: listener, price: () => root.querySelector('output').textContent };
}
test('TV chart represents precisely the past day, preserves real gaps, and colours total movement', () => {
 const extra = { time: NOW - DAY - STEP, price: 1 };
 const graph = softbankGeometry({ ...sample, points: [extra, ...sample.points] });
 assert.equal(graph.points.length, 289); assert.equal(graph.direction, 'up');
 assert.equal(graph.x(NOW - DAY), 5); assert.equal(graph.x(NOW), 295);
 assert.equal(softbankGeometry({ ...sample, points: sample.points.map(p => ({ ...p, price: 13000 - p.price })) }).direction, 'down');
 const flat = softbankGeometry({ ...sample, points: sample.points.map(p => ({ ...p, price: 6000 })) });
 assert.equal(flat.direction, 'flat'); assert.ok(!/NaN|Infinity/.test(flat.path));
 const gaps = softbankGeometry({ ...sample, points: [sample.points[0], sample.points[1], sample.points[10]] });
 assert.equal((gaps.path.match(/M/g) || []).length, 2);
 assert.equal(nearestPoint(sample.points, NOW - DAY / 2), 144);
 assert.equal(softbankGeometry({ ...sample, points: [extra] }), null);
});
test('moving along the scaled TV shows the corresponding historical value and time, then restores the live readout', async t => {
 const { root, dom, svg, price, quote } = setup(t); await settle();
 assert.equal(root.dataset.direction, 'up'); assert.equal(price(), '6,385.83');
 svg.dispatchEvent(new dom.window.MouseEvent('pointermove', { clientX: 172.5 }));
 assert.equal(price(), '6,144.00');
 assert.equal(root.querySelector('time').dateTime, new Date(NOW - DAY / 2).toISOString());
 assert.equal(root.querySelector('time').textContent, '12 hours ago');
 assert.equal(timeAgo(NOW - 300000, NOW), '5 mins ago');
 assert.equal(timeAgo(NOW - 60000, NOW), '1 min ago');
 assert.equal(timeAgo(NOW, NOW), 'just now');
 assert.match(svg.getAttribute('aria-valuetext'), /6,144.00/);
 quote({ SOFTBANK: { price: 6400, stale: false } }); assert.equal(price(), '6,144.00');
 svg.dispatchEvent(new dom.window.MouseEvent('pointerleave'));
 assert.equal(price(), '6,400.00'); assert.equal(root.querySelector('time').textContent, '');
});
test('keyboard and touch inspection reach both ends; refresh preserves the inspected timestamp', async t => {
 const { dom, root, svg, chart, price } = setup(t); await settle();
 svg.focus();
 svg.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
 assert.equal(price(), '6,000.00');
 svg.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
 assert.equal(price(), '6,001.00');
 await chart.refresh(); assert.equal(price(), '6,001.00');
 svg.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
 assert.equal(price(), '6,288.00');
 svg.dispatchEvent(new dom.window.MouseEvent('pointerdown', { clientX: 172.5 }));
 assert.equal(price(), '6,144.00'); assert.equal(root.querySelector('time').dateTime, new Date(NOW - DAY / 2).toISOString());
});
test('failed refresh preserves the drawn history and labels saved values; a cold failure can be retried', async t => {
 let calls = 0;
 const { root, svg, chart } = setup(t, async () => ++calls === 1 ? Response.json(sample) : new Response('', { status: 503 }));
 await settle(); const path = root.querySelector('.softbank-line').getAttribute('d');
 await chart.refresh();
 assert.equal(root.querySelector('.softbank-line').getAttribute('d'), path);
 assert.equal(svg.dataset.stale, 'true'); assert.match(root.querySelector('output').title, /Saved price/);
 assert.equal(root.querySelector('time').textContent, '');
 let coldCalls = 0;
 const cold = setup(t, async () => ++coldCalls === 1 ? new Response('', { status: 503 }) : Response.json(sample)); await settle();
 assert.equal(cold.svg.getAttribute('aria-disabled'), 'true');
 assert.equal(cold.root.querySelector('.softbank-message').textContent, '');
 assert.match(cold.svg.getAttribute('aria-label'), /unavailable/);
 await cold.chart.refresh();
 assert.equal(cold.svg.getAttribute('aria-disabled'), 'false');
 assert.ok(!cold.svg.getAttribute('aria-label').includes('unavailable'));
});
test('the server snapshot draws immediately and survives slow, empty and malformed refreshes without a loading overlay', async t => {
 let resolve;
 const { root, chart, svg, quote, price } = setup(t, () => new Promise(done => { resolve = done; }), sample);
 const path = root.querySelector('.softbank-line').getAttribute('d');
 assert.ok(path); assert.equal(svg.getAttribute('aria-disabled'), 'false');
 assert.equal(price(), '6,385.83'); assert.equal(root.querySelector('.softbank-message').textContent, '');
 quote({ SOFTBANK: null }); assert.equal(price(), '6,385.83');
 resolve(Response.json({ ...sample, points: [] })); await settle();
 assert.equal(root.querySelector('.softbank-line').getAttribute('d'), path);
 const refresh = chart.refresh(); resolve(Response.json({ ...sample, points: [{ time: NOW, price: null }] })); await refresh;
 assert.equal(root.querySelector('.softbank-line').getAttribute('d'), path);
 assert.equal(price(), '6,385.83'); assert.equal(root.querySelector('.softbank-message').textContent, '');
});
test('editing the board cannot inspect or navigate from the TV; full graph links encode the market', async t => {
 const { dom, doc, svg, price } = setup(t); await settle();
 doc.body.classList.add('editing');
 svg.dispatchEvent(new dom.window.MouseEvent('pointermove', { clientX: 100 }));
 assert.equal(price(), '6,385.83');
 assert.equal(historyUrl('SOFTBANK'), '/graphs?symbol=SOFTBANK&range=1d');
});
