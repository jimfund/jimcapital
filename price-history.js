import { formatPrice } from './market-data.js';

const names = { SP500: 'S&P 500 · XYZ', SOFTBANK: 'SoftBank · XYZ', ANTHROPIC: 'Anthropic · MNX', OPENAI: 'OpenAI · MNX', BTC: 'Bitcoin' };
const ns = 'http://www.w3.org/2000/svg';
const date = time => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const instant = time => new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

export function chartGeometry(points, step) {
 const prices = points.map(p => p.price);
 const low = Math.min(...prices), high = Math.max(...prices);
 const padding = (high - low || Math.abs(high) * .01 || 1) * .1;
 const min = low - padding, max = high + padding;
 const start = points[0].time, end = points.at(-1).time;
 const x = time => start === end ? 348 : 12 + (time - start) / (end - start) * 672;
 const y = price => 16 + (max - price) / (max - min) * 210;
 const path = points.map((p, i) => `${!i || p.time - points[i - 1].time > step * 1.5 ? 'M' : 'L'}${x(p.time).toFixed(2)},${y(p.price).toFixed(2)}`).join(' ');
 return { x, y, path, low, high };
}

export function mountPriceHistory(doc = document) {
 const host = doc.querySelector('#graphs-root');
 if (!host) return null;
 const panel = doc.createElement('section');
 panel.className = 'price-history';
 panel.setAttribute('aria-labelledby', 'history-title');
 panel.innerHTML = `
  <div class="history-heading"><h1 id="history-title">Graphs</h1></div>
  <div class="history-controls">
   <label class="history-market">Market<select aria-label="Market">${Object.entries(names).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></label>
   <div class="history-ranges" role="group" aria-label="Time range">
    <button type="button" data-range="1d" aria-label="Past day" aria-pressed="false">1D</button>
    <button type="button" data-range="1w" aria-label="Past week" aria-pressed="true">1W</button>
    <button type="button" data-range="1m" aria-label="Past month" aria-pressed="false">1M</button>
    <button type="button" data-range="1y" aria-label="Past year" aria-pressed="false">1Y</button>
   </div>
  </div>
  <div class="history-readout"><strong class="history-price">—</strong><span class="history-change"></span></div>
  <p class="history-time">Choose a market and time range.</p>
  <div class="history-plot" tabindex="0" role="group" aria-label="Price chart" aria-describedby="history-help" hidden>
   <div class="history-scale"><span class="history-high"></span><span class="history-low"></span></div>
   <svg viewBox="0 0 696 242" role="img" aria-label="Historical prices">
    <path class="history-grid" d="M12 16H684 M12 121H684 M12 226H684"/>
    <path class="history-line"/><g class="history-dots"></g>
    <line class="history-cursor" y1="16" y2="226"/><circle class="history-point" r="4"/>
   </svg>
   <div class="history-dates"><span></span><span></span></div>
  </div>
  <p id="history-help" class="history-help" hidden>Move across the chart or use ← → to inspect a price. Times are local; gaps mean no available candles.</p>
  <div class="history-feedback"><p class="history-status" role="status" aria-live="polite"></p><button type="button" class="history-retry" hidden>Try again</button></div>
  <p class="history-source"></p>`;
 host.append(panel);
 const $ = selector => panel.querySelector(selector);
 const select = $('select'), plot = $('.history-plot'), svg = $('svg');
 const status = $('.history-status'), retry = $('.history-retry');
 let range = '1d', controller, refreshTimer, data, geometry, index = 0, disposed = false;
 const params = new URL(doc.location.href).searchParams;
 select.value = Object.hasOwn(names, params.get('symbol')) ? params.get('symbol') : 'SOFTBANK';
 if (['1d', '1w', '1m', '1y'].includes(params.get('range'))) range = params.get('range');
 function reflectSelection() {
  panel.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === range)));
  const url = new URL(doc.location.href);
  url.searchParams.set('symbol', select.value); url.searchParams.set('range', range);
  doc.defaultView.history.replaceState(null, '', url);
 }

 function inspect(next) {
  if (!data?.points.length) return;
  index = Math.max(0, Math.min(data.points.length - 1, next));
  const point = data.points[index], x = geometry.x(point.time), y = geometry.y(point.price);
  $('.history-price').textContent = formatPrice(point.price, data.unit);
  $('.history-time').textContent = `${instant(point.time)} · ${data.interval} candle`;
  $('.history-cursor').setAttribute('x1', x);
  $('.history-cursor').setAttribute('x2', x);
  $('.history-point').setAttribute('cx', x);
  $('.history-point').setAttribute('cy', y);
  plot.setAttribute('aria-label', `${data.name}: ${formatPrice(point.price, data.unit)}, ${instant(point.time)}. Use arrow keys to inspect prices.`);
 }
 function render() {
  $('.history-source').textContent = data.source;
  if (!data.points.length) {
   plot.hidden = true;
   $('.history-help').hidden = true;
   $('.history-price').textContent = '—';
   $('.history-change').textContent = '';
   status.textContent = data.stale ? 'The feed is unavailable and no saved candles cover this period.' : 'No candles are available for this period. Try a wider range.';
   retry.hidden = !data.stale;
   return;
  }
  geometry = chartGeometry(data.points, data.step);
  const first = data.points[0], last = data.points.at(-1);
  const change = first.price > 0 ? (last.price / first.price - 1) * 100 : null;
  $('.history-change').textContent = change === null ? '' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}% over shown history`;
  $('.history-change').dataset.direction = change < 0 ? 'down' : 'up';
  $('.history-line').setAttribute('d', geometry.path);
  $('.history-dots').replaceChildren();
  // Isolated candles on either side of gaps remain visible.
  data.points.forEach((point, i) => {
   if ((!i || point.time - data.points[i - 1].time > data.step * 1.5) && (i === data.points.length - 1 || data.points[i + 1].time - point.time > data.step * 1.5)) {
    const dot = doc.createElementNS(ns, 'circle');
    dot.setAttribute('cx', geometry.x(point.time)); dot.setAttribute('cy', geometry.y(point.price)); dot.setAttribute('r', '2.5');
    $('.history-dots').append(dot);
   }
  });
  $('.history-high').textContent = formatPrice(geometry.high, data.unit);
  $('.history-low').textContent = formatPrice(geometry.low, data.unit);
  const dates = panel.querySelectorAll('.history-dates span');
  dates[0].textContent = data.range === '1d' ? instant(first.time) : date(first.time);
  dates[1].textContent = data.range === '1d' ? instant(last.time) : date(last.time);
  svg.setAttribute('aria-label', `${data.name}, ${data.points.length} ${data.interval} candles, ${date(first.time)} to ${date(last.time)}. Low ${formatPrice(geometry.low, data.unit)}, high ${formatPrice(geometry.high, data.unit)}.`);
  plot.hidden = false;
  $('.history-help').hidden = false;
  inspect(data.points.length - 1);
  status.textContent = `${data.stale ? 'Saved history · feed temporarily unavailable. ' : ''}${data.partial ? 'Only part of the requested period could be loaded. ' : ''}Available history: ${date(first.time)} – ${date(last.time)}. Updated ${instant(data.updatedAt)}.`;
  retry.hidden = !(data.stale || data.partial);
 }
 async function load(quiet = false) {
  controller?.abort();
  clearTimeout(refreshTimer);
  const request = controller = new AbortController();
  const timeout = setTimeout(() => request.abort(), 20000);
  panel.setAttribute('aria-busy', 'true');
  retry.hidden = true;
  if (!quiet) {
   data = null;
   plot.hidden = true;
   $('.history-help').hidden = true;
   $('.history-price').textContent = '—';
   $('.history-change').textContent = '';
   $('.history-source').textContent = '';
   $('.history-time').textContent = names[select.value];
  }
  status.textContent = 'Loading price history…';
  try {
   const response = await fetch(`/api/markets/history?${new URLSearchParams({ symbol: select.value, range })}`, { signal: request.signal, cache: 'no-store' });
   if (!response.ok) throw new Error('History unavailable');
   const result = await response.json();
   if (controller !== request || disposed) return;
   if (!Array.isArray(result.points)) throw new Error('Invalid history');
   data = result;
   render();
  } catch {
   if (controller !== request || disposed) return;
   status.textContent = data?.points.length ? 'Showing previously loaded history. The latest update could not be loaded.' : 'Price history could not be loaded. Please try again.';
   retry.hidden = false;
  } finally {
   clearTimeout(timeout);
   if (controller === request) {
    panel.setAttribute('aria-busy', 'false');
    if (!disposed) refreshTimer = setTimeout(() => { if (!doc.hidden) load(true); }, 60000);
   }
  }
 }
 select.addEventListener('change', () => { reflectSelection(); load(); });
 panel.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
  range = button.dataset.range;
  reflectSelection();
  load();
 }));
 retry.addEventListener('click', () => load(!!data));
 plot.addEventListener('keydown', event => {
  if (!data?.points.length) return;
  const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: data.points.length - 1 }[event.key];
  if (next !== undefined) { event.preventDefault(); inspect(next); }
 });
 svg.addEventListener('pointermove', event => {
  if (!data?.points.length) return;
  const box = svg.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width * 696;
  let nearest = 0;
  data.points.forEach((p, i) => { if (Math.abs(geometry.x(p.time) - x) < Math.abs(geometry.x(data.points[nearest].time) - x)) nearest = i; });
  inspect(nearest);
 });
 const resume = () => { if (!disposed && !doc.hidden) load(true); };
 doc.addEventListener('visibilitychange', resume);
 reflectSelection();
 load();
 return { element: panel, destroy() {
  disposed = true; controller?.abort(); controller = null;
  clearTimeout(refreshTimer); doc.removeEventListener('visibilitychange', resume);
  panel.remove();
 } };
}
if (typeof document !== 'undefined' && document.querySelector('#graphs-root')) mountPriceHistory();
