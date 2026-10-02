import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { canvasGeometry, mountCanvasView } from '../canvas-view.js';

function fixture(t, reduced = false) {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { document: doc } = dom.window;
  const main = doc.querySelector('main');
  const size = { width: 1200, height: 850 };
  Object.defineProperties(main, {
    clientWidth: { get: () => size.width }, clientHeight: { get: () => size.height },
  });
  main.getBoundingClientRect = () => ({ left: 0, top: 0, right: size.width, bottom: size.height });
  let captured;
  main.setPointerCapture = id => { captured = id; };
  main.hasPointerCapture = id => captured === id;
  main.releasePointerCapture = () => { captured = undefined; };
  let changePreference;
  const preference = { matches: reduced, addEventListener: (_, callback) => { changePreference = callback; } };
  dom.window.matchMedia = () => preference;
  let queue = [], time = 1, calls = 0;
  dom.window.requestAnimationFrame = callback => { queue.push(callback); return ++calls; };
  function flush() {
    for (let count = 0; queue.length; count++) {
      assert.ok(count < 150, 'the canvas must stop requesting frames once motion settles');
      const pending = queue; queue = []; time += 16;
      pending.forEach(callback => callback(time));
    }
  }
  const items = new Map();
  const layout = { items: {} };
  for (const [id, x, y, content] of [
    ['angel', 420, 78, '<div class="angel-window"><img alt=""></div>'],
    ['ai-ticker', 704, 20, '<a href="#prices">Prices</a>'],
    ['clock', 58, 344, '<button type="button">Spin</button>'],
    ['softbank', 111, 156, '<svg tabindex="0" role="slider"></svg>'],
    ['10d61a37-3bd9-42c1-b303-6ab3f92251db', 110, 100, '<canvas></canvas>'],
  ]) {
    const element = doc.createElement('div');
    element.className = 'site-item'; element.dataset.item = id; element.innerHTML = content;
    main.append(element);
    Object.defineProperty(element, 'offsetHeight', { value: 240 });
    items.set(id, { element, nativeWidth: 300 });
    layout.items[id] = { x, y, width: 220, z: 2 };
  }
  const controller = mountCanvasView(main, items, () => layout);
  const position = id => {
    const transform = items.get(id).element.style.transform;
    return transform.match(/translate3d\(([^p]+)px, ([^p]+)px/).slice(1).map(Number);
  };
  const pointer = (type, x, y, target = main, options = {}) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperties(event, {
      pointerId: { value: options.id ?? 1 }, isPrimary: { value: options.primary ?? true }, pointerType: { value: options.type ?? 'mouse' },
    });
    target.dispatchEvent(event);
    return event;
  };
  const wheel = options => {
    const event = new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
    main.dispatchEvent(event); flush(); return event;
  };
  const key = (key, target = main, options = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event); flush(); return event;
  };
  return { main, doc, items, position, pointer, wheel, key, flush, controller, size,
    reset: () => { doc.querySelector('.canvas-navigation button').click(); flush(); },
    reduce: value => { preference.matches = value; changePreference(); flush(); },
  };
}

test('desktop starts with the scene in view, while phone objects stay large enough to explore', () => {
  const rects = [{ x: 58, y: 6, width: 1134, height: 750 }];
  const desktop = canvasGeometry(rects, 1440, 1000);
  assert.equal(desktop.scale, 1);
  assert.ok(desktop.x + 58 > 0);
  assert.ok(desktop.x + 1192 < 1440);
  const phone = canvasGeometry(rects, 390, 844);
  assert.equal(phone.scale, .55);
  assert.ok(rects[0].width * phone.scale > 390, 'the phone view can pan across the wider scene');
  assert.ok(Number.isFinite(canvasGeometry([], 0, 0).scale));
});

test('mouse and touch drags move both axes with different depths; reset restores the starting view', t => {
  for (const type of ['mouse', 'touch']) {
    const f = fixture(t);
    const angel = f.position('angel'), ship = f.position('ai-ticker');
    f.pointer('pointerdown', 400, 300, f.main, { type });
    f.pointer('pointermove', 500, 350, f.main, { type }); f.flush();
    f.pointer('pointerup', 500, 350, f.main, { type });
    assert.ok(Math.abs(f.position('angel')[0] - angel[0] - 68) < .001);
    assert.ok(Math.abs(f.position('angel')[1] - angel[1] - 34) < .001);
    assert.ok(Math.abs(f.position('ai-ticker')[0] - ship[0] - 120) < .001);
    assert.equal(f.main.classList.contains('is-panning'), false);
    assert.equal(f.doc.querySelector('button[aria-label="Reset canvas view"]').disabled, false);
    f.reset();
    assert.deepEqual(f.position('angel'), angel);
    assert.deepEqual(f.position('ai-ticker'), ship);
    assert.equal(f.doc.querySelector('button[aria-label="Reset canvas view"]').disabled, true);
  }
});

