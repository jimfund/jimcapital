import { drawStrokes, placeNumber, isDrawing } from './drawing.js';
import { WORLD, isLayout, defaultPosition, validId, fitScene } from './layout-model.js';
import { animatePenLink } from './pen-link.js';

const main = document.querySelector('main');
export const editing = new URLSearchParams(location.search).get('edit') === '1'
  && ['localhost', '127.0.0.1'].includes(location.hostname);
const popout = new URLSearchParams(location.search).has('popout') && !editing;
document.body.classList.toggle('popout', popout);
export const items = new Map();
export let layout = { version: 1, items: {} };
export let boardScale = 1;
let placed = false;

async function read(path, fallback) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    return response.ok ? await response.json() : fallback;
  } catch { return fallback; }
}

function mountDrawing(target, drawing, output) {
  const canvas = target.querySelector('canvas') || document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1200;
  canvas.setAttribute('aria-hidden', 'true');
  target.replaceChildren(canvas);
  target.classList.add('doodled-monitor');
  target.style.aspectRatio = String(drawing.aspect || 4 / 3);
  drawStrokes(canvas, drawing);
  if (drawing.number.enabled !== false || output?.id === 'spx-price') {
    if (!output) {
      output = document.createElement('output');
      output.dataset.spxPrice = '';
      output.textContent = document.querySelector('#spx-price')?.textContent || '—';
    }
    output.className = 'doodle-number';
    target.append(output);
    const resize = () => placeNumber(target, output, drawing);
    target.drawingObserver?.disconnect();
    target.drawingObserver = new ResizeObserver(resize);
    target.drawingObserver.observe(target);
    resize();
  }
}

function addItem(id, content, nativeWidth, doodle = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'site-item';
  wrapper.dataset.item = id;
  wrapper.style.width = `${nativeWidth}px`;
  if (content.parentElement === main) content.replaceWith(wrapper);
  else main.append(wrapper);
  wrapper.append(content);
  content.style.width = '100%';
  items.set(id, { id, element: wrapper, content, nativeWidth, doodle });
}

export function updateDrawing(id, drawing) {
  const item = items.get(id);
  item.drawing = drawing;
  const output = item.content.querySelector('output');
  mountDrawing(item.content, drawing, output);
}

export function addDoodle(id, drawing, position) {
  const content = document.createElement('section');
  addItem(id, content, 400, true);
  updateDrawing(id, drawing);
  layout.items[id] = position;
  return items.get(id);
}

export function removeDoodle(id) {
  if (!items.get(id)?.doodle || id === 'monitor') return;
  items.get(id).content.drawingObserver?.disconnect();
  items.get(id).element.remove();
  items.delete(id);
  delete layout.items[id];
}

export function applyLayout(next = layout) {
  layout = next;
  placed = true;
  main.classList.add('layout-board');
  if (popout) {
    main.style.height = '100%';
    const rects = [...items].map(([id, item]) => {
      const position = layout.items[id];
      return { ...position, height: item.element.offsetHeight * position.width / item.nativeWidth };
    });
    const fit = fitScene(rects, main.clientWidth, main.clientHeight);
    boardScale = fit.scale;
    for (const [id, item] of items) {
      const position = layout.items[id];
      const zoom = position.width / item.nativeWidth;
      item.element.style.transform = `translate(${fit.x + position.x * boardScale}px, ${fit.y + position.y * boardScale}px) scale(${zoom * boardScale})`;
      item.element.style.zIndex = position.z;
    }
    return;
  }
  boardScale = main.clientWidth / WORLD;
  let height = 800;
  for (const [id, item] of items) {
    const position = layout.items[id];
    const zoom = position.width / item.nativeWidth;
    item.element.style.transform = `translate(${position.x * boardScale}px, ${position.y * boardScale}px) scale(${zoom * boardScale})`;
    item.element.style.zIndex = position.z;
    height = Math.max(height, position.y + item.element.offsetHeight * zoom + 60);
  }
  main.style.height = `${height * boardScale}px`;
}

async function init() {
  animatePenLink(main.querySelector('.one-word-link'));
  const [monitorDrawing, manifest, saved] = await Promise.all([
    read('assets/monitor-doodle.json', null), read('assets/doodles.json', { ids: [] }), read('assets/layout.json', null),
  ]);
  const monitor = document.querySelector('.monitor');
  if (isDrawing(monitorDrawing) && monitorDrawing.strokes.length) mountDrawing(monitor, monitorDrawing, document.querySelector('#spx-price'));
  addItem('prediction', main.querySelector('img'), 105);
  addItem('angel', main.querySelector('.frame'), 316);
  addItem('monitor', monitor, 400, true);
  addItem('softbank', main.querySelector('.softbank-tracker'), 300);
  addItem('clock', main.querySelector('.market-clock'), 300);
  addItem('one-word', main.querySelector('.one-word-link'), 85);
  addItem('ai-ticker', main.querySelector('.ai-ticker'), 102);
  if (isDrawing(monitorDrawing)) items.get('monitor').drawing = monitorDrawing;
  const ids = Array.isArray(manifest.ids) ? [...new Set(manifest.ids.filter(validId))].slice(0, 100) : [];
  const drawings = await Promise.all(ids.map(id => read(`assets/doodles/${id}.json`, null)));
  for (let i = 0; i < ids.length; i++) {
    if (!isDrawing(drawings[i])) continue;
    const content = document.createElement('section');
    mountDrawing(content, drawings[i]);
    addItem(ids[i], content, 400, true);
    items.get(ids[i]).drawing = drawings[i];
  }
  let extraIndex = 0;
  for (const [id] of items) {
    const fallback = defaultPosition(id, extraIndex);
    if (validId(id)) extraIndex++;
    layout.items[id] = isLayout(saved) && saved.items[id] ? saved.items[id] : fallback;
  }
  if (popout || editing || (isLayout(saved) && Object.keys(saved.items).length)) applyLayout();
  const layoutObserver = new ResizeObserver(() => { if (placed) applyLayout(); });
  layoutObserver.observe(main);
  // Refit after images, drawings, or fonts finish sizing as well as window resizes.
  if (popout) for (const item of items.values()) layoutObserver.observe(item.element);
  if (['localhost', '127.0.0.1'].includes(location.hostname) && !editing && !new URLSearchParams(location.search).has('popout') && window.self === window.top) {
    const link = document.createElement('a');
    link.className = 'edit-entry';
    link.href = '?edit=1&fresh=1';
    link.textContent = '↔';
    link.setAttribute('aria-label', '↔');
    document.body.append(link);
  }
  if (editing) {
    document.body.classList.add('editing');
    const { startEditor } = await import('./layout-editor.js');
    startEditor();
  }
}
export const ready = init();
