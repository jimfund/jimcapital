import { items, layout, boardScale, applyLayout } from './site.js';
import { constrain, isLayout } from './layout-model.js';

export function startEditor() {
  const toolbar = document.createElement('nav');
  toolbar.className = 'layout-tools';
  toolbar.innerHTML = `<a href="doodle.html?new=1" aria-label="+">+</a>
    <button data-action="edit" aria-label="doodle">✎</button>
    <input type="range" min="32" max="1000" aria-label="↔">
    <button data-action="back" aria-label="↧">↧</button>
    <button data-action="front" aria-label="↥">↥</button>
    <button data-action="undo" aria-label="↶">↶</button>
    <button data-action="redo" aria-label="↷">↷</button>
    <button data-action="save" aria-label="✓">✓</button>
    <a href="./" aria-label="jim.capital">↗</a>`;
  document.body.append(toolbar);
  const buttons = Object.fromEntries([...toolbar.querySelectorAll('button')].map(button => [button.dataset.action, button]));
  const size = toolbar.querySelector('input');
  const key = 'jimcapital.layout.draft.v1';
  const past = [];
  const future = [];
  let selected = 'monitor';
  let drag;
  let resizing = false;

  try {
    const draft = JSON.parse(localStorage.getItem(key));
    if (isLayout(draft)) {
      const merged = structuredClone(layout);
      for (const id of items.keys()) if (draft.items[id]) merged.items[id] = draft.items[id];
      applyLayout(merged);
    }
  } catch {}

  function draft() {
    try { localStorage.setItem(key, JSON.stringify(layout)); } catch {}
    delete buttons.save.dataset.state;
  }
  function controls() {
    for (const [id, item] of items) item.element.classList.toggle('selected', id === selected);
    size.value = layout.items[selected].width;
    buttons.edit.disabled = !items.get(selected).doodle;
    buttons.undo.disabled = !past.length;
    buttons.redo.disabled = !future.length;
  }
  function remember() {
    past.push(structuredClone(layout));
    if (past.length > 60) past.shift();
    future.length = 0;
    delete buttons.save.dataset.state;
  }
  function openDrawing(id) {
    if (!items.get(id).doodle) return;
    location.href = id === 'monitor' ? 'doodle.html' : `doodle.html?id=${id}`;
  }
  for (const [id, item] of items) {
    item.element.addEventListener('dragstart', event => event.preventDefault());
    item.element.addEventListener('click', event => event.preventDefault());
    item.element.addEventListener('dblclick', () => openDrawing(id));
    item.element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      event.preventDefault();
      selected = id;
      remember();
      drag = { id, pointer: event.pointerId, x: event.pageX, y: event.pageY, start: { ...layout.items[id] }, scale: boardScale };
      item.element.setPointerCapture(event.pointerId);
      item.element.classList.add('dragging');
      controls();
    });
    item.element.addEventListener('pointermove', event => {
      if (!drag || drag.id !== id || drag.pointer !== event.pointerId) return;
      layout.items[id] = constrain({ ...drag.start, x: drag.start.x + (event.pageX - drag.x) / drag.scale, y: drag.start.y + (event.pageY - drag.y) / drag.scale });
      applyLayout();
    });
    const finish = event => {
      if (!drag || drag.id !== id || drag.pointer !== event.pointerId) return;
      drag = null;
      if (item.element.hasPointerCapture(event.pointerId)) item.element.releasePointerCapture(event.pointerId);
      item.element.classList.remove('dragging');
      draft(); controls();
    };
    item.element.addEventListener('pointerup', finish);
    item.element.addEventListener('pointercancel', finish);
    item.element.addEventListener('lostpointercapture', finish);
  }
  size.addEventListener('input', () => {
    if (!resizing) { remember(); resizing = true; }
    layout.items[selected] = constrain({ ...layout.items[selected], width: Number(size.value) });
    applyLayout(); draft(); controls();
  });
  size.addEventListener('change', () => { resizing = false; });
  function step(from, to) {
    if (!from.length || drag) return;
    to.push(structuredClone(layout));
    applyLayout(from.pop());
    draft(); controls();
  }
  buttons.undo.addEventListener('click', () => step(past, future));
  buttons.redo.addEventListener('click', () => step(future, past));
  buttons.edit.addEventListener('click', () => openDrawing(selected));
  for (const direction of ['front', 'back']) buttons[direction].addEventListener('click', () => {
    remember();
    const order = Object.keys(layout.items).filter(id => id !== selected).sort((a, b) => layout.items[a].z - layout.items[b].z);
    if (direction === 'front') order.push(selected); else order.unshift(selected);
    order.forEach((id, z) => { layout.items[id].z = z + 1; });
    applyLayout(); draft(); controls();
  });
  buttons.save.addEventListener('click', async () => {
    const serialized = JSON.stringify(layout);
    buttons.save.disabled = true;
    try {
      const response = await fetch('/__layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: serialized, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error();
      if (JSON.stringify(layout) === serialized) {
        buttons.save.dataset.state = 'saved';
        try { localStorage.removeItem(key); } catch {}
      }
    } catch { buttons.save.dataset.state = 'error'; }
    finally { buttons.save.disabled = false; }
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) step(future, past); else step(past, future);
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && event.target.tagName !== 'INPUT') {
      event.preventDefault(); remember();
      const amount = event.shiftKey ? 20 : 5;
      const position = { ...layout.items[selected] };
      if (event.key === 'ArrowLeft') position.x -= amount;
      if (event.key === 'ArrowRight') position.x += amount;
      if (event.key === 'ArrowUp') position.y -= amount;
      if (event.key === 'ArrowDown') position.y += amount;
      layout.items[selected] = constrain(position);
      applyLayout(); draft(); controls();
    }
  });
  controls();
}
