import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/vendor/three/three.module.min.js';
import { createFlapDisplay } from '../market-clock-flaps.js';
import { FLAP_LIMIT, stepFlap } from '../market-clock-flap-physics.js';

const upright = { y: -1, z: 0 }, down = { y: 0, z: 1 };
const seated = () => ({ angle: 0, velocity: 0, latched: true });
function simulate(state, gravity, seconds, options = {}, rate = 60) {
  for (let i = 0; i < seconds * rate; i++) state = stepFlap(state, 1 / rate, gravity, options);
  return state;
}

test('retainers hold through hover tilt; face-down panels fall, hit stops, and go idle', () => {
  for (const side of [1, -1]) {
    const options = { side };
    const hover = simulate(seated(), { y: -.994, z: .045 }, 1, options);
    assert.equal(hover.angle, 0); assert.equal(hover.latched, true);
    const started = stepFlap(hover, 1 / 60, down, options);
    assert.ok(started.angle > 0 && started.angle < .1);
    assert.ok(started.velocity > 0);
    const hanging = simulate(started, down, 3, options);
    assert.equal(hanging.angle, FLAP_LIMIT);
    assert.equal(hanging.moving, false);
    const returning = stepFlap(hanging, 1 / 60, upright, options);
    assert.ok(returning.angle > 1 && returning.angle < hanging.angle);
    assert.ok(returning.velocity < 0);
    const caught = simulate(returning, upright, 3, options);
    assert.equal(caught.angle, 0); assert.equal(caught.latched, true);
    assert.equal(caught.moving, false);
    const slightlyTilted = simulate(hanging, { y: -.98, z: .19 }, 3, options);
    assert.equal(slightlyTilted.angle, 0); assert.equal(slightlyTilted.latched, true);
  }
});

test('gravity direction matters and free panels retain momentum through a reversal', () => {
  assert.equal(simulate(seated(), { y: 0, z: -1 }, 2).angle, 0);
  assert.equal(simulate(seated(), { y: 1, z: 0 }, 3, { side: 1 }).angle, 0);
  assert.equal(simulate(seated(), { y: 1, z: 0 }, 3, { side: -1 }).angle, FLAP_LIMIT);
  const moving = simulate(seated(), down, .1);
  const reversal = stepFlap(moving, 1 / 240, { y: 0, z: -1 });
  assert.ok(reversal.angle > moving.angle, 'momentum prevents an instantaneous reversal');
  assert.ok(reversal.velocity < moving.velocity);
});

test('hinge integration is stable across frame rates, pauses, and rapid changes of orientation', () => {
  const at60 = simulate(seated(), { y: -.5, z: .866 }, .5, {}, 60);
  const at120 = simulate(seated(), { y: -.5, z: .866 }, .5, {}, 120);
  assert.ok(Math.abs(at60.angle - at120.angle) < .005);
  let state = seated();
  for (let i = 0; i < 600; i++) {
    const angle = i * .12;
    state = stepFlap(state, i % 50 === 0 ? 30 : 1 / 60, { y: -Math.cos(angle), z: Math.sin(angle) });
    assert.ok(Number.isFinite(state.angle) && Number.isFinite(state.velocity));
    assert.ok(state.angle >= 0 && state.angle <= FLAP_LIMIT);
  }
});

function displayFixture(t) {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ fillRect() {}, fillText() {}, drawImage() {} }),
  }) };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  let reduced = false, now = 0;
  const parent = new THREE.Group();
  const display = createFlapDisplay(parent, { invalidate() {}, reducedMotion: () => reduced });
  const group = parent.getObjectByName('hinged-countdowns');
  display.update([{ countdown: '5h 30m' }, { countdown: '9h 30m' }], now);
  display.animate(now);
  return {
    parent, display, group,
    get now() { return now; },
    advance(ms) {
      const until = now + ms;
      let active;
      while (now < until) { now = Math.min(until, now + 1000 / 60); active = display.animate(now); }
      return active;
    },
    reduce() { reduced = true; return display.animate(now); },
  };
}

