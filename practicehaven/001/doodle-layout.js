const page = document.querySelector('.page');
const figures = [...document.querySelectorAll('.decoration')];
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const media = matchMedia('(max-width: 760px)');
const mode = () => media.matches ? 'narrow' : 'wide';
const idFor = figure => figure.querySelector('img').getAttribute('src').split('/').pop().replace('.svg', '');
const ids = new Set(figures.map(idFor));
let layout = { version: 1, wide: {}, narrow: {} };
let drag = null;
let queued = false;
let saving = false;
let error;
const deletedHistory = [];

function valid(value) {
  return value?.version === 1 &&
    (value.deleted === undefined || (Array.isArray(value.deleted) && value.deleted.every(id => ids.has(id)))) &&
    ['wide', 'narrow'].every(key =>
    value[key] && typeof value[key] === 'object' && !Array.isArray(value[key]) &&
    Object.entries(value[key]).every(([id, p]) => ids.has(id) && p &&
      [p.x, p.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)));
}
try {
  const response = await fetch('layout.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Layout unavailable');
  const saved = await response.json();
  if (valid(saved)) layout = saved;
} catch { /* The original arrangement remains usable without a saved layout. */ }

function reportFailure() {
  if (error) return;
  error = document.createElement('button');
  error.className = 'layout-error';
  error.textContent = 'Positions not saved. Retry';
  error.addEventListener('click', save);
  document.querySelector('footer').append(error);
}
async function save() {
  if (!local) return;
  queued = true;
  if (saving) return;
  saving = true;
  try {
    while (queued) {
      queued = false;
      const body = JSON.stringify(layout);
      const response = await fetch('/__practicehaven/001/layout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
      });
      if (!response.ok) throw new Error('Save failed');
    }
    error?.remove();
    error = null;
  } catch {
    reportFailure();
  } finally {
    saving = false;
  }
}

function render() {
  for (const figure of figures) {
    const deleted = (layout.deleted ?? []).includes(idFor(figure));
    // Keep its original space so deleting a doodle doesn't shift the article or other drawings.
    figure.style.visibility = deleted ? 'hidden' : '';
    figure.setAttribute('aria-hidden', String(deleted || !local));
    figure.querySelector('img').tabIndex = local && !deleted ? 0 : -1;
    figure.style.removeProperty('--move-x');
    figure.style.removeProperty('--move-y');
  }
  const bounds = page.getBoundingClientRect();
  const offsets = figures.map(figure => {
    const position = layout[mode()][idFor(figure)];
    if (!position) return null;
    const rect = figure.getBoundingClientRect();
    return { figure, x: bounds.left + position.x * bounds.width - (rect.left + rect.width / 2),
      y: bounds.top + position.y * bounds.height - (rect.top + rect.height / 2) };
  });
  for (const offset of offsets) if (offset) {
    offset.figure.style.setProperty('--move-x', `${offset.x}px`);
    offset.figure.style.setProperty('--move-y', `${offset.y}px`);
  }
}
function place(figure, x, y) {
  const bounds = page.getBoundingClientRect();
  const image = figure.querySelector('img').getBoundingClientRect();
  const insetX = Math.min(bounds.width / 2, image.width / 2);
  const insetY = Math.min(bounds.height / 2, image.height / 2);
  layout[mode()][idFor(figure)] = {
    x: Math.max(insetX, Math.min(bounds.width - insetX, x - bounds.left)) / bounds.width,
    y: Math.max(insetY, Math.min(bounds.height - insetY, y - bounds.top)) / bounds.height,
  };
  render();
}
function updateDrag() {
  if (drag) place(drag.figure, drag.x - drag.grabX, drag.y - drag.grabY);
}
function finish(cancel = false) {
  if (!drag) return;
  const current = drag;
  drag = null;
  cancelAnimationFrame(current.frame);
  current.figure.classList.remove('dragging');
  if (cancel) {
    if (current.previous) layout[current.mode][idFor(current.figure)] = current.previous;
    else delete layout[current.mode][idFor(current.figure)];
    render();
  } else if (current.moved) save();
  if (current.image.hasPointerCapture(current.pointer)) current.image.releasePointerCapture(current.pointer);
}
function scrollDrag() {
  if (!drag) return;
  const edge = 65;
  const dy = drag.y < edge ? -Math.min(14, (edge - drag.y) / 4)
    : drag.y > innerHeight - edge ? Math.min(14, (drag.y - innerHeight + edge) / 4) : 0;
  if (dy) {
    const previousScroll = scrollY;
    scrollBy(0, dy);
    if (scrollY !== previousScroll) { drag.moved = true; updateDrag(); }
  }
  drag.frame = requestAnimationFrame(scrollDrag);
}
for (const figure of figures) {
  const image = figure.querySelector('img');
  image.draggable = false;
  image.addEventListener('load', render);
  if (!local) continue;
  figure.classList.add('movable');
  figure.removeAttribute('aria-hidden');
  image.draggable = false;
  image.tabIndex = 0;
  image.setAttribute('role', 'img');
  image.setAttribute('aria-label', `${idFor(figure).replaceAll('-', ' ')} doodle. Drag to move, or use arrow keys. Delete removes it. Escape cancels a drag.`);
  image.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    const rect = figure.getBoundingClientRect();
    drag = { figure, image, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      grabX: event.clientX - rect.left - rect.width / 2,
      grabY: event.clientY - rect.top - rect.height / 2,
      mode: mode(), previous: layout[mode()][idFor(figure)], moved: false };
    image.focus({ preventScroll: true });
    image.setPointerCapture(event.pointerId);
    figure.classList.add('dragging');
    drag.frame = requestAnimationFrame(scrollDrag);
  });
  image.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY; drag.moved = true;
    updateDrag();
  });
  image.addEventListener('pointerup', () => finish());
  image.addEventListener('pointercancel', () => finish(true));
  image.addEventListener('lostpointercapture', () => finish(true));
  image.addEventListener('keydown', event => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      finish(true);
      const id = idFor(figure);
      if ((layout.deleted ?? []).includes(id)) return;
      layout.deleted = [...(layout.deleted ?? []), id];
      deletedHistory.push(id);
      image.blur();
      render();
      save();
      return;
    }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta || drag) return;
    event.preventDefault();
    const rect = figure.getBoundingClientRect();
    const step = event.shiftKey ? 20 : 4;
    place(figure, rect.left + rect.width / 2 + delta[0] * step, rect.top + rect.height / 2 + delta[1] * step);
    save();
  });
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') finish(true);
  if (!local || event.target.closest('input, textarea, [contenteditable="true"]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey && deletedHistory.length) {
    event.preventDefault();
    finish(true);
    const id = deletedHistory.pop();
    layout.deleted = layout.deleted.filter(value => value !== id);
    render();
    figures.find(figure => idFor(figure) === id).querySelector('img').focus({ preventScroll: true });
    save();
  }
});
window.addEventListener('blur', () => finish(true));
window.addEventListener('resize', () => { finish(true); render(); });
window.addEventListener('scroll', updateDrag, { passive: true });
new ResizeObserver(render).observe(page);
render();
