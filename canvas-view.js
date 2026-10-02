import { fitScene } from './layout-model.js';

const CONTROLS = 'a, button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [role="link"], [role="button"], [tabindex]:not([tabindex="-1"])';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function canvasGeometry(rects, width, height) {
  if (!rects.length) return { scale: 1, x: width / 2, y: height / 2 };
  const fit = fitScene(rects, width, height, 32);
  // On phones, leave room to explore instead of shrinking every object to a speck.
  const scale = clamp(fit.scale, .55, 1);
  const left = Math.min(...rects.map(rect => rect.x));
  const top = Math.min(...rects.map(rect => rect.y));
  const right = Math.max(...rects.map(rect => rect.x + rect.width));
  const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
  return { scale, x: width / 2 - (left + right) * scale / 2,
    y: height / 2 - (top + bottom) * scale / 2 };
}

export function mountCanvasView(main, items, getLayout) {
  const doc = main.ownerDocument;
  const win = doc.defaultView;
  const preference = win.matchMedia('(prefers-reduced-motion: reduce)');
  const camera = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  const angel = items.get('angel');
  const angelWindow = angel?.element.querySelector('.angel-window');
  const angelImage = angelWindow?.querySelector('img');
  let imageScale = 1, imageTravel = { x: 0, y: 0 };
  let geometry, layers = [], bounds, frame = 0, lastTime = 0, drag;

  doc.body.classList.add('canvas-mode');
  main.classList.add('canvas-viewport');
  main.tabIndex = 0;
  main.setAttribute('aria-label', 'Explore the jim.capital canvas');
  main.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight Home');

  // The gold frame shares the foreground camera. Only its clipped image has depth.
  function render() {
    for (const layer of layers) {
      const { element, x, y, zoom } = layer;
      element.style.transform = `translate3d(${geometry.x + x * geometry.scale + camera.x}px, ${geometry.y + y * geometry.scale + camera.y}px, 0) scale(${zoom * geometry.scale})`;
    }
    if (angelImage) {
      const drift = preference.matches ? 0 : -.08 / imageScale;
      const x = clamp(camera.x * drift, -imageTravel.x, imageTravel.x);
      const y = clamp(camera.y * drift, -imageTravel.y, imageTravel.y);
      // A little extra image area keeps every edge covered as it moves behind the frame.
      angelImage.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.18)`;
    }
  }

  function tick(time) {
    frame = 0;
    const elapsed = lastTime ? Math.min(64, time - lastTime) : 16;
    lastTime = time;
    const blend = drag || preference.matches ? 1 : 1 - Math.exp(-elapsed / 75);
    camera.x += (target.x - camera.x) * blend;
    camera.y += (target.y - camera.y) * blend;
    const settled = Math.hypot(target.x - camera.x, target.y - camera.y) < .1;
    if (settled) Object.assign(camera, target);
    render();
    if (!settled) frame = win.requestAnimationFrame(tick);
    else lastTime = 0;
  }

  function moveTo(x, y) {
    target.x = clamp(x, bounds.minX, bounds.maxX);
    target.y = clamp(y, bounds.minY, bounds.maxY);
    if (!frame) frame = win.requestAnimationFrame(tick);
  }

  function resize() {
    const layout = getLayout();
    layers = [...items].map(([id, item]) => {
      const position = layout.items[id];
      const zoom = position.width / item.nativeWidth;
      item.element.style.zIndex = position.z;
      return { ...position, id, element: item.element, zoom, height: item.element.offsetHeight * zoom };
    });
    const width = main.clientWidth, height = main.clientHeight;
    geometry = canvasGeometry(layers, width, height);
    if (angelImage) {
      imageScale = geometry.scale * layout.items.angel.width / angel.nativeWidth;
      imageTravel = { x: angelWindow.clientWidth * .08, y: angelWindow.clientHeight * .08 };
    }
    // Keep an edge of the scene reachable, even after a long trackpad fling.
    const gutter = Math.min(80, width / 4, height / 4);
    bounds = {
      minX: Math.min(0, ...layers.map(p => gutter - geometry.x - (p.x + p.width) * geometry.scale)),
      maxX: Math.max(0, ...layers.map(p => width - gutter - geometry.x - p.x * geometry.scale)),
      minY: Math.min(0, ...layers.map(p => gutter - geometry.y - (p.y + p.height) * geometry.scale)),
      maxY: Math.max(0, ...layers.map(p => height - gutter - geometry.y - p.y * geometry.scale)),
    };
    camera.x = clamp(camera.x, bounds.minX, bounds.maxX);
    camera.y = clamp(camera.y, bounds.minY, bounds.maxY);
    target.x = clamp(target.x, bounds.minX, bounds.maxX);
    target.y = clamp(target.y, bounds.minY, bounds.maxY);
    render();
    return geometry.scale;
  }

  function isControl(element) {
    const control = element.closest(CONTROLS);
    return control && control !== main;
  }

  main.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || drag || isControl(event.target)) return;
    event.preventDefault();
    main.focus({ preventScroll: true });
    Object.assign(target, camera);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: camera.x, startY: camera.y };
    main.setPointerCapture(event.pointerId);
    main.classList.add('is-panning');
  });
  main.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    moveTo(drag.startX + event.clientX - drag.x, drag.startY + event.clientY - drag.y);
  });
  function finishDrag(event) {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    main.classList.remove('is-panning');
    if (main.hasPointerCapture(id)) main.releasePointerCapture(id);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) main.addEventListener(type, finishDrag);
  win.addEventListener('blur', finishDrag);
  main.addEventListener('dragstart', event => { if (!isControl(event.target)) event.preventDefault(); });

  main.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (drag) return;
    let x = event.deltaX, y = event.deltaY;
    if (event.shiftKey && !x) { x = y; y = 0; }
    const unitX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? main.clientWidth : 1;
    const unitY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? main.clientHeight : 1;
    moveTo(target.x - x * unitX, target.y - y * unitY);
  }, { passive: false });

  const reset = () => { finishDrag({}); moveTo(0, 0); };
  main.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isControl(event.target)) return;
    const step = event.shiftKey ? 160 : 64;
    const keys = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (event.key === 'Home') { event.preventDefault(); reset(); }
    else if (keys[event.key]) {
      event.preventDefault();
      const [x, y] = keys[event.key];
      moveTo(target.x + x, target.y + y);
    }
  });

  main.addEventListener('focusin', event => {
    const item = event.target.closest('.site-item');
    if (!item) return;
    const rect = event.target.getBoundingClientRect();
    const viewport = main.getBoundingClientRect();
    const gutter = 24, bottom = viewport.bottom - gutter;
    const x = rect.left < viewport.left + gutter ? viewport.left + gutter - rect.left
      : rect.right > viewport.right - gutter ? viewport.right - gutter - rect.right : 0;
    const y = rect.top < viewport.top + gutter ? viewport.top + gutter - rect.top
      : rect.bottom > bottom ? bottom - rect.bottom : 0;
    // Overflow-hidden containers can still scroll when keyboard focus moves.
    main.scrollLeft = 0;
    main.scrollTop = 0;
    if (x || y) moveTo(camera.x + x, camera.y + y);
  });
  preference.addEventListener('change', () => { Object.assign(camera, target); resize(); });
  resize();
  return { resize };
}
