import test from 'node:test';
import assert from 'node:assert/strict';
import { stepSpin, releaseVelocity, clickSpin } from '../market-clock-physics.js';

function settle(angle, velocity, fps = 60) {
  let state = { angle, velocity, target: null };
  for (let i = 0; i < fps * 10 && !state.done; i++) state = stepSpin(state, 1 / fps);
  assert.ok(state.done, 'motion must stop, with no permanent animation loop');
  assert.equal(Math.abs(state.angle % 180), 0);
  return state;
}

test('a flick coasts in the release direction and loses angular speed', () => {
  for (const direction of [-1, 1]) {
    const next = stepSpin({ angle: 0, velocity: 900 * direction, target: null }, 1 / 60);
    assert.equal(Math.sign(next.angle), direction);
    assert.ok(Math.abs(next.velocity) < 900);
    assert.ok(Math.abs(settle(0, 900 * direction).angle) >= 360);
  }
});
test('slow releases settle with the nearest face readable', () => {
  assert.equal(settle(170, 0).angle, 180);
  assert.equal(settle(35, 0).angle, 0);
  assert.equal(settle(355, 0).angle, 360);
});
test('frame rate does not change which face a flick settles on', () => {
  for (const speed of [150, 600, 1200, -900]) {
    assert.equal(settle(25, speed, 60).angle, settle(25, speed, 144).angle);
  }
});
test('velocity uses recent movement and a held pointer does not fling', () => {
  const samples = [{angle:0,time:0}, {angle:45,time:50}, {angle:90,time:100}];
  assert.equal(releaseVelocity(samples, 100), 900);
  assert.equal(releaseVelocity([...samples, {angle:90,time:250}], 250), 0);
  assert.equal(releaseVelocity([{angle:90,time:0},{angle:0,time:50}],50), -1440);
});
test('resuming after a stalled frame cannot jump through multiple revolutions', () => {
  const state = { angle: 0, velocity: 900, target: null };
  assert.deepEqual(stepSpin(state, 30), stepSpin(state, .05));
});


test('clicks spin at least one revolution and always land on the opposite face', () => {
  for (const angle of [0, 180, 360, -180, 35, 160, 280]) {
    let state = clickSpin(angle);
    const destination = state.destination;
    assert.ok(destination - angle >= 450);
    for (let i = 0; i < 600 && !state.done; i++) state = stepSpin(state, 1 / 60);
    assert.ok(state.done);
    assert.equal(state.angle, destination);
    assert.equal(Math.abs(Math.round(angle / 180) - state.angle / 180) % 2, 1);
  }
});
