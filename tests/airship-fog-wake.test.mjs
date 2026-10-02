import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createWakeField, createFogWake, WIND_LIMITS } from '../airship-fog-wake.js';

const isNeutral = field => field.data.every((value, index) => value === (index % 4 === 3 ? 255 : 128));
const sample = (field, x, y) => {
 const offset = (Math.floor(y * field.height) * field.width + Math.floor(x * field.width)) * 4;
 return [WIND_LIMITS.x, WIND_LIMITS.y, WIND_LIMITS.density].map((scale, i) => (field.data[offset + i] - 128) / 127 * scale);
};
const run = (field, frames) => { for (let i = 0; i < frames; i++) field.advance(1 / 30); };

test('a sweep pushes fog in its direction and rolls the shoulders back around the gust', () => {
 const field = createWakeField();
 field.stroke([.2, .5], [.7, .5], 640, 382, .15); run(field, 5);
 assert.ok(sample(field, .5, .5)[0] > .03, 'the core moves with the pointer');
 assert.ok(sample(field, .5, .68)[0] < 0, 'the outer shoulder rolls back');
 assert.ok(sample(field, .75, .64)[1] > .01, 'lower mist curls around the leading edge');
 assert.ok(sample(field, .75, .36)[1] < -.01, 'upper mist curls the opposite way');
 assert.deepEqual(sample(field, .5, .9), [0, 0, 0]);
 assert.equal(field.consumeChanges(), true); assert.equal(field.consumeChanges(), false);
});

test('reversing direction reverses the wind, and vertical movement pushes vertically', () => {
 const left = createWakeField(), up = createWakeField();
 left.stroke([.8, .5], [.3, .5], 640, 382, .15); run(left, 5);
 up.stroke([.5, .8], [.5, .2], 640, 382, .15); run(up, 5);
 assert.ok(sample(left, .5, .5)[0] < -.03);
 assert.ok(sample(up, .5, .5)[1] < -.03);
 assert.ok(Math.abs(sample(up, .5, .5)[0]) < .005);
});

test('moving mist gathers ahead of the gust and thins behind, without cutting out the fog', () => {
 const field = createWakeField();
 field.stroke([.2, .5], [.7, .5], 640, 382, .15); run(field, 8);
 const density = [];
 for (let i = 2; i < field.data.length; i += 4) density.push(1 + (field.data[i] - 128) / 127 * WIND_LIMITS.density);
 assert.ok(Math.min(...density) < .95);
 assert.ok(Math.min(...density) >= .61, 'no part of the volume is erased');
 assert.ok(Math.max(...density) > 1.05, 'pushed mist also becomes denser');
 assert.ok(Math.abs(density.reduce((a, b) => a + b, 0) / density.length - 1) < .02);
});

test('gusts retain momentum after input stops, then settle completely with no idle updates', () => {
 const field = createWakeField();
 assert.equal(field.consumeChanges(), false);
 field.stroke([.2, .5], [.7, .5], 640, 382, .15); run(field, 1);
 const initial = sample(field, .5, .5)[0];
 run(field, 14); const coasting = sample(field, .5, .5)[0];
 assert.ok(coasting > initial * 3, 'fog keeps moving after the cursor stops');
 run(field, 60); assert.ok(sample(field, .5, .5)[0] < coasting);
 run(field, 300); assert.ok(isNeutral(field));
 field.consumeChanges(); run(field, 30); assert.equal(field.consumeChanges(), false);
});

test('fast sweeps can cross the whole surface, while stationary or distant pointers do nothing', () => {
 const field = createWakeField();
 field.stroke([-1, .5], [2, .5], 640, 382, .1); run(field, 3);
 assert.ok(sample(field, .1, .5)[0] > 0); assert.ok(sample(field, .9, .5)[0] > 0);
 const untouched = createWakeField();
 untouched.stroke([.5, .5], [.5, .5], 640, 382);
 untouched.stroke([-2, -2], [-1, -1], 640, 382); run(untouched, 3);
 assert.equal(untouched.consumeChanges(), false); assert.ok(isNeutral(untouched));
});

