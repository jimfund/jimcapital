import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createFogRenderer, fogLightUniforms } from '../airship-fog.js';
import { createMarqueeRenderer } from '../airship-marquee.js';

function setup(t, { compile = true, smallArtwork = false } = {}) {
 const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), { pretendToBeVisual: true });
 t.after(() => dom.window.close());
 const view = dom.window, root = view.document.querySelector('.market-airship'), artwork = root.querySelector('img');
 artwork.decode = async () => {};
 Object.defineProperties(artwork, { naturalWidth: { value: smallArtwork ? 2 : 1672 }, naturalHeight: { value: smallArtwork ? 2 : 941 } });
 Object.defineProperty(root, 'clientWidth', { value: 1120, configurable: true });
 const state = { uniforms: {}, draws: 0, deleted: [], observers: [], frames: new Map() };
 let frameId = 0;
 view.requestAnimationFrame = fn => { state.frames.set(++frameId, fn); return frameId; };
 view.cancelAnimationFrame = id => state.frames.delete(id);
 view.ResizeObserver = class {
  constructor(callback) { this.callback = callback; state.observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
 };
 const constants = new Map(), methods = {
  getShaderParameter: () => compile, getProgramParameter: () => true, getShaderInfoLog: () => 'Shader unavailable',
  getUniformLocation: (_program, name) => name, getAttribLocation: () => 0,
  uniform1f: (name, value) => { state.uniforms[name] = value; },
  uniform1i: (name, value) => { state.uniforms[name] = value; },
  uniform4fv: (name, value) => { state.uniforms[name] = Array.from(value); },
  uniform3fv: (name, value) => { state.uniforms[name] = Array.from(value); },
  drawArrays: () => { state.draws++; },
  deleteTexture: value => state.deleted.push(value), deleteShader: value => state.deleted.push(value),
  deleteBuffer: value => state.deleted.push(value), deleteProgram: value => state.deleted.push(value),
 };
 const gl = new Proxy(methods, { get(target, key) {
  if (key in target) return target[key];
  if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
  return () => ({});
 } });
 const context2d = { drawImage() {}, putImageData() {}, getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) };
 t.mock.method(view.HTMLCanvasElement.prototype, 'getContext', kind => kind === '2d' ? context2d : gl);
 const step = time => { const frames = [...state.frames.values()]; state.frames.clear(); frames.forEach(fn => fn(time)); };
 return { dom, view, root, artwork, state, step };
}

test('homepage fog uses the approved density and scattering, with slower wind and full-speed marquee lamps', async t => {
 const { root, state } = setup(t), display = root.querySelector('.airship-display').outerHTML;
 const renderer = await createFogRenderer(root);
 t.after(() => renderer.destroy());
 assert.equal(state.uniforms.u_density, 1); assert.equal(state.uniforms.u_scatter, 2.5); assert.equal(state.uniforms.u_night, 0);
 renderer.render(10);
 assert.equal(state.uniforms.u_time, 7);
 assert.deepEqual(state.uniforms['u_lights[0]'], Array.from(fogLightUniforms(10).positions));
 const frozen = { ...state.uniforms }; renderer.render(10); assert.deepEqual(state.uniforms, frozen);
 const canvas = root.querySelector('.airship-fog');
 assert.equal(canvas.width, 640); assert.equal(canvas.height, 382); assert.equal(canvas.getAttribute('aria-hidden'), 'true');
 assert.equal(root.querySelector('.airship-display').outerHTML, display);
});

test('fog reuses lamp buffers while keeping changing intensities and fixed lamp geometry', () => {
 const lights = fogLightUniforms(0), positions = lights.positions, colours = lights.colours;
 const initial = Array.from(positions), result = fogLightUniforms(3, lights);
 assert.equal(result, lights); assert.equal(result.positions, positions); assert.equal(result.colours, colours);
 assert.deepEqual(result, fogLightUniforms(3)); assert.notDeepEqual(Array.from(positions), initial);
 for (let i = 0; i < positions.length; i++) if (i % 4 !== 3) assert.equal(positions[i], initial[i]);
});

test('repeated frames and unchanged resize notifications do not redraw or reset the fog', async t => {
 const { root, state } = setup(t), renderer = await createFogRenderer(root);
 t.after(() => renderer.destroy());
 const initial = state.draws;
 renderer.render(0); state.observers[0].callback(); assert.equal(state.draws, initial);
 renderer.render(1); assert.equal(state.draws, initial + 1);
 renderer.render(1); state.observers[0].callback(); assert.equal(state.draws, initial + 1);
 Object.defineProperty(root, 'clientWidth', { value: 680 }); state.observers[0].callback();
 assert.equal(root.querySelector('.airship-fog').width, 408); assert.equal(state.draws, initial + 2);
 assert.equal(state.uniforms.u_time, .7);
});

