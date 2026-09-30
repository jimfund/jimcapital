import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { animatePenLink } from '../pen-link.js';

function setup({ reduced = false } = {}) {
  const dom = new JSDOM('<a href="https://one-word.jim.capital"><img></a>');
  const win = dom.window, link = win.document.querySelector('a');
  const pending = new Map();
  const media = new win.EventTarget();
  media.matches = reduced;
  win.matchMedia = () => media;
  let now = 0, id = 0, keyboard = false;
  win.performance.now = () => now;
  win.requestAnimationFrame = callback => { pending.set(++id, callback); return id; };
  win.cancelAnimationFrame = id => pending.delete(id);
  link.matches = selector => selector === ':focus-visible' && keyboard;
  animatePenLink(link);
  return {
    pending, media,
    frame: () => Math.abs(parseFloat(link.querySelector('img').style.transform.slice(11))) / 10,
    motion(value) { media.matches = value; media.dispatchEvent(new win.Event('change')); },
    advance(time) {
      now = time;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(time);
    },
    event(type, { pointerType = 'mouse', keyboardFocus = false } = {}) {
      keyboard = keyboardFocus;
      const event = new win.Event(type, { cancelable: true });
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      link.dispatchEvent(event);
      return event;
    },
    close: () => dom.window.close(),
  };
}

test('pen opens once on hover, holds, then plays backward to closed on leave', () => {
  const pen = setup();
  assert.equal(pen.frame(), 0);
  assert.equal(pen.pending.size, 0);
  pen.event('pointerenter');
  pen.advance(99); assert.equal(pen.frame(), 0);
  pen.advance(100); assert.equal(pen.frame(), 1);
  pen.advance(800); assert.equal(pen.frame(), 8);
  pen.advance(900); assert.equal(pen.frame(), 9);
  assert.equal(pen.pending.size, 0);
  pen.advance(5000); assert.equal(pen.frame(), 9);
  pen.event('pointerleave'); assert.equal(pen.frame(), 9);
  pen.advance(5099); assert.equal(pen.frame(), 9);
  pen.advance(5100); assert.equal(pen.frame(), 8);
  pen.advance(5800); assert.equal(pen.frame(), 1);
  pen.advance(5900); assert.equal(pen.frame(), 0);
  assert.equal(pen.pending.size, 0);
  pen.advance(9000); assert.equal(pen.frame(), 0);
  pen.close();
});

test('leaving mid-opening and re-entering mid-closing reverse from the visible frame', () => {
  const pen = setup();
  pen.event('pointerenter'); pen.advance(350);
  assert.equal(pen.frame(), 3);
  pen.event('pointerleave');
  assert.equal(pen.frame(), 3);
  assert.equal(pen.pending.size, 1);
  pen.advance(450); assert.equal(pen.frame(), 2);
  pen.event('pointerenter'); assert.equal(pen.frame(), 2);
  assert.equal(pen.pending.size, 1);
  pen.advance(550); assert.equal(pen.frame(), 3);
  pen.event('pointercancel');
  assert.equal(pen.frame(), 3);
  pen.advance(850);
  assert.equal(pen.frame(), 0);
  assert.equal(pen.pending.size, 0);
  pen.close();
});

test('keyboard focus opens the pen; pointer focus cannot keep it open after leave', () => {
  const pen = setup();
  pen.event('focus', { keyboardFocus: true }); pen.advance(900);
  assert.equal(pen.frame(), 9);
  pen.event('blur'); assert.equal(pen.frame(), 9);
  pen.advance(1000); assert.equal(pen.frame(), 8);
  pen.advance(1800); assert.equal(pen.frame(), 0);
  pen.event('pointerenter');
  pen.event('focus');
  pen.advance(2700); assert.equal(pen.frame(), 9);
  assert.equal(pen.event('pointerdown').defaultPrevented, false);
  assert.equal(pen.event('click').defaultPrevented, false);
  pen.event('pointerleave'); assert.equal(pen.frame(), 9);
  pen.advance(3600); assert.equal(pen.frame(), 0);
  pen.event('pointerenter', { pointerType: 'touch' });
  assert.equal(pen.pending.size, 0);
  pen.close();
});

test('enabling reduced motion mid-closing completes the closure immediately', () => {
  const pen = setup();
  pen.event('pointerenter'); pen.advance(900);
  pen.event('pointerleave'); pen.advance(1100);
  assert.equal(pen.frame(), 7);
  pen.motion(true);
  assert.equal(pen.frame(), 0);
  assert.equal(pen.pending.size, 0);
  pen.close();
});

test('reduced motion shows the open frame immediately and stops any running animation', () => {
  const pen = setup({ reduced: true });
  pen.event('pointerenter');
  assert.equal(pen.frame(), 9);
  assert.equal(pen.pending.size, 0);
  pen.event('pointerleave'); assert.equal(pen.frame(), 0);
  pen.motion(false);
  pen.event('pointerenter'); pen.advance(400);
  assert.equal(pen.frame(), 4);
  pen.motion(true);
  assert.equal(pen.frame(), 9);
  assert.equal(pen.pending.size, 0);
  pen.event('pointerleave'); assert.equal(pen.frame(), 0);
  pen.close();
});