test('character feeds still reveal the new lower half and finish at the true value', t => {
  const f = displayFixture(t);
  assert.equal(f.group.children.length, 12);
  const cell = f.group.children[4], pivot = cell.getObjectByName('feed-hinge');
  const oldBottom = cell.getObjectByName('bottom-face').material;
  f.display.update([{ countdown: '5h 29m' }, { countdown: '9h 30m' }], f.now);
  assert.equal(f.advance(240), true);
  assert.ok(pivot.visible && pivot.rotation.x > 0 && pivot.rotation.x < Math.PI / 2);
  assert.equal(cell.getObjectByName('bottom-face').material, oldBottom);
  assert.equal(f.group.children[0].getObjectByName('feed-hinge').visible, false);
  f.advance(370);
  assert.ok(pivot.rotation.x > Math.PI / 2 && pivot.rotation.x < Math.PI);
  const front = cell.getObjectByName('old-top'), reverse = cell.getObjectByName('new-bottom');
  assert.equal(reverse.material.side, THREE.BackSide);
  assert.notEqual(front.geometry.attributes.uv.getY(0), reverse.geometry.attributes.uv.getY(0));
  assert.equal(f.advance(1000), false);
  assert.notEqual(cell.getObjectByName('bottom-face').material, oldBottom);
  assert.equal(pivot.visible, false);
});

test('actual digit panels follow world gravity, queue changes while hanging, and visibly recatch', t => {
  const f = displayFixture(t), cell = f.group.children[4];
  const top = cell.getObjectByName('top-hinge'), bottom = cell.getObjectByName('bottom-hinge');
  const oldFace = cell.getObjectByName('top-face').material;
  const outer = new THREE.Group(); outer.add(f.parent); outer.rotation.x = Math.PI / 2;
  assert.equal(f.advance(200), true);
  assert.ok(top.rotation.x > .2 && bottom.rotation.x < -.2);
  assert.equal(f.advance(3000), false);
  f.display.update([{ countdown: '5h 29m' }, { countdown: '9h 30m' }], f.now);
  f.advance(500);
  assert.equal(cell.getObjectByName('top-face').material, oldFace);
  assert.equal(cell.getObjectByName('feed-hinge').visible, false);
  outer.rotation.x = 0;
  f.advance(16);
  assert.ok(top.rotation.x > 1, 'returning upright must not teleport panels closed');
  assert.equal(f.advance(4000), false);
  assert.equal(top.rotation.x, 0); assert.equal(Math.abs(bottom.rotation.x), 0);
  assert.notEqual(cell.getObjectByName('top-face').material, oldFace);
});

test('row-length changes preserve hinge motion; reduced motion seats panels and applies pending values', t => {
  const f = displayFixture(t);
  f.parent.rotation.x = Math.PI / 2;
  f.advance(200);
  const angle = f.group.children[0].getObjectByName('top-hinge').rotation.x;
  f.display.update([{ countdown: '59m' }, { countdown: 'UNKNOWN' }], f.now);
  assert.equal(f.group.children.length, 10);
  assert.equal(f.group.children[0].getObjectByName('top-hinge').rotation.x, angle);
  f.display.update([{ countdown: '58m' }, { countdown: 'UNKNOWN' }], f.now);
  const oldFace = f.group.children[1].getObjectByName('bottom-face').material;
  assert.equal(f.reduce(), false);
  assert.notEqual(f.group.children[1].getObjectByName('bottom-face').material, oldFace);
  for (const cell of f.group.children) {
    assert.equal(cell.getObjectByName('top-hinge').rotation.x, 0);
    assert.equal(cell.getObjectByName('bottom-hinge').rotation.x, 0);
    assert.equal(cell.getObjectByName('feed-hinge').visible, false);
  }
});
