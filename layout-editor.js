import { items, layout, boardScale, applyLayout, addDoodle, removeDoodle, updateDrawing } from './site.js';
import { WORLD, constrain, isLayout, validId } from './layout-model.js';
import { blankDrawing, drawStrokes, isDrawing } from './drawing.js';
import { materialize } from './inline-drawing.js';

export function startEditor() {
  const main = document.querySelector('main');
  const overlay = document.createElement('canvas');
  overlay.className = 'ink-overlay';
  main.append(overlay);
  const toolbar = document.createElement('nav');
  toolbar.className = 'layout-tools';
  toolbar.innerHTML = `<button data-action="move" aria-label="↔">↔</button>
    <button data-action="pen" aria-label="doodle">✎</button>
    <button data-action="eraser" aria-label="⌫">⌫</button>
    <button data-action="new" aria-label="+">+</button>
    <button data-action="number" aria-label="number">123</button>
    <input type="color" value="#111111" aria-label="doodle">
    <input type="range" min="32" max="1200" aria-label="↔">
    <button data-action="back" aria-label="↧">↧</button>
    <button data-action="front" aria-label="↥">↥</button>
    <button data-action="delete" aria-label="Delete selected doodle">Delete</button>
    <button data-action="undo" aria-label="↶">↶</button>
    <button data-action="redo" aria-label="↷">↷</button>
    <button data-action="recover" aria-label="Restore previous unsaved doodle" hidden>↺</button>
    <button data-action="save" aria-label="✓">✓</button>
    <a href="./" aria-label="jim.capital">↗</a>`;
  document.body.append(toolbar);
  const buttons = Object.fromEntries([...toolbar.querySelectorAll('button')].map(button => [button.dataset.action, button]));
  const size = toolbar.querySelector('[type="range"]');
  const color = toolbar.querySelector('[type="color"]');
  const key = 'jimcapital.canvas.draft.v1';
  const recoveryKey = 'jimcapital.canvas.recovery.v1';
  const past = [], future = [];
  let selected = 'monitor', mode = 'move', active = null;
  let drag, inkPointer = null, stroke, resizing = false, scheduled = false;
  let penColor = '#111111', penWidth = 3, eraserWidth = 24;
  let baseScene = JSON.stringify(scene());
  let recovery = null;

  function scene() {
    return { version: 1, layout: structuredClone(layout), drawings: Object.fromEntries([...items].filter(([, item]) => item.drawing).map(([id, item]) => [id, structuredClone(item.drawing)])) };
  }
  function snapshot() { return { ...scene(), baseScene, selected, mode, active: structuredClone(active) }; }
  function remember() {
    past.push(snapshot());
    if (past.length > 40) past.shift();
    future.length = 0;
    delete buttons.save.dataset.state;
  }
  function draft() {
    try { localStorage.setItem(key, JSON.stringify(snapshot())); } catch {}
    delete buttons.save.dataset.state;
  }
  function controls() {
    main.dataset.mode = mode;
    for (const [id, item] of items) item.element.classList.toggle('selected', id === selected && (mode === 'move' || active?.kind === 'existing'));
    for (const tool of ['move', 'pen', 'eraser', 'number']) buttons[tool].setAttribute('aria-pressed', String(mode === tool));
    buttons.number.disabled = !items.get(selected)?.drawing;
    buttons.back.disabled = buttons.front.disabled = mode !== 'move';
    buttons.delete.disabled = !canDelete();
    buttons.undo.disabled = !past.length;
    buttons.redo.disabled = !future.length;
    color.disabled = mode === 'move' || mode === 'eraser';
    color.value = mode === 'number' ? items.get(selected).drawing.number.color : penColor;
    size.min = mode === 'move' ? 32 : mode === 'number' ? 14 : 1;
    size.max = mode === 'move' ? WORLD : mode === 'number' ? 120 : mode === 'eraser' ? 80 : 32;
    size.value = mode === 'move' ? layout.items[selected].width : mode === 'number' ? items.get(selected).drawing.number.size : mode === 'eraser' ? eraserWidth : penWidth;
  }
  function renderOverlay() {
    const height = Math.max(1, main.clientHeight / boardScale);
    const drawing = blankDrawing();
    drawing.aspect = WORLD / height;
    drawing.strokes = active?.kind === 'new' ? active.strokes.map(s => ({ ...s, width: s.width * 800 / WORLD, points: s.points.map(([x, y]) => [x / WORLD, y / height]) })) : [];
    drawStrokes(overlay, drawing);
  }
  function renderInk() {
    if (active?.kind === 'existing') updateDrawing(active.id, items.get(active.id).drawing);
    renderOverlay();
  }
  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; renderInk(); });
  }
  function finishNew() {
    if (active?.kind !== 'new') return;
    const result = materialize(active.strokes);
    if (result) {
      const id = crypto.randomUUID();
      result.position.z = Math.min(10000, Math.max(...Object.values(layout.items).map(p => p.z)) + 1);
      attach(addDoodle(id, result.drawing, result.position));
      selected = id;
      applyLayout();
    }
    active = null;
    renderOverlay();
  }
  function restore(saved) {
    if (!isLayout(saved.layout) || !saved.drawings || !isDrawing(saved.drawings.monitor)) return false;
    if (!Object.entries(saved.drawings).every(([id, d]) => (id === 'monitor' || validId(id)) && isDrawing(d) && saved.layout.items[id])) return false;
    if (saved.active?.kind === 'new' && !Array.isArray(saved.active.strokes)) return false;
    for (const [id, item] of items) if (item.doodle && id !== 'monitor' && !saved.drawings[id]) removeDoodle(id);
    for (const [id, drawing] of Object.entries(saved.drawings)) {
      if (items.has(id)) updateDrawing(id, structuredClone(drawing));
      else attach(addDoodle(id, structuredClone(drawing), saved.layout.items[id]));
    }
    const restoredLayout = structuredClone(saved.layout);
    // Older drafts have no positions for newly added widgets.
    restoredLayout.items.softbank ||= structuredClone(layout.items.softbank);
    restoredLayout.items.clock ||= structuredClone(layout.items.clock);
    restoredLayout.items['one-word'] ||= structuredClone(layout.items['one-word']);
    applyLayout(restoredLayout);
    selected = items.has(saved.selected) ? saved.selected : 'monitor';
    mode = ['move', 'pen', 'eraser', 'number'].includes(saved.mode) ? saved.mode : 'move';
    active = structuredClone(saved.active || null);
    controls(); renderOverlay();
    return true;
  }
  function attach(item) {
    const { id, element } = item;
    element.addEventListener('dragstart', e => e.preventDefault());
    element.addEventListener('click', e => e.preventDefault());
    element.addEventListener('dblclick', () => {
      if (!item.drawing || mode !== 'move') return;
      selected = id; active = { kind: 'existing', id }; mode = 'pen';
      controls(); renderOverlay();
    });
    element.addEventListener('pointerdown', e => {
      if (e.button !== 0 || drag || mode !== 'move') return;
      e.preventDefault(); selected = id; remember();
      drag = { id, pointer: e.pointerId, x: e.pageX, y: e.pageY, start: { ...layout.items[id] }, scale: boardScale };
      element.setPointerCapture(e.pointerId);
      element.classList.add('dragging'); controls();
    });
    element.addEventListener('pointermove', e => {
      if (!drag || drag.id !== id || drag.pointer !== e.pointerId) return;
      layout.items[id] = constrain({ ...drag.start, x: drag.start.x + (e.pageX - drag.x) / drag.scale, y: drag.start.y + (e.pageY - drag.y) / drag.scale });
      applyLayout();
    });
    const finish = e => {
      if (!drag || drag.id !== id || drag.pointer !== e.pointerId) return;
      drag = null;
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
      element.classList.remove('dragging'); draft(); controls();
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(event, finish);
  }
  for (const item of items.values()) attach(item);

  function inkPoint(e) {
    if (active.kind === 'existing') {
      const rect = items.get(active.id).element.getBoundingClientRect();
      return [Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))];
    }
    const rect = main.getBoundingClientRect();
    return [Math.max(0, Math.min(WORLD, (e.clientX - rect.left) / boardScale)), Math.max(0, Math.min(6900, (e.clientY - rect.top) / boardScale))];
  }
  function addPoint(e) {
    const point = inkPoint(e);
    if (mode === 'number') {
      const number = items.get(active.id).drawing.number;
      number.x = Math.max(.05, Math.min(.95, point[0])); number.y = Math.max(.05, Math.min(.95, point[1]));
      return;
    }
    if (stroke.points.length >= 20000) return;
    const last = stroke.points.at(-1);
    const threshold = active.kind === 'new' ? .5 : .001;
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > threshold) stroke.points.push(point);
  }
  overlay.addEventListener('pointerdown', e => {
    if (e.button !== 0 || inkPointer !== null || mode === 'move') return;
    e.preventDefault(); remember();
    if (!active) active = { kind: 'new', strokes: [] };
    const strokes = active.kind === 'new' ? active.strokes : items.get(active.id).drawing.strokes;
    if (strokes.length >= 2000) return;
    inkPointer = e.pointerId; overlay.setPointerCapture(inkPointer);
    if (mode !== 'number') {
      const width = mode === 'eraser' ? eraserWidth : penWidth;
      stroke = { tool: mode === 'eraser' ? 'eraser' : 'pen', color: penColor, width: active.kind === 'new' ? width : Math.min(1600, width * 800 / layout.items[active.id].width), points: [] };
      strokes.push(stroke);
    }
    addPoint(e); scheduleRender(); controls();
  });
  overlay.addEventListener('pointermove', e => {
    if (e.pointerId !== inkPointer) return;
    const coalesced = e.getCoalescedEvents?.() || [];
    for (const sample of coalesced.length ? coalesced : [e]) addPoint(sample);
    scheduleRender();
  });
  const endInk = e => {
    if (e.pointerId !== inkPointer) return;
    if (e.type === 'pointerup') addPoint(e);
    inkPointer = null;
    if (overlay.hasPointerCapture(e.pointerId)) overlay.releasePointerCapture(e.pointerId);
    renderInk(); draft(); controls();
  };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) overlay.addEventListener(event, endInk);

  buttons.move.addEventListener('click', () => { finishNew(); active = null; mode = 'move'; controls(); draft(); });
  buttons.pen.addEventListener('click', () => { if (mode === 'move') active = { kind: 'new', strokes: [] }; mode = 'pen'; controls(); });
  buttons.new.addEventListener('click', () => { finishNew(); active = { kind: 'new', strokes: [] }; mode = 'pen'; controls(); draft(); });
  buttons.eraser.addEventListener('click', () => {
    if (!active && items.get(selected).drawing) active = { kind: 'existing', id: selected };
    if (active) { mode = 'eraser'; controls(); }
  });
  buttons.number.addEventListener('click', () => {
    finishNew();
    if (!items.get(selected).drawing) return;
    remember(); active = { kind: 'existing', id: selected }; mode = 'number';
    items.get(selected).drawing.number.enabled = true;
    updateDrawing(selected, items.get(selected).drawing); controls(); draft();
  });
  color.addEventListener('input', () => {
    if (mode === 'number') { remember(); items.get(selected).drawing.number.color = color.value; renderInk(); draft(); }
    else penColor = color.value;
  });
  size.addEventListener('input', () => {
    if (mode === 'move' || mode === 'number') {
      if (!resizing) { remember(); resizing = true; }
      if (mode === 'move') { layout.items[selected] = constrain({ ...layout.items[selected], width: Number(size.value) }); applyLayout(); }
      else { items.get(selected).drawing.number.size = Number(size.value); renderInk(); }
      draft(); controls();
    } else if (mode === 'eraser') eraserWidth = Number(size.value);
    else penWidth = Number(size.value);
  });
  size.addEventListener('change', () => { resizing = false; });
  function step(from, to) {
    if (!from.length || drag || inkPointer !== null) return;
    to.push(snapshot()); restore(from.pop()); draft(); controls();
  }
  buttons.undo.addEventListener('click', () => step(past, future));
  buttons.redo.addEventListener('click', () => step(future, past));
  function canDelete() {
    return items.get(selected)?.doodle && selected !== 'monitor'
      && active?.kind !== 'new' && !drag && inkPointer === null;
  }
  function deleteSelected() {
    if (!canDelete()) return;
    remember();
    removeDoodle(selected);
    selected = 'monitor'; active = null; mode = 'move'; resizing = false;
    applyLayout(); renderOverlay(); draft(); controls();
  }
  buttons.delete.addEventListener('click', deleteSelected);
  for (const direction of ['front', 'back']) buttons[direction].addEventListener('click', () => {
    remember();
    const order = Object.keys(layout.items).filter(id => id !== selected).sort((a, b) => layout.items[a].z - layout.items[b].z);
    if (direction === 'front') order.push(selected); else order.unshift(selected);
    order.forEach((id, z) => { layout.items[id].z = z + 1; });
    applyLayout(); draft(); controls();
  });
  buttons.save.addEventListener('click', async () => {
    finishNew(); active = null; mode = 'move'; controls();
    const serialized = JSON.stringify(scene());
    buttons.save.disabled = true;
    try {
      const response = await fetch('/__scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: serialized, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      baseScene = serialized;
      if (JSON.stringify(scene()) === serialized && !active?.strokes?.length) {
        buttons.save.dataset.state = 'saved';
        try { localStorage.removeItem(key); localStorage.removeItem('jimcapital.layout.draft.v1'); } catch {}
      } else {
        draft();
      }
    } catch { draft(); buttons.save.dataset.state = 'error'; }
    finally { buttons.save.disabled = false; }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.altKey
      && !e.target.closest('input, textarea, select, [contenteditable]') && canDelete()) {
      e.preventDefault(); deleteSelected();
      return;
    }
    if (e.key === 'Escape' && inkPointer === null) buttons.move.click();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault(); if (e.shiftKey) step(future, past); else step(past, future);
    } else if (mode === 'move' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && e.target.tagName !== 'INPUT') {
      e.preventDefault(); remember();
      const amount = e.shiftKey ? 20 : 5, position = { ...layout.items[selected] };
      if (e.key === 'ArrowLeft') position.x -= amount;
      if (e.key === 'ArrowRight') position.x += amount;
      if (e.key === 'ArrowUp') position.y -= amount;
      if (e.key === 'ArrowDown') position.y += amount;
      layout.items[selected] = constrain(position); applyLayout(); draft(); controls();
    }
  });
  buttons.recover.addEventListener('click', () => {
    if (!recovery || drag || inkPointer !== null) return;
    remember();
    if (restore(recovery)) { draft(); controls(); }
  });
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    recovery = JSON.parse(localStorage.getItem(recoveryKey));
    const fresh = new URLSearchParams(location.search).get('fresh') === '1';
    if (saved && (fresh || saved.baseScene !== baseScene)) {
      // Keep old work recoverable without replacing the current page's layout.
      localStorage.setItem(recoveryKey, JSON.stringify(saved));
      recovery = saved;
    } else if (saved) {
      restore(saved);
    }
    if (!saved && !recovery) {
      const previous = JSON.parse(localStorage.getItem('jimcapital.layout.draft.v1'));
      if (isLayout(previous)) {
        recovery = { ...snapshot(), layout: { version: 1, items: { ...layout.items, ...previous.items } } };
        localStorage.setItem(recoveryKey, JSON.stringify(recovery));
      }
    }
  } catch {}
  buttons.recover.hidden = !recovery;
  new ResizeObserver(renderOverlay).observe(main);
  controls(); renderOverlay();
}
