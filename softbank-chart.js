import { subscribeQuotes, formatPrice, readMarketSnapshot } from './market-data.js';

const DAY = 86400000, NS = 'http://www.w3.org/2000/svg';
const chartLabel = 'SoftBank 9984, past 24 hours. Move across the graph or use arrow keys to inspect prices in yen.';
export function timeAgo(time, now = Date.now()) {
 const minutes = Math.max(0, Math.floor((now - time) / 60000));
 if (minutes < 1) return 'just now';
 if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
 const hours = Math.floor(minutes / 60);
 if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
 const days = Math.floor(hours / 24);
 return `${days} day${days === 1 ? '' : 's'} ago`;
}
export function softbankGeometry(history) {
 const from = history.to - DAY;
 const points = history.points.filter(p => p.time >= from && p.time <= history.to && Number.isFinite(p.price));
 if (!points.length) return null;
 const prices = points.map(p => p.price), low = Math.min(...prices), high = Math.max(...prices);
 const padding = (high - low || Math.abs(high) * .01 || 1) * .025;
 const x = time => 5 + (time - from) / DAY * 290;
 const y = price => 6 + (high + padding - price) / (high - low + padding * 2) * 208;
 const path = points.map((p, i) => `${!i || p.time - points[i - 1].time > history.step * 1.5 ? 'M' : 'L'}${x(p.time).toFixed(2)},${y(p.price).toFixed(2)}`).join(' ');
 const first = points[0].price, last = points.at(-1).price;
 return { points, x, y, path, direction: last > first ? 'up' : last < first ? 'down' : 'flat', change: first > 0 ? (last / first - 1) * 100 : null };
}
export function nearestPoint(points, time) {
 let closest = 0;
 points.forEach((p, i) => { if (Math.abs(p.time - time) < Math.abs(points[closest].time - time)) closest = i; });
 return closest;
}

