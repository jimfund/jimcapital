export const PACIFIC = 'America/Los_Angeles';
const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function pacificParts(date) {
  return Object.fromEntries(partsFormatter.formatToParts(date)
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

export function dialMinutes(date) {
  const { hour, minute, second } = pacificParts(date);
  return hour * 60 + minute + second / 60;
}

// Regular cash-equity sessions; these are a daily hours guide, not a holiday calendar.
// NYSE: https://www.nyse.com/markets/hours-calendars
// TSE: https://www.jpx.co.jp/english/equities/trading/domestic/01.html
export function marketSessions(date) {
  const { year, month, day } = pacificParts(date);
  // U.S. exchanges and San Francisco change DST together: 09:30–16:00 ET.
  const us = [[390, 780]];
  // 09:00 JST is 00:00 UTC on the next date after the Pacific evening.
  // Convert the actual session instants so Japan's arcs shift with Pacific DST,
  // including on the day the clocks change.
  const tokyoOpen = Date.UTC(year, month - 1, day + 1);
  const minuteAt = offset => dialMinutes(new Date(tokyoOpen + offset * 60_000));
  const japan = [[minuteAt(0), minuteAt(150)], [minuteAt(210), minuteAt(390)]];
  return { us, japan };
}

export function formatMinutes(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