test('wheel and trackpad movement preserve chart alignment and support horizontal scrolling', t => {
  const f = fixture(t);
  const chart = f.position('softbank'), ink = f.position('10d61a37-3bd9-42c1-b303-6ab3f92251db');
  assert.equal(f.wheel({ deltaX: 40, deltaY: 80 }).defaultPrevented, true);
  const chartMove = f.position('softbank').map((value, i) => value - chart[i]);
  const inkMove = f.position('10d61a37-3bd9-42c1-b303-6ab3f92251db').map((value, i) => value - ink[i]);
  chartMove.forEach((value, i) => assert.ok(Math.abs(value - inkMove[i]) < .001));
  assert.ok(chartMove[0] < 0 && chartMove[1] < 0);
  f.reset();
  f.wheel({ deltaY: 3, deltaMode: 1, shiftKey: true });
  assert.ok(Math.abs(f.position('softbank')[0] - chart[0] + 48 * .94) < .001);
  assert.equal(f.position('softbank')[1], chart[1]);
});

test('links, the clock, chart scrubbing, and browser zoom keep their native interactions', t => {
  const f = fixture(t);
  const start = f.position('angel');
  for (const control of f.main.querySelectorAll('a, button, svg')) {
    assert.equal(f.pointer('pointerdown', 10, 10, control).defaultPrevented, false);
    f.pointer('pointermove', 100, 100, control); f.flush();
    assert.equal(f.key('ArrowRight', control).defaultPrevented, false);
  }
  assert.equal(f.wheel({ deltaY: 100, ctrlKey: true }).defaultPrevented, false);
  assert.deepEqual(f.position('angel'), start);
});

test('keyboard panning is bounded and Home returns to the complete starting composition', t => {
  const f = fixture(t);
  const start = f.position('angel');
  assert.equal(f.key('ArrowRight').defaultPrevented, true);
  assert.ok(f.position('angel')[0] < start[0]);
  f.wheel({ deltaX: 1e6, deltaY: 1e6 });
  const edge = f.position('angel');
  f.wheel({ deltaX: 1e6, deltaY: 1e6 });
  assert.deepEqual(f.position('angel'), edge);
  f.key('Home');
  assert.deepEqual(f.position('angel'), start);
});

test('reduced motion moves all objects together and can change while the canvas is open', t => {
  const f = fixture(t, true);
  const angel = f.position('angel'), ship = f.position('ai-ticker');
  f.wheel({ deltaX: 80, deltaY: 40 });
  for (const [id, initial] of [['angel', angel], ['ai-ticker', ship]]) {
    assert.deepEqual(f.position(id).map((v, i) => v - initial[i]), [-80, -40]);
  }
  f.reduce(false);
  assert.notEqual(f.position('angel')[0] - angel[0], f.position('ai-ticker')[0] - ship[0]);
  f.reset();
  assert.deepEqual(f.position('angel'), angel);
});

test('the angel shifts behind its frame without exposing an empty edge and respects reduced motion', t => {
  const f = fixture(t);
  const image = f.main.querySelector('.angel-window img');
  f.wheel({ deltaX: 100, deltaY: 80 });
  assert.equal(image.style.transform, 'translate3d(5px, 4px, 0) scale(1.16)');
  f.wheel({ deltaX: 1e6, deltaY: 1e6 });
  assert.equal(image.style.transform, 'translate3d(12px, 18px, 0) scale(1.16)');
  f.reduce(true);
  assert.equal(image.style.transform, 'translate3d(0px, 0px, 0) scale(1.16)');
});

test('canceled drags release capture and secondary touch pointers do not move the view', t => {
  const f = fixture(t);
  const start = f.position('angel');
  f.pointer('pointerdown', 10, 10);
  f.pointer('pointermove', 200, 200, f.main, { id: 2, primary: false }); f.flush();
  assert.deepEqual(f.position('angel'), start);
  f.pointer('pointercancel', 10, 10);
  assert.equal(f.main.hasPointerCapture(1), false);
  f.pointer('pointermove', 200, 200); f.flush();
  assert.deepEqual(f.position('angel'), start);
});

test('tabbing to an offscreen control brings it back into view, including after resize', t => {
  const f = fixture(t);
  f.size.width = 390; f.size.height = 700; f.controller.resize();
  const link = f.main.querySelector('a');
  const start = f.position('ai-ticker');
  link.getBoundingClientRect = () => ({ left: 500, right: 560, top: 100, bottom: 130 });
  link.focus(); f.flush();
  assert.ok(Math.abs(f.position('ai-ticker')[0] - start[0] + 194) < .001);
  assert.equal(f.main.scrollLeft, 0);
  assert.equal(f.main.scrollTop, 0);
});
