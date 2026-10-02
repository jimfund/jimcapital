export const WORLD = 1200;
// Fit the occupied scene, preserving proportions and a small edge gutter.
export function fitScene(rects, width, height, gutter = 8) {
  if (!rects.length) return { scale: 1, x: 0, y: 0 };
  const left = Math.min(...rects.map(r => r.x));
  const top = Math.min(...rects.map(r => r.y));
  const sceneWidth = Math.max(...rects.map(r => r.x + r.width)) - left;
  const sceneHeight = Math.max(...rects.map(r => r.y + r.height)) - top;
  const scale = Math.min(
    Math.max(1, width - gutter * 2) / Math.max(1, sceneWidth),
    Math.max(1, height - gutter * 2) / Math.max(1, sceneHeight),
  );
  return { scale, x: (width - sceneWidth * scale) / 2 - left * scale,
    y: (height - sceneHeight * scale) / 2 - top * scale };
}
export const validId = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value || '');
export function isLayout(value) {
  const inRange = (v, low, high) => typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high;
  return value?.version === 1 && value.items && typeof value.items === 'object' && !Array.isArray(value.items)
    && Object.keys(value.items).length <= 108
    && Object.entries(value.items).every(([id, item]) => (['prediction', 'angel', 'monitor', 'softbank', 'clock', 'one-word', 'ai-ticker', 'uv-machine'].includes(id) || validId(id))
      && item && inRange(item.x, 0, WORLD) && inRange(item.y, 0, 6000)
      && inRange(item.width, 32, WORLD) && inRange(item.z, 0, 10000) && item.x + item.width <= WORLD + .001);
}
export function constrain(item) {
  const width = Math.max(32, Math.min(WORLD, item.width));
  return { ...item, width, x: Math.max(0, Math.min(WORLD - width, item.x)), y: Math.max(0, Math.min(6000, item.y)) };
}
export function defaultPosition(id, index) {
  if (id === 'prediction') return { x: 110, y: 205, width: 105, z: 1 };
  if (id === 'angel') return { x: 388, y: 150, width: 220, z: 2 };
  if (id === 'monitor') return { x: 755, y: 175, width: 400, z: 3 };
  if (id === 'softbank') return { x: 760, y: 800, width: 300, z: 4 };
  if (id === 'clock') return { x: 990, y: 15, width: 150, z: 5 };
  if (id === 'one-word') return { x: 810, y: 280, width: 85, z: 10 };
  if (id === 'ai-ticker') return { x: 704, y: 20, width: 488, z: 10 };
  if (id === 'uv-machine') return { x: 260, y: 640, width: 340, z: 11 };
  return { x: 40 + (index % 3) * 390, y: 600 + Math.floor(index / 3) * 320, width: 320, z: index + 4 };
}
