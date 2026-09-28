export const WORLD = 1200;
export const validId = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value || '');
export function isLayout(value) {
  const inRange = (v, low, high) => typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high;
  return value?.version === 1 && value.items && typeof value.items === 'object' && !Array.isArray(value.items)
    && Object.keys(value.items).length <= 104
    && Object.entries(value.items).every(([id, item]) => (['prediction', 'angel', 'monitor', 'softbank'].includes(id) || validId(id))
      && item && inRange(item.x, 0, WORLD) && inRange(item.y, 0, 6000)
      && inRange(item.width, 32, WORLD) && inRange(item.z, 0, 10000) && item.x + item.width <= WORLD + .001);
}
export function constrain(item) {
  const width = Math.max(32, Math.min(WORLD, item.width));
  return { ...item, width, x: Math.max(0, Math.min(WORLD - width, item.x)), y: Math.max(0, Math.min(6000, item.y)) };
}
export function defaultPosition(id, index) {
  if (id === 'prediction') return { x: 110, y: 205, width: 105, z: 1 };
  if (id === 'angel') return { x: 340, y: 80, width: 316, z: 2 };
  if (id === 'monitor') return { x: 755, y: 175, width: 400, z: 3 };
  if (id === 'softbank') return { x: 760, y: 800, width: 300, z: 4 };
  return { x: 40 + (index % 3) * 390, y: 600 + Math.floor(index / 3) * 320, width: 320, z: index + 4 };
}
