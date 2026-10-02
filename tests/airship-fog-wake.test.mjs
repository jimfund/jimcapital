import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createWakeField, createFogWake } from '../airship-fog-wake.js';

const sample = (field, x, y) => field.data[Math.floor(y * field.height) * field.width + Math.floor(x * field.width)];

test('a fast sweep clears a continuous path with soft edges and leaves distant fog alone', () => {
 const field = createWakeField();
 field.stroke([.1, .5], [.9, .5], 640, 382);
 for (const x of [.1, .2, .3, .4, .5, .6, .7, .8, .9]) assert.ok(sample(field, x, .5) > 250);
 assert.ok(sample(field, .5, .56) > 0 && sample(field, .5, .56) < 230);
 assert.equal(sample(field, .5, .8), 0);
 assert.equal(field.consumeChanges(), true); assert.equal(field.consumeChanges(), false);
});

test('a sweep crossing the whole fog is clipped correctly even when both endpoints are outside', () => {
 const field = createWakeField();
 field.stroke([-1, .5], [2, .5], 640, 382);
 assert.ok(sample(field, .05, .5) > 250); assert.ok(sample(field, .95, .5) > 250);
 const untouched = createWakeField();
 untouched.stroke([-2, -2], [-1, -1], 640, 382);
 assert.equal(untouched.consumeChanges(), false); assert.ok(untouched.data.every(value => value === 0));
});

test('the fog gradually returns, fully settles, and has no idle updates', () => {
 const field = createWakeField();
 assert.equal(field.consumeChanges(), false);
 field.stroke([.5, .5], [.5, .5], 640, 382); field.consumeChanges();
 const initial = sample(field, .5, .5);
 field.fade(.5); const recovering = sample(field, .5, .5);
 assert.ok(recovering > 40 && recovering < initial);
 assert.equal(field.consumeChanges(), true);
 field.fade(8); assert.ok(field.data.every(value => value === 0)); assert.equal(field.consumeChanges(), true);
 field.fade(1); assert.equal(field.consumeChanges(), false);
});

test('the brush stays round in screen pixels when the ship is scaled', () => {
 for (const [width, height] of [[640, 382], [1280, 764]]) {
  const field = createWakeField();
  field.stroke([.5, .5], [.5, .5], width, height);
  assert.ok(sample(field, .5 + 15 / width, .5) > 100);
  assert.ok(sample(field, .5, .5 + 15 / height) > 100);
  assert.equal(sample(field, .5 + 55 / width, .5), 0);
  assert.equal(sample(field, .5, .5 + 55 / height), 0);
 }
});

function setup(t) {
 const dom = new JSDOM('<section><canvas></canvas><a href="/graphs">Price history</a></section>', { pretendToBeVisual: true });
 t.after(() => dom.window.close());
 const { window: view } = dom, doc = view.document, surface = doc.querySelector('canvas');
 let rect = { left: 120, top: 80, width: 640, height: 382 }, reads = 0;
 surface.getBoundingClientRect = () => { reads++; return rect; };
 const wake = createFogWake(surface); t.after(() => wake.destroy());
 const move = (x, y, type = 'mouse', target = doc) => {
  const event = new view.MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: type });
  target.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
 };
 return { view, doc, surface, wake, move, setRect: value => { rect = value; }, reads: () => reads };
}

test('pointer movement over price links clears fog using its current transformed bounds without intercepting input', t => {
 const { doc, wake, move, setRect, reads } = setup(t);
 assert.equal(wake.update(0), false); assert.equal(reads(), 0);
 setRect({ left: 240, top: 160, width: 640, height: 382 });
 move(304, 351, 'mouse', doc.querySelector('a')); move(816, 351);
 assert.equal(wake.update(.1), true); assert.equal(reads(), 1);
 assert.ok(sample(wake, .5, .5) > 250); assert.equal(sample(wake, .5, .1), 0);
 wake.update(.2); assert.equal(reads(), 1);
 assert.equal(doc.querySelector('a').getAttribute('href'), '/graphs');
});

test('touch input is ignored and returning from outside the window does not draw a connecting stripe', t => {
 const { doc, view, wake, move } = setup(t);
 move(440, 271, 'touch'); assert.equal(wake.update(.1), false);
 move(184, 271); wake.update(.2);
 doc.dispatchEvent(new view.MouseEvent('pointerout', { relatedTarget: null }));
 move(696, 271); wake.update(.3);
 assert.ok(sample(wake, .1, .5) > 0); assert.ok(sample(wake, .9, .5) > 250);
 assert.equal(sample(wake, .5, .5), 0);
});

test('hidden tabs clear old trails and destroying the renderer removes its input listeners', t => {
 const { doc, view, wake, move, reads } = setup(t);
 move(440, 271); wake.update(.1); assert.ok(wake.data.some(value => value > 0));
 Object.defineProperty(doc, 'hidden', { value: true }); doc.dispatchEvent(new view.Event('visibilitychange'));
 assert.equal(wake.update(.2), true); assert.ok(wake.data.every(value => value === 0));
 const before = reads(); wake.destroy(); move(440, 271);
 assert.equal(wake.update(.3), false); assert.equal(reads(), before);
});
