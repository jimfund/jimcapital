import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mobileLayout, alphaBounds, artworkBounds } from '../mobile-layout.js';
import { defaultPosition } from '../layout-model.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const saved = read('../assets/layout.json');
const manifest = read('../assets/doodles.json');
function actualLayers(width) {
  const sizes = { prediction: [105, 125], angel: [220, 32 + 188 * 414 / 268],
    clock: [300, 300], 'one-word': [85, 85], softbank: [300, 24], 'uv-machine': [280, 230],
    'ai-ticker': [width, width * 941 / 1672] };
  const drawings = { monitor: read('../assets/monitor-doodle.json'),
    ...Object.fromEntries(manifest.ids.map(id => [id, read(`../assets/doodles/${id}.json`)])) };
  return [...Object.keys(sizes), ...Object.keys(drawings)].map(id => {
    const drawing = drawings[id];
    const [nativeWidth, nativeHeight] = sizes[id] || [400, 400 / (drawing.aspect || 4 / 3)];
    // The wide TV drawing contains erased strokes across its otherwise empty
    // canvas; the browser measures the rendered alpha, not those old strokes.
    const ink = id === 'beba7e25-b7b3-4fef-a49d-6f97b4f3a852' ? { x: 0, y: 0, width: .25, height: 1 }
      : id === 'f3dc2a29-877a-477a-9219-3ff9759f6e7d' ? { x: 0, y: 0, width: 0, height: 0 } : undefined;
    return { id, ...(saved.items[id] || defaultPosition(id, 0)), nativeWidth, nativeHeight, drawing, ink };
  });
}

test('the actual homepage artwork fits phone widths and stays readable without horizontal panning', () => {
  for (const viewportWidth of [320, 360, 390, 430, 600, 700]) {
    const width = Math.min(560, viewportWidth - 32);
    const layers = actualLayers(width), original = structuredClone(layers);
    const scene = mobileLayout(layers, width);
    assert.equal(scene.items.length, layers.length);
    assert.equal(new Set(scene.items.map(item => item.id)).size, layers.length);
    for (const { id, x, y, scale, box } of scene.items) {
      assert.ok(scale >= 0 && Number.isFinite(scale), id);
      assert.ok(x + box.x * scale >= -.01, `${id} left at ${viewportWidth}`);
      assert.ok(x + (box.x + box.width) * scale <= width + .01, `${id} right at ${viewportWidth}`);
      assert.ok(y + box.y * scale >= -.01, `${id} top`);
      assert.ok(y + (box.y + box.height) * scale <= scene.height + .01, `${id} bottom`);
    }
    const byId = Object.fromEntries(scene.items.map(item => [item.id, item]));
    assert.ok(24 * byId.monitor.scale >= 18, 'S&P price remains readable');
    assert.ok(24 * byId.softbank.scale >= 18, 'SoftBank price remains readable');
    assert.ok(85 * byId['one-word'].scale >= 44, 'pen link has a usable touch target');
    assert.equal(byId['ai-ticker'].scale, 1, 'the ship and its billboard share the available width');
    assert.ok(17 * byId['uv-machine'].scale >= 16, 'UV warning remains readable');
    assert.deepEqual(layers, original, 'the saved desktop layout and artwork stay intact');
  }
});

test('SoftBank ink and its interactive chart keep the same relative alignment', () => {
  const layers = actualLayers(358), scene = mobileLayout(layers, 358);
  const find = id => scene.items.find(item => item.id === id);
  const chart = find('softbank'), label = find('10d61a37-3bd9-42c1-b303-6ab3f92251db');
  const groupScale = chart.scale / (saved.items.softbank.width / 300);
  const labelScale = label.scale / (saved.items[label.id].width / 400);
  assert.ok(Math.abs(groupScale - labelScale) < .00001);
  assert.ok(Math.abs(chart.x - label.x - (saved.items.softbank.x - saved.items[label.id].x) * groupScale) < .001);
  assert.ok(Math.abs(chart.y - label.y - (saved.items.softbank.y - saved.items[label.id].y) * groupScale) < .001);
});

test('erased strokes and transparent canvas do not force the visible drawing to shrink', () => {
  const pixels = new Uint8ClampedArray(100 * 40 * 4);
  for (let y = 5; y < 35; y++) for (let x = 5; x < 25; x++) pixels[(y * 100 + x) * 4 + 3] = 255;
  const ink = alphaBounds(pixels, 100, 40);
  const drawing = { strokes: [{ tool: 'pen', width: 2, points: [[0, 0], [1, 1]] }], number: { enabled: false } };
  const box = artworkBounds({ nativeWidth: 400, nativeHeight: 160, drawing, ink });
  assert.ok(box.width < 100);
  assert.ok(box.height > 100);
  pixels.fill(0);
  assert.deepEqual(alphaBounds(pixels, 100, 40), { x: 0, y: 0, width: 0, height: 0 });
});

test('missing optional artwork and new doodles still produce a finite mobile scene', () => {
  const layer = { id: 'new-drawing', x: 0, y: 0, width: 320, nativeWidth: 400, nativeHeight: 300 };
  const scene = mobileLayout([layer], 288);
  assert.equal(scene.items.length, 1);
  assert.ok(Number.isFinite(scene.height));
  assert.ok(Number.isFinite(mobileLayout([], 0).height));
});