test('fog cancellation during image decoding never allocates graphics or adds an overlay', async t => {
 const { root, artwork, view } = setup(t); let resolve;
 artwork.decode = () => new Promise(done => { resolve = done; });
 t.mock.method(view.HTMLCanvasElement.prototype, 'getContext', () => { throw new Error('Must not allocate'); });
 const controller = new AbortController(), pending = createFogRenderer(root, { signal: controller.signal });
 controller.abort(); resolve(); assert.equal(await pending, undefined); assert.equal(root.querySelector('canvas'), null);
});

test('failed fog compilation cleans up without changing the ship or its prices', async t => {
 const { root, state } = setup(t, { compile: false }), before = root.innerHTML;
 await assert.rejects(createFogRenderer(root), /Shader unavailable/);
 assert.equal(root.innerHTML, before); assert.equal(state.deleted.length, 2);
});

test('losing the fog graphics context removes its overlay and releases resources once', async t => {
 const { root, view, state } = setup(t), renderer = await createFogRenderer(root);
 root.querySelector('.airship-fog').dispatchEvent(new view.Event('webglcontextlost', { cancelable: true }));
 const draws = state.draws, deleted = state.deleted.length;
 renderer.render(20); renderer.destroy();
 assert.equal(state.draws, draws); assert.equal(state.deleted.length, deleted); assert.equal(deleted, 6);
 assert.ok(state.observers.every(observer => observer.disconnected));
 assert.equal(root.querySelector('.airship-fog'), null); assert.equal(root.querySelectorAll('.ai-quote').length, 3);
});

test('marquee drives the fog clock, freezes it in hidden tabs and tears it down on cancellation', async t => {
 const { root, view, state, step } = setup(t, { smallArtwork: true });
 const times = []; let destroyed = 0;
 const controller = new AbortController();
 const renderer = await createMarqueeRenderer(root, { signal: controller.signal, startFog: async () => ({ render: time => times.push(time), destroy: () => destroyed++ }) });
 t.after(() => renderer.destroy());
 step(100); step(200); assert.equal(times.at(-1), .1);
 Object.defineProperty(view.document, 'hidden', { value: true, configurable: true });
 view.document.dispatchEvent(new view.Event('visibilitychange'));
 step(10200); assert.equal(times.at(-1), .1); assert.equal(state.frames.size, 0);
 Object.defineProperty(view.document, 'hidden', { value: false, configurable: true });
 view.document.dispatchEvent(new view.Event('visibilitychange'));
 step(10300); assert.equal(times.at(-1), .1);
 step(10400); assert.equal(times.at(-1), .2);
 controller.abort(); assert.equal(destroyed, 1); assert.equal(state.frames.size, 0); assert.equal(root.querySelector('canvas'), null);
});

test('a late fog initialization is discarded when the marquee has already stopped', async t => {
 const { root } = setup(t, { smallArtwork: true }); let finish, destroyed = 0;
 const renderer = await createMarqueeRenderer(root, { startFog: () => new Promise(resolve => { finish = resolve; }) });
 renderer.destroy(); finish({ render: () => { throw new Error('Must not render'); }, destroy: () => destroyed++ });
 await Promise.resolve(); assert.equal(destroyed, 1); assert.equal(root.querySelector('canvas'), null);
});

test('moving the ship offscreen pauses both renderers and returning resumes without a time jump', async t => {
 const { root, view, state, step } = setup(t, { smallArtwork: true });
 let notify, observed, disconnected = false;
 view.IntersectionObserver = class {
  constructor(callback) { notify = callback; }
  observe(element) { observed = element; }
  unobserve() {}
  disconnect() { disconnected = true; }
 };
 const fogSurface = view.document.createElement('canvas');
 const times = [], renderer = await createMarqueeRenderer(root, { startFog: async () => ({ surface: fogSurface, render: time => times.push(time), destroy() {} }) });
 t.after(() => renderer.destroy());
 assert.equal(observed, fogSurface); step(100); step(200);
 const draws = state.draws, updates = times.length;
 notify([{ target: root, isIntersecting: false }]); assert.equal(state.frames.size, 1);
 notify([{ target: fogSurface, isIntersecting: false }]); step(10200);
 assert.equal(state.draws, draws); assert.equal(times.length, updates); assert.equal(state.frames.size, 0);
 assert.ok(root.querySelector('.airship-lights'));
 view.document.dispatchEvent(new view.Event('visibilitychange')); assert.equal(state.frames.size, 0);
 notify([{ target: fogSurface, isIntersecting: true }]); step(10300); assert.equal(times.at(-1), .1);
 step(10400); assert.equal(times.at(-1), .2);
 renderer.destroy(); assert.equal(disconnected, true); assert.equal(state.frames.size, 0);
});
