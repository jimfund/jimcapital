import { blankDrawing, drawStrokes, placeNumber, isDrawing } from './drawing.js';

const canvas = document.querySelector('#drawing');
const stage = document.querySelector('.drawing-stage');
const output = document.querySelector('#spx-price');
const ink = document.querySelector('#ink');
const size = document.querySelector('#size');
const save = document.querySelector('#save');
const undo = document.querySelector('#undo');
const redo = document.querySelector('#redo');
const params = new URLSearchParams(location.search);
const requestedId = params.get('id');
const validId = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value || '');
const id = validId(requestedId) ? requestedId : params.has('new') ? crypto.randomUUID() : 'monitor';
if (params.has('new')) history.replaceState(null, '', `doodle.html?id=${id}`);
const key = id === 'monitor' ? 'jimcapital.monitor.draft.v1' : `jimcapital.doodle.${id}.v1`;
const assetPath = id === 'monitor' ? 'assets/monitor-doodle.json' : `assets/doodles/${id}.json`;
const savePath = id === 'monitor' ? '/__doodle' : `/__doodles/${id}`;
let drawing = blankDrawing();
if (id !== 'monitor') drawing.number.enabled = false;
let tool = 'pen';
let pointer = null;
let stroke;
let penColor = '#111111';
let penWidth = 4;
let eraserWidth = 24;
let rendering = false;
const past = [];
const future = [];

function render() {
  drawStrokes(canvas, drawing);
  placeNumber(stage, output, drawing);
  undo.disabled = !past.length;
  redo.disabled = !future.length;
}

function scheduleRender() {
  if (rendering) return;
  rendering = true;
  requestAnimationFrame(() => { rendering = false; render(); });
}

function remember() {
  past.push({ ...drawing, strokes: drawing.strokes.slice(), number: { ...drawing.number } });
  if (past.length > 60) past.shift();
  future.length = 0;
  delete save.dataset.state;
}

function draft() {
  try { localStorage.setItem(key, JSON.stringify(drawing)); } catch {}
}

function controls() {
  stage.dataset.tool = tool;
  document.querySelectorAll('[data-tool]').forEach(button => {
    if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  });
  ink.disabled = tool === 'eraser';
  ink.value = tool === 'number' ? drawing.number.color : penColor;
  size.min = tool === 'number' ? 14 : 1;
  size.max = tool === 'number' ? 120 : tool === 'eraser' ? 80 : 48;
  size.value = tool === 'number' ? drawing.number.size : tool === 'eraser' ? eraserWidth : penWidth;
}

function point(event) {
  const box = canvas.getBoundingClientRect();
  return [Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))];
}

function moveNumber(x, y) {
  const margin = Math.min(.46, drawing.number.size * 2.7 / 800 + .01);
  drawing.number.x = Math.max(margin, Math.min(1 - margin, x));
  drawing.number.y = Math.max(.1, Math.min(.9, y));
}

function addPoint(event) {
  const p = point(event);
  if (tool === 'number') { moveNumber(...p); return; }
  if (stroke.points.length >= 20000) return;
  const last = stroke.points.at(-1);
  if (!last || Math.hypot((p[0] - last[0]) * 800, (p[1] - last[1]) * 600) > .5) stroke.points.push(p);
}

canvas.addEventListener('pointerdown', event => {
  if (pointer !== null || event.button !== 0 || drawing.strokes.length >= 2000) return;
  event.preventDefault();
  remember();
  pointer = event.pointerId;
  canvas.setPointerCapture(pointer);
  if (tool !== 'number') {
    stroke = { tool, color: penColor, width: tool === 'eraser' ? eraserWidth : penWidth, points: [] };
    drawing.strokes.push(stroke);
  }
  addPoint(event);
  scheduleRender();
});

canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== pointer) return;
  const events = event.getCoalescedEvents?.() || [];
  for (const sample of events.length ? events : [event]) addPoint(sample);
  scheduleRender();
});