export function mountSoftbankChart(root, { doc = document, subscribe = subscribeQuotes, fetcher = fetch, initial = readMarketSnapshot(doc).softbank } = {}) {
 const output = root.querySelector('#softbank-price');
 const svg = doc.createElementNS(NS, 'svg');
 svg.classList.add('softbank-plot');
 svg.setAttribute('viewBox', '0 0 300 220');
 svg.setAttribute('tabindex', '0');
 svg.setAttribute('role', 'slider');
 svg.setAttribute('aria-label', chartLabel);
 svg.setAttribute('aria-orientation', 'horizontal');
 svg.setAttribute('aria-describedby', 'softbank-chart-description');
 svg.setAttribute('aria-disabled', 'true');
 svg.setAttribute('aria-valuemin', '0'); svg.setAttribute('aria-valuemax', '0'); svg.setAttribute('aria-valuenow', '0');
 svg.innerHTML = `<defs><filter id="softbank-pen" x="-5%" y="-10%" width="110%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".065" numOctaves="2" seed="8" result="grain"/><feDisplacementMap in="SourceGraphic" in2="grain" scale=".65" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
  <path class="softbank-line" filter="url(#softbank-pen)"/><g class="softbank-dots"></g>
  <line class="softbank-cursor" y1="4" y2="216" hidden/><circle class="softbank-point" r="4.5" hidden/>
  <text class="softbank-message" x="150" y="110" text-anchor="middle"></text>`;
 root.prepend(svg);
 const time = doc.createElement('time'); time.className = 'softbank-time'; root.append(time);
 const description = doc.createElement('span');
 description.id = 'softbank-chart-description'; description.className = 'softbank-description';
 description.textContent = 'XYZ perpetual trade closes converted to estimated yen using matching USD/JPY candles. Green means up over the shown 24 hours; red means down. Missing candles remain gaps. The resting value uses the latest mark price.';
 root.append(description);
 const $ = selector => svg.querySelector(selector);
 let data, geometry, quote, timer, controller, disposed = false, inFlight = false, selectedTime = null, index = 0;
 const editing = () => doc.body.classList.contains('editing') || new URL(doc.location.href).searchParams.get('edit') === '1';
 function rest() {
  selectedTime = null;
  $('.softbank-cursor').setAttribute('hidden', ''); $('.softbank-point').setAttribute('hidden', '');
  output.textContent = formatPrice(quote?.price ?? geometry?.points.at(-1)?.price, 'points');
  output.dataset.state = quote ? (quote.stale ? 'stale' : 'live') : data?.stale ? 'stale' : 'live';
  time.textContent = '';
  const asOf = quote?.asOf ?? geometry?.points.at(-1)?.time;
  output.title = asOf ? `${data?.stale || quote?.stale ? 'Saved price' : 'Latest price'} · ${new Date(asOf).toLocaleString()}` : '';
  time.removeAttribute('datetime'); time.removeAttribute('title');
 }
 function inspect(next) {
  if (!geometry || editing()) return;
  index = Math.max(0, Math.min(geometry.points.length - 1, next));
  const p = geometry.points[index]; selectedTime = p.time;
  output.textContent = formatPrice(p.price, 'points'); output.dataset.state = data.stale ? 'stale' : 'live';
  time.textContent = timeAgo(p.time);
  time.dateTime = new Date(p.time).toISOString(); time.title = new Date(p.time).toLocaleString();
  const x = geometry.x(p.time), y = geometry.y(p.price);
  const cursor = $('.softbank-cursor'), point = $('.softbank-point');
  cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.removeAttribute('hidden');
  point.setAttribute('cx', x); point.setAttribute('cy', y); point.removeAttribute('hidden');
  svg.setAttribute('aria-valuenow', index);
  svg.setAttribute('aria-valuetext', `${formatPrice(p.price, 'JPY')}, ${new Date(p.time).toLocaleString()}, ${geometry.direction} over shown history${data.stale ? ', saved history' : ''}`);
 }
 function render() {
  geometry = softbankGeometry(data);
  root.dataset.direction = geometry?.direction || 'flat';
  svg.dataset.stale = String(data.stale);
  $('.softbank-line').setAttribute('d', geometry?.path || '');
  $('.softbank-dots').replaceChildren();
  $('.softbank-message').textContent = '';
  svg.setAttribute('aria-disabled', String(!geometry));
  if (geometry) {
   svg.setAttribute('aria-label', chartLabel);
   svg.setAttribute('aria-valuemin', '0'); svg.setAttribute('aria-valuemax', geometry.points.length - 1);
   geometry.points.forEach((p, i) => {
    if ((!i || p.time - geometry.points[i - 1].time > data.step * 1.5) && (i === geometry.points.length - 1 || geometry.points[i + 1].time - p.time > data.step * 1.5)) {
     const dot = doc.createElementNS(NS, 'circle'); dot.setAttribute('cx', geometry.x(p.time)); dot.setAttribute('cy', geometry.y(p.price)); dot.setAttribute('r', '2.5'); $('.softbank-dots').append(dot);
    }
   });
   inspect(selectedTime === null ? geometry.points.length - 1 : nearestPoint(geometry.points, selectedTime));
  }
 }
 async function refresh() {
  clearTimeout(timer);
  if (disposed || doc.hidden || inFlight) return;
  inFlight = true;
  controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
   const response = await fetcher('/api/markets/history?symbol=SOFTBANK&range=1d', { signal: controller.signal, cache: 'no-store' });
   if (!response.ok) throw new Error('History unavailable');
   const result = await response.json();
   if (disposed) return;
   if (!validHistory(result) || !softbankGeometry(result)) throw new Error('History unavailable');
   const wasInspecting = selectedTime !== null;
   data = result; render();
   if (!wasInspecting) rest();
  } catch {
   if (disposed) return;
   if (data) { data = { ...data, stale: true }; const wasInspecting = selectedTime !== null; render(); if (!wasInspecting) rest(); }
   else { svg.setAttribute('aria-label', 'SoftBank history unavailable. Press Enter or tap to retry.'); }
  } finally {
   clearTimeout(timeout); inFlight = false;
   if (!disposed && !doc.hidden) timer = setTimeout(refresh, data && !data.stale ? 60000 : 5000);
  }
 }
 function move(event) {
  if (!geometry || editing()) return;
  const box = svg.getBoundingClientRect();
  if (!box.width) return;
  const x = (event.clientX - box.left) / box.width * 300;
  inspect(nearestPoint(geometry.points, data.to - DAY + (x - 5) / 290 * DAY));
 }
 svg.addEventListener('pointermove', move);
 svg.addEventListener('pointerdown', event => { if (!geometry) refresh(); else move(event); });
 svg.addEventListener('pointerleave', () => { if (doc.activeElement !== svg) rest(); });
 svg.addEventListener('focus', () => { if (geometry) inspect(geometry.points.length - 1); });
 svg.addEventListener('blur', rest);
 svg.addEventListener('keydown', event => {
  if (editing()) return;
  if (!geometry) { if (event.key === 'Enter') refresh(); return; }
  const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: geometry.points.length - 1 }[event.key];
  if (next !== undefined) { event.preventDefault(); inspect(next); }
 });
 const visibility = () => { clearTimeout(timer); if (!doc.hidden) refresh(); };
 doc.addEventListener('visibilitychange', visibility);
 doc.defaultView?.addEventListener('online', refresh);
 function validHistory(value) {
  return value?.symbol === 'SOFTBANK' && Array.isArray(value.points) && Number.isFinite(value.to) && Number.isFinite(value.step) && value.step > 0
   && value.points.every(p => Number.isFinite(p?.time) && Number.isFinite(p?.price) && p.price > 0);
 }
 if (validHistory(initial) && softbankGeometry(initial)) { data = initial; render(); rest(); }
 const unsubscribe = subscribe(quotes => { quote = quotes.SOFTBANK || quote; if (selectedTime === null) rest(); });
 refresh();
 return { refresh, destroy() { disposed = true; clearTimeout(timer); controller?.abort(); unsubscribe(); doc.removeEventListener('visibilitychange', visibility); doc.defaultView?.removeEventListener('online', refresh); svg.remove(); time.remove(); description.remove(); } };
}
if (typeof document !== 'undefined') {
 const root = document.querySelector('.softbank-tracker');
 if (root) mountSoftbankChart(root);
}
