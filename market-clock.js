import { attachClockPhysics } from './market-clock-physics.js';
import { createMarketStatus } from './market-clock-status.js';
import { pacificParts, dialMinutes, marketSessions, formatMinutes } from './market-clock-time.js';

const clock = document.querySelector('.market-clock');
const marker = clock.querySelector('#clock-marker');
const sessions = clock.querySelector('#clock-sessions');
const spinButton = clock.querySelector('.clock-spin');
const dial = clock.querySelector('.clock-dial');
let sculpture;
let rotation = 0;
let getStatus;
let calendarFailed = false;
const reverse = document.createElement('span');
reverse.className = 'clock-reverse';
reverse.setAttribute('aria-hidden', 'true');
spinButton.append(reverse);
const rotationLabel = 'Click to spin to the other face. Drag left or right to turn the market clock over. Enter or Space flips; arrow keys rotate; Home returns to the front.';
function renderRotation() {
  dial.style.transform = `rotateX(${rotation}deg)`;
  reverse.style.transform = `rotateX(${rotation + 180}deg)`;
  spinButton.classList.toggle('is-reversed', Math.cos(rotation * Math.PI / 180) < 0);
  sculpture?.rotate(rotation);
}
fetch('./assets/market-calendar.json')
  .then(response => { if (!response.ok) throw new Error('Calendar unavailable'); return response.json(); })
  .then(calendar => { getStatus = createMarketStatus(calendar); update(); })
  .catch(() => { calendarFailed = true; update(); });
import('./market-clock-3d.js').then(({ createClock3D }) => {
  try {
    sculpture = createClock3D(spinButton, { displayStyle: new URLSearchParams(location.search).get('clock-style') || 'marble-flap' });
    renderRotation(); update();
  } catch (error) {
    // Retain the SVG and readable reverse if WebGL is unavailable.
    spinButton.querySelector('.clock-sculpture')?.remove();
    spinButton.classList.remove('is-3d');
    console.warn('Market clock using its flat fallback.', error);
  }
}).catch(error => console.warn('Market clock using its flat fallback.', error));
const editing = new URLSearchParams(location.search).get('edit') === '1'
  && ['localhost', '127.0.0.1'].includes(location.hostname);
if (editing) {
  spinButton.tabIndex = -1;
} else {
  attachClockPhysics(spinButton, () => rotation, angle => {
    rotation = angle;
    renderRotation();
  });
}
// A 12-unit equilateral triangle centered on its centroid, pointing upward.
const triangleRadius = 12 / Math.sqrt(3);
marker.setAttribute('points', `0,${-triangleRadius} 6,${triangleRadius / 2} -6,${triangleRadius / 2}`);

function svgElement(name, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function point(minutes, radius) {
  const angle = minutes / 1440 * Math.PI * 2 - Math.PI / 2;
  return [130 + Math.cos(angle) * radius, 130 + Math.sin(angle) * radius];
}

let dayKey;
function update() {
  const now = new Date();
  const minutes = dialMinutes(now);
  const rows = getStatus?.(now) || (calendarFailed ? ['US', 'JP'].map(key => ({
    key, phase: 'unknown', confidence: 'unknown', text: 'Calendar unavailable', localTime: '--:--',
  })) : null);
  const windows = marketSessions(now);
  sculpture?.update(minutes, [...windows.us, ...windows.japan], rows);
  const statusText = rows?.map(row => `${row.key} ${row.localTime}: ${row.text}`).join('. ')
    || 'Checking market calendar';
  spinButton.setAttribute('aria-label', `${rotationLabel} ${statusText}`);
  spinButton.title = statusText;
  reverse.replaceChildren(...(rows || [{ key: 'US', text: 'Checking…' }, { key: 'JP', text: 'Checking…' }]).map(row => {
    const line = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = row.countdownLabel || row.key;
    const status = document.createElement('span');
    status.textContent = row.countdown || (row.phase === 'unknown' ? 'UNKNOWN' : '…');
    line.append(title, status);
    return line;
  }));
  const [x, y] = point(minutes, 79);
  marker.setAttribute('transform', `translate(${x} ${y}) rotate(${minutes / 4})`);
  const { year, month, day } = pacificParts(now);
  const nextDayKey = `${year}-${month}-${day}`;
  if (nextDayKey === dayKey) return;
  dayKey = nextDayKey;
  const { us, japan } = marketSessions(now);
  sessions.replaceChildren();
  for (const [name, windows, radius] of [['us', us, 106], ['jp', japan, 106]]) {
    for (const [start, end] of windows) {
      const [x1, y1] = point(start, radius);
      const [x2, y2] = point(end, radius);
      const arc = svgElement('path', {
        class: `clock-session clock-session-${name}`,
        d: `M ${x1} ${y1} A ${radius} ${radius} 0 ${end - start > 720 ? 1 : 0} 1 ${x2} ${y2}`,
      });
      sessions.append(arc);
    }
  }
  const hours = windows => windows.map(([start, end]) => `${formatMinutes(start)}–${formatMinutes(end)}`).join(' / ');
  clock.querySelector('#clock-description').textContent = `24-hour San Francisco clock, with midnight at the top and noon at the bottom. Regular U.S. stock sessions ${hours(us)}. Japan ${hours(japan)}. All times Pacific. Weekdays at each exchange. Holidays and early closes are not shown.`;
}

update();
setInterval(() => { if (!document.hidden) update(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
