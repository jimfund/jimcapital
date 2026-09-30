const page = document.querySelector('.page');
const figures = [...document.querySelectorAll('.decoration')];
const local = window.articleEditing === true;
const media = matchMedia('(max-width: 760px)');
const mode = () => media.matches ? 'narrow' : 'wide';
const idFor = figure => figure.dataset.id;
const ids = new Set(figures.map(idFor));
let layout = JSON.parse(document.querySelector('#article-layout').textContent);
let drag = null;
const deletedHistory = [];
function save() {
  if (local) parent.postMessage({ type: 'article-layout', layout }, location.origin);
}
function select(figure) {
  for (const f of figures) f.classList.toggle('selected', f === figure);
  parent.postMessage({ type: 'article-selection', id: idFor(figure), width: figure.querySelector('img').getBoundingClientRect().width }, location.origin);
}

function render() {
  for (const figure of figures) {
    const deleted = (layout.deleted ?? []).includes(idFor(figure));
    // Keep its original space so deleting a doodle doesn't shift the article or other drawings.
    figure.style.visibility = deleted ? 'hidden' : '';
    figure.setAttribute('aria-hidden', String(deleted || !local));
    figure.querySelector('img').tabIndex = local && !deleted ? 0 : -1;
    const width = layout[mode()][idFor(figure)]?.width;
    const img = figure.querySelector('img');
    figure.style.width = width ? `${width + 14}px` : '';
    img.style.width = width ? `${width}px` : '';
    img.style.height = width ? 'auto' : '';
    img.style.maxHeight = width ? 'none' : '';
    img.style.maxWidth = width ? 'none' : `${Math.max(22, Math.min(190, Number(img.getAttribute('width')) * 1.3))}px`;
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
    ...layout[mode()][idFor(figure)],
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
  image.addEventListener('focus', () => select(figure));
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

window.addEventListener('message', event => {
  if (!local || event.source !== parent || event.origin !== location.origin) return;
  const selected = figures.find(f => idFor(f) === event.data?.id);
  if (event.data?.type === 'article-resize' && selected) {
    const rect = selected.getBoundingClientRect();
    const width = Math.max(20, Math.min(900, Number(event.data.width) || 100));
    place(selected, rect.left + rect.width / 2, rect.top + rect.height / 2);
    layout[mode()][idFor(selected)].width = width;
    render(); save();
  }
  if (event.data?.type === 'article-restore-doodles') {
    layout.deleted = []; render(); save();
  }
  if (event.data?.type === 'article-delete' && selected) {
    selected.querySelector('img').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  }
});