test('wind retains its size in screen pixels as the ship is scaled', () => {
 for (const [width, height] of [[640, 382], [1280, 764]]) {
  const field = createWakeField();
  field.stroke([.5 - 40 / width, .5], [.5 + 40 / width, .5], width, height, .1); run(field, 5);
  assert.ok(sample(field, .5, .5)[0] * width > 3);
  assert.ok(sample(field, .5, .5 + 65 / height)[0] < 0);
  assert.deepEqual(sample(field, .5, .5 + 135 / height), [0, 0, 0]);
 }
});

function setup(t) {
 const dom = new JSDOM('<section><canvas></canvas><a href="/graphs">Price history</a></section>', { pretendToBeVisual: true });
 t.after(() => dom.window.close());
 const { window: view } = dom, doc = view.document, surface = doc.querySelector('canvas');
 let rect = { left: 120, top: 80, width: 640, height: 382 }, reads = 0, stamp = 0;
 surface.getBoundingClientRect = () => { reads++; return rect; };
 const wake = createFogWake(surface); t.after(() => wake.destroy());
 const move = (x, y, type = 'mouse', target = doc, elapsed = 16) => {
  const event = new view.MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true, cancelable: true });
  stamp += elapsed;
  Object.defineProperties(event, { pointerType: { value: type }, timeStamp: { value: stamp } });
  target.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
 };
 return { view, doc, surface, wake, move, setRect: value => { rect = value; }, reads: () => reads };
}

test('wind follows transformed bounds over price links without intercepting input or idle layout reads', t => {
 const { doc, wake, move, setRect, reads } = setup(t);
 assert.equal(wake.update(0), false); assert.equal(reads(), 0);
 setRect({ left: 240, top: 160, width: 640, height: 382 });
 move(368, 351, 'mouse', doc.querySelector('a')); move(688, 351);
 assert.equal(wake.update(.1), true); assert.equal(reads(), 1);
 assert.ok(sample(wake, .5, .5)[0] > .01); assert.deepEqual(sample(wake, .5, .1), [0, 0, 0]);
 wake.update(.2); assert.equal(reads(), 1);
 assert.equal(doc.querySelector('a').getAttribute('href'), '/graphs');
});

test('touch, pointer arrival, and reentry after leaving or a long pause do not invent wind', t => {
 const { doc, view, wake, move } = setup(t);
 move(440, 271, 'touch'); assert.equal(wake.update(.1), false);
 move(184, 271); assert.equal(wake.update(.2), false);
 doc.dispatchEvent(new view.MouseEvent('pointerout', { relatedTarget: null }));
 move(696, 271); assert.equal(wake.update(.3), false);
 move(184, 271, 'mouse', doc, 500); assert.equal(wake.update(.4), false);
 assert.ok(isNeutral(wake));
});

test('panning under a resting pointer does not manufacture wind', t => {
 const { wake, move, setRect } = setup(t);
 move(440, 271); wake.update(.1);
 setRect({ left: 240, top: 160, width: 640, height: 382 });
 move(440, 271); assert.equal(wake.update(.2), false); assert.ok(isNeutral(wake));
});

test('hidden tabs release old gusts and renderer destruction removes input listeners', t => {
 const { doc, view, wake, move, reads } = setup(t);
 move(248, 271); move(568, 271); wake.update(.1); assert.ok(!isNeutral(wake));
 Object.defineProperty(doc, 'hidden', { value: true }); doc.dispatchEvent(new view.Event('visibilitychange'));
 assert.equal(wake.update(.2), true); assert.ok(isNeutral(wake));
 const before = reads(); wake.destroy(); move(440, 271);
 assert.equal(wake.update(.3), false); assert.equal(reads(), before);
});
