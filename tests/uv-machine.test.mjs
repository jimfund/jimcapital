import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { currentUV, renderUV, startUV } from '../uv-machine.js';
import { isLayout, defaultPosition } from '../layout-model.js';

const now = Date.parse('2026-10-02T21:15:00Z'); // 2:15 pm in East Palo Alto
const row = (value, time = 'Oct/02/2026 02 PM') => ({ ZIP: '94303', DATE_TIME: time, UV_VALUE: value });
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const fixture = () => new JSDOM(html).window.document.querySelector('.uv-machine');

test('uses the current LA hour and date, ignoring previous-day rows and ORDER', () => {
  assert.equal(currentUV([row(0, 'Oct/01/2026 02 PM'), row(4), row(0, 'Oct/02/2026 03 PM')], now, now), 4);
  assert.equal(currentUV([row(0, 'Oct/01/2026 02 PM')], now, now), null);
  assert.equal(currentUV([row(0, 'Oct/02/2026 12 AM')], Date.parse('2026-10-02T07:00:00Z'), Date.parse('2026-10-02T07:00:00Z')), 0);
  const winter = Date.parse('2026-12-02T22:00:00Z');
  assert.equal(currentUV([row(3, 'Dec/02/2026 02 PM')], winter, winter), 3);
});

test('missing, malformed and stale data cannot appear as low UV', () => {
  for (const value of [null, '', '0', -1, NaN, Infinity, undefined]) assert.equal(currentUV([row(value)], now, now), null);
  assert.equal(currentUV([row(0)], now - 30 * 60_000, now), null);
  assert.equal(currentUV([row(0)], now + 1, now), null);
  assert.equal(currentUV([row(0)], NaN, now), null);
  assert.equal(currentUV([], now, now), null);
  assert.equal(currentUV({}, now, now), null);
  assert.equal(currentUV([{ ...row(0), ZIP: '94301' }], now, now), null);
  assert.equal(currentUV([row(0, 'Oct/02/2026 14 PM')], now, now), null);
  assert.equal(currentUV([row(2), row(4)], now, now), 4);
});

test('the warning starts at exactly 3 and unknown removes the reading and needle', () => {
  const root = fixture();
  for (const [value, state, message] of [[0, 'low', 'BELOW LIMIT'], [2.9, 'low', 'BELOW LIMIT'], [3, 'warning', 'DON’T GO OUTSIDE'], [11, 'warning', 'DON’T GO OUTSIDE'], [null, 'unknown', 'UNKNOWN']]) {
    renderUV(root, value, now);
    assert.equal(root.dataset.state, state);
    assert.equal(root.querySelector('.uv-status').textContent, message);
    assert.equal(root.querySelector('.uv-needle').hidden, value === null);
    assert.equal(root.querySelector('.uv-value').textContent, value === null ? '—' : String(value));
  }
  assert.equal(root.querySelector('[title], svg title'), null);
});

test('network failure clears a reading and an hour change cannot retain the previous hour', async () => {
  const root = fixture();
  let clock = now, interval, calls = 0;
  const timers = { setTimeout: () => 1, clearTimeout() {}, setInterval(fn) { interval = fn; return 2; }, clearInterval() {} };
  const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const stop = startUV(root, { now: () => clock, doc, timers, fetchImpl: async () => {
    calls++;
    if (calls > 1) throw new Error('offline');
    return { ok: true, json: async () => [row(2)] };
  } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.dataset.state, 'low');
  clock += 15 * 60_000;
  interval();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.dataset.state, 'unknown');
  assert.equal(currentUV([row(2)], Date.parse('2026-10-02T21:59:00Z'), Date.parse('2026-10-02T22:00:00Z')), null);
  stop();
});

test('the saved scene and default position accept the new machine', () => {
  const layout = JSON.parse(readFileSync(new URL('../assets/layout.json', import.meta.url), 'utf8'));
  layout.items['uv-machine'] = defaultPosition('uv-machine');
  assert.equal(isLayout(layout), true);
});
