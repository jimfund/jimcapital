import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMarketStatus } from '../market-clock-status.js';
import { marketSessions, dialMinutes } from '../market-clock-time.js';

const calendar = JSON.parse(await readFile(new URL('../assets/market-calendar.json', import.meta.url)));
const status = createMarketStatus(calendar);
const at = (date, market = 'US') => status(new Date(date)).find(row => row.key === market);

test('NYSE opens and closes at the exact cash session boundaries', () => {
  assert.equal(at('2026-09-29T13:29:59Z').phase, 'closed');
  assert.equal(at('2026-09-29T13:30:00Z').phase, 'open');
  assert.equal(at('2026-09-29T19:59:59Z').phase, 'open');
  assert.equal(at('2026-09-29T20:00:00Z').phase, 'closed');
});
test('Japan pauses at lunch, resumes, and closes at 15:30 Tokyo', () => {
  assert.equal(at('2026-07-17T02:29:59Z', 'JP').phase, 'open');
  assert.equal(at('2026-07-17T02:30:00Z', 'JP').phase, 'break');
  assert.equal(at('2026-07-17T03:00:00Z', 'JP').text, 'Break - reopen in 30m');
  assert.equal(at('2026-07-17T03:30:00Z', 'JP').phase, 'open');
  assert.equal(at('2026-07-17T06:30:00Z', 'JP').phase, 'closed');
});
test('holidays, weekends, and early closes match the shared calendar', () => {
  assert.equal(at('2026-12-25T16:00:00Z').phase, 'holiday');
  assert.equal(at('2026-09-26T16:00:00Z').phase, 'closed');
  assert.equal(at('2026-11-27T17:59:00Z').text, 'Open - early close in 1m');
  assert.equal(at('2026-11-27T18:00:00Z').phase, 'closed');
  assert.equal(at('2026-01-01T01:00:00Z', 'JP').phase, 'holiday');
});
test('both US DST changes preserve NY opening time and Pacific dial alignment', () => {
  for (const date of ['2026-03-06T14:30:00Z', '2026-03-09T13:30:00Z', '2026-10-30T13:30:00Z', '2026-11-02T14:30:00Z']) {
    assert.equal(at(date).phase, 'open');
    assert.equal(at(date).localTime, '09:30');
    assert.equal(dialMinutes(new Date(date)), 390);
  }
  assert.deepEqual(marketSessions(new Date('2026-07-17T12:00:00Z')).japan, [[1020, 1170], [1230, 1410]]);
  assert.deepEqual(marketSessions(new Date('2026-01-17T12:00:00Z')).japan, [[960, 1110], [1170, 1350]]);
});
test('projected dates are qualified and expired calendars never claim a market is open', () => {
  assert.equal(at('2029-07-03T14:00:00Z').confidence, 'projected');
  assert.match(at('2029-07-03T14:00:00Z').text, /^Open\?/);
  for (const row of status(new Date('2037-01-05T15:00:00Z'))) {
    assert.equal(row.phase, 'unknown');
    assert.equal(row.isOpen, false);
    assert.equal(row.eventTime, null);
  }
});

test('reverse readout counts down to closing while open and opening while closed', () => {
  const open = at('2026-09-29T14:30:00Z');
  assert.equal(open.countdownLabel, 'US CLOSES IN');
  assert.equal(open.countdown, '5h 30m');
  const closed = at('2026-09-29T13:00:00Z');
  assert.equal(closed.countdownLabel, 'US OPENS IN');
  assert.equal(closed.countdown, '30m');
  const lunch = at('2026-07-17T03:00:00Z', 'JP');
  assert.equal(lunch.countdownLabel, 'JP OPENS IN');
  assert.equal(lunch.countdown, '30m');
  assert.equal(at('2026-11-27T17:59:00Z').countdown, '1m');
  const weekend = at('2026-09-25T20:00:00Z');
  assert.equal(weekend.countdownLabel, 'US OPENS IN');
  assert.equal(weekend.countdown, '65h 30m');
  assert.equal(at('2037-01-05T15:00:00Z').countdown, 'UNKNOWN');
});
