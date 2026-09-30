import { pacificParts, dialMinutes, marketSessions, formatMinutes } from './market-clock-time.js';

const clock = document.querySelector('.market-clock');
const marker = clock.querySelector('#clock-marker');
const sessions = clock.querySelector('#clock-sessions');
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
  clock.querySelector('#clock-description').textContent = `24-hour San Francisco clock, with midnight at the top and noon at the bottom. Green: regular U.S. stock sessions ${hours(us)}. Red: Japan ${hours(japan)}. All times Pacific. Weekdays at each exchange. Holidays and early closes are not shown.`;
}

update();
setInterval(update, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