function finish(event) {
  if (event.pointerId !== pointer) return;
  if (event.type === 'pointerup') addPoint(event);
  const id = pointer;
  pointer = null;
  if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  render();
  draft();
}
canvas.addEventListener('pointerup', finish);
canvas.addEventListener('pointercancel', finish);
canvas.addEventListener('lostpointercapture', finish);

document.querySelectorAll('button[data-tool]').forEach(button => button.addEventListener('click', () => {
  tool = button.dataset.tool;
  if (tool === 'number' && drawing.number.enabled === false) {
    remember(); drawing.number.enabled = true; render(); draft();
  }
  controls();
}));
ink.addEventListener('input', () => {
  if (tool === 'number') { remember(); drawing.number.color = ink.value; render(); draft(); }
  else penColor = ink.value;
});
size.addEventListener('input', () => {
  if (tool === 'number') {
    remember();
    drawing.number.size = Number(size.value);
    moveNumber(drawing.number.x, drawing.number.y);
    render();
    draft();
  } else if (tool === 'eraser') eraserWidth = Number(size.value);
  else penWidth = Number(size.value);
});

function step(from, to) {
  if (!from.length || pointer !== null) return;
  to.push(drawing);
  drawing = from.pop();
  delete save.dataset.state;
  controls();
  render();
  draft();
}
undo.addEventListener('click', () => step(past, future));
redo.addEventListener('click', () => step(future, past));
document.querySelector('#clear').addEventListener('click', () => {
  remember(); drawing.strokes = []; render(); draft();
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) step(future, past); else step(past, future);
  }
});

function download() {
  const blob = new Blob([JSON.stringify(drawing)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = id === 'monitor' ? 'monitor-doodle.json' : `${id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.querySelector('#download').addEventListener('click', download);
async function saveDrawing() {
  draft();
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) { download(); return false; }
  save.disabled = true;
  const serialized = JSON.stringify(drawing);
  try {
    const response = await fetch(savePath, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: serialized, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error();
    if (JSON.stringify(drawing) === serialized) save.dataset.state = 'saved';
    await loadGallery();
    return true;
  } catch { save.dataset.state = 'error'; return false; }
  finally { save.disabled = false; }
}
save.addEventListener('click', saveDrawing);
document.querySelector('#new-doodle').addEventListener('click', async () => {
  if (drawing.strokes.length && !await saveDrawing()) return;
  location.href = 'doodle.html?new=1';
});

async function loadGallery() {
  const gallery = document.querySelector('.gallery');
  try {
    const response = await fetch('assets/doodles.json', { cache: 'no-store' });
    const list = await response.json();
    const ids = ['monitor', ...list.ids.filter(validId)];
    const entries = await Promise.all(ids.map(async drawingId => {
      const path = drawingId === 'monitor' ? 'assets/monitor-doodle.json' : `assets/doodles/${drawingId}.json`;
      try {
        const res = await fetch(path, { cache: 'no-store' });
        const data = await res.json();
        return isDrawing(data) ? [drawingId, data] : null;
      } catch { return null; }
    }));
    const links = entries.filter(Boolean).map(([drawingId, data]) => {
      const link = document.createElement('a');
      link.href = drawingId === 'monitor' ? 'doodle.html' : `doodle.html?id=${drawingId}`;
      link.setAttribute('aria-label', 'doodle');
      if (drawingId === id) link.setAttribute('aria-current', 'page');
      const preview = document.createElement('canvas');
      preview.width = 1600; preview.height = 1200;
      drawStrokes(preview, data);
      link.append(preview);
      return link;
    });
    gallery.replaceChildren(...links);
  } catch {}
}

async function init() {
  try {
    const local = JSON.parse(localStorage.getItem(key));
    if (isDrawing(local)) { drawing = local; controls(); render(); return; }
  } catch {}
  try {
    const response = await fetch(assetPath, { cache: 'no-store' });
    const stored = await response.json();
    if (isDrawing(stored) && !past.length && !future.length && pointer === null) drawing = stored;
  } catch {}
  controls();
  render();
}
new ResizeObserver(() => placeNumber(stage, output, drawing)).observe(stage);
render();
init();
loadGallery();
