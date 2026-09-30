import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/vendor/three/three.module.min.js';
import { createFlapDisplay } from '../market-clock-flaps.js';

test('real hinged leaves reveal the new bottom on their reverse and settle to the true countdown', () => {
  const previousDocument = globalThis.document;
  // Canvas pixel drawing is inspected separately; this checks the actual 3D meshes and motion.
  globalThis.document = { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ fillRect() {}, fillText() {}, drawImage() {} }),
  }) };
  try {
    let reduced = false;
    const parent = new THREE.Group();
    const display = createFlapDisplay(parent, { invalidate() {}, reducedMotion: () => reduced });
    const original = [{ countdown: '5h 30m' }, { countdown: '9h 30m' }];
    display.update(original, 0);
    assert.equal(display.animate(2000), false);
    const group = parent.getObjectByName('hinged-countdowns');
    assert.equal(group.children.length, 12);
    const cell = group.children[4], pivot = cell.getObjectByName('hinge');
    const oldBottom = cell.getObjectByName('fixed-bottom').material;
    display.update([{ countdown: '5h 29m' }, original[1]], 2100);
    assert.equal(display.animate(2300), true);
    assert.ok(pivot.visible && pivot.rotation.x > 0 && pivot.rotation.x < Math.PI / 2);
    assert.equal(cell.getObjectByName('fixed-bottom').material, oldBottom);
    assert.equal(group.children[0].getObjectByName('hinge').visible, false);
    display.animate(2670);
    assert.ok(pivot.rotation.x > Math.PI / 2 && pivot.rotation.x < Math.PI);
    const front = cell.getObjectByName('old-top');
    const reverse = cell.getObjectByName('new-bottom');
    assert.equal(reverse.material.side, THREE.BackSide);
    assert.notEqual(front.geometry.attributes.uv.getY(0), reverse.geometry.attributes.uv.getY(0));
    assert.equal(display.animate(4000), false);
    assert.notEqual(cell.getObjectByName('fixed-bottom').material, oldBottom);
    assert.equal(pivot.visible, false);
    display.update([{ countdown: '59m' }, { countdown: 'UNKNOWN' }], 4100);
    assert.equal(group.children.length, 10);
    assert.equal(display.animate(6000), false);
    display.replay(6100);
    assert.equal(display.animate(6350), true);
    reduced = true;
    assert.equal(display.animate(6360), false);
    assert.ok(group.children.every(cell => !cell.getObjectByName('hinge').visible));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
