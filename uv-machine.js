export const UV_ENDPOINT = 'https://data.epa.gov/dmapservice/getEnvirofactsUVHOURLY/ZIP/94303/JSON';
const ZONE = 'America/Los_Angeles';
const MAX_AGE = 30 * 60_000;
const REFRESH = 15 * 60_000;
const localHour = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
const hourLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', timeZoneName: 'short',
});
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// EPA timestamps are local wall-clock hours, not UTC. Never parse them using
// the visitor's time zone, or assume every row belongs to the same date.
function forecastKey(value) {
  const match = /^(\w{3})\/(\d{2})\/(\d{4}) (\d{2}) (AM|PM)$/.exec(value);
  if (!match) return null;
  const [, month, day, year, hour, period] = match;
  const m = months.indexOf(month) + 1;
  const date = new Date(Date.UTC(+year, m - 1, +day));
  if (!m || +hour < 1 || +hour > 12 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== +day) return null;
  return `${year}-${String(m).padStart(2, '0')}-${day}-${String(+hour % 12 + (period === 'PM' ? 12 : 0)).padStart(2, '0')}`;
}

export function currentUV(rows, fetchedAt, now = Date.now()) {
  if (!Array.isArray(rows) || !Number.isFinite(fetchedAt) || now < fetchedAt || now - fetchedAt >= MAX_AGE) return null;
  const p = Object.fromEntries(localHour.formatToParts(now).map(part => [part.type, part.value]));
  const key = `${p.year}-${p.month}-${p.day}-${p.hour}`;
  const values = rows.filter(row => row && String(row.ZIP) === '94303' && forecastKey(row.DATE_TIME) === key)
    .map(row => row.UV_VALUE);
  if (!values.length || values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return null;
  // Conflicting duplicate hours cannot lower the warning.
  return Math.max(...values);
}

export function renderUV(root, value, now = Date.now()) {
  const known = value !== null;
  root.dataset.state = known ? value >= 3 ? 'warning' : 'low' : 'unknown';
  root.querySelector('.uv-value').textContent = known ? String(value) : '—';
  root.querySelector('.uv-status').textContent = known ? value >= 3 ? 'DON’T GO OUTSIDE' : 'BELOW YOUR LIMIT' : 'UNKNOWN';
  root.querySelector('.uv-time').textContent = known ? `Forecast · ${hourLabel.format(now)}` : 'No current hourly forecast. Check EPA before going out.';
  const needle = root.querySelector('.uv-needle');
  needle.hidden = !known;
  root.style.setProperty('--uv-position', `${known ? Math.min(value / 11, 1) * 100 : 0}%`);
}

export function startUV(root, { fetchImpl = globalThis.fetch, now = Date.now, doc = root.ownerDocument, timers = globalThis } = {}) {
  let rows = null, fetchedAt = NaN, lastAttempt = -Infinity, pending = false, stopped = false, controller;
  const render = () => renderUV(root, currentUV(rows, fetchedAt, now()), now());
  async function refresh() {
    if (pending || stopped) return;
    pending = true;
    lastAttempt = now();
    controller = new AbortController();
    const timeout = timers.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(UV_ENDPOINT, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('EPA unavailable');
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid EPA response');
      rows = data;
      fetchedAt = now();
    } catch {
      rows = null;
      fetchedAt = NaN;
    } finally {
      timers.clearTimeout(timeout);
      pending = false;
      if (!stopped) render();
    }
  }
  function tick() {
    if (doc.hidden || stopped) return;
    render();
    if (now() - lastAttempt >= REFRESH) void refresh();
  }
  const interval = timers.setInterval(tick, 60_000);
  doc.addEventListener('visibilitychange', tick);
  void refresh();
  return () => { stopped = true; controller?.abort(); timers.clearInterval(interval); doc.removeEventListener('visibilitychange', tick); };
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('.uv-machine');
  if (root) startUV(root);
}
