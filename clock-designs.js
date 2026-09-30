import { createClock3D } from './market-clock-3d.js';
import { attachClockPhysics } from './market-clock-physics.js';
import { createMarketStatus } from './market-clock-status.js';
import { dialMinutes, marketSessions } from './market-clock-time.js';
import { displayStyles, drawClockDisplay } from './market-clock-display.js';

const names = { classic: '01 / Classic', paper: '02 / Paper', lcd: '03 / LCD', flap: '04 / Split flap', 'marble-flap': '05 / Marble flaps' };
const clocks = displayStyles.map(style => {
  const card = document.createElement('article');
  card.id = style;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'clock-spin';
  button.setAttribute('aria-label', `${names[style]} market clock. Click or press Enter to flip; drag to spin.`);
  const fallback = document.createElement('canvas');
  fallback.width = fallback.height = 1024;
  fallback.className = 'clock-dial';
  fallback.style.borderRadius = '50%';
  button.append(fallback);
  const title = document.createElement('h2'); title.textContent = names[style];
  const link = document.createElement('a');
  link.href = `/?clock-style=${style}`; link.textContent = 'Try on the page';
  card.append(button, title, link); document.querySelector('#designs').append(card);
  let renderer;
  try { renderer = createClock3D(button, { displayStyle: style }); }
  catch (error) {
    button.querySelector('.clock-sculpture')?.remove();
    button.classList.remove('is-3d');
    console.warn('Design preview using a flat fallback.', error);
  }
  if (style === 'marble-flap' && renderer) {
    const replay = document.createElement('button');
    replay.type = 'button'; replay.className = 'replay-flaps'; replay.textContent = 'Flip flaps';
    replay.addEventListener('click', () => renderer.replayFlaps());
    card.append(replay);
  }
  let rotation = 180;
  renderer?.rotate(rotation);
  attachClockPhysics(button, () => rotation, value => {
    rotation = value;
    renderer?.rotate(rotation);
    if (!renderer) fallback.style.transform = `rotateX(${rotation - 180}deg)`;
  });
  return { style, renderer, button, fallback };
});
let getStatus;
let failed = false;
function update() {
  const now = new Date();
  const rows = getStatus?.(now) || (failed ? ['JP', 'US'].map(key => ({ key, phase: 'unknown' })) : null);
  const { us, japan } = marketSessions(now);
  for (const clock of clocks) {
    clock.renderer?.update(dialMinutes(now), [...us, ...japan], rows);
    drawClockDisplay(clock.fallback.getContext('2d'), rows, clock.style);
    clock.button.title = rows?.map(row => `${row.key}: ${row.text || 'Calendar unavailable'}`).join('\n') || 'Checking calendar';
  }
}
fetch('./assets/market-calendar.json')
  .then(response => { if (!response.ok) throw new Error('Calendar unavailable'); return response.json(); })
  .then(calendar => { getStatus = createMarketStatus(calendar); update(); })
  .catch(() => { failed = true; update(); });
update();
setInterval(() => { if (!document.hidden) update(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
document.querySelector('#size').addEventListener('input', event => {
  const value = `${event.target.value}px`;
  document.documentElement.style.setProperty('--clock-size', value);
  document.querySelector('#size-value').textContent = value;
});
