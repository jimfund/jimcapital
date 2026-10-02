export const MOBILE_QUERY = '(max-width: 700px)';

const SOFTBANK_DRAWINGS = ['beba7e25-b7b3-4fef-a49d-6f97b4f3a852', '10d61a37-3bd9-42c1-b303-6ab3f92251db'];
const inkCache = new WeakMap();

export function measureDrawingInk(item) {
  if (!item.drawing) return;
  if (inkCache.has(item.drawing)) return inkCache.get(item.drawing);
  const source = item.element.querySelector('canvas');
  if (!source) return;
  const sample = source.ownerDocument.createElement('canvas');
  sample.width = 256;
  sample.height = Math.max(1, Math.min(1024, Math.ceil(256 * source.height / source.width)));
  const context = sample.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, sample.width, sample.height);
  const { data } = context.getImageData(0, 0, sample.width, sample.height);
  const result = alphaBounds(data, sample.width, sample.height);
  inkCache.set(item.drawing, result);
  return result;
}

export function alphaBounds(data, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[(y * width + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) return { x: 0, y: 0, width: 0, height: 0 };
  left = Math.max(0, left - 1); top = Math.max(0, top - 1);
  return { x: left / width, y: top / height,
    width: (Math.min(width, right + 2) - left) / width,
    height: (Math.min(height, bottom + 2) - top) / height };
}

// Drawings include empty canvas around the ink. Measure the visible artwork so
// the phone layout can give it useful space without changing the saved drawing.
export function artworkBounds({ nativeWidth, nativeHeight, drawing, ink, id }) {
  if (id === 'softbank') return { x: -15, y: -73, width: 180, height: 115 };
  if (!drawing?.strokes.length) return { x: 0, y: 0, width: nativeWidth, height: nativeHeight };
  let left = nativeWidth, top = nativeHeight, right = 0, bottom = 0;
  const include = (x, y, rx, ry = rx) => {
    left = Math.min(left, x - rx); top = Math.min(top, y - ry);
    right = Math.max(right, x + rx); bottom = Math.max(bottom, y + ry);
  };
  if (ink) {
    left = ink.x * nativeWidth; top = ink.y * nativeHeight;
    right = left + ink.width * nativeWidth; bottom = top + ink.height * nativeHeight;
  } else {
    for (const stroke of drawing.strokes) {
      if (stroke.tool !== 'pen') continue;
      for (const [x, y] of stroke.points) include(x * nativeWidth, y * nativeHeight, stroke.width * nativeWidth / 1600 + 2);
    }
  }
  if (drawing.number.enabled !== false) {
    const size = drawing.number.size * nativeWidth / 800;
    include(drawing.number.x * nativeWidth, drawing.number.y * nativeHeight, size * 3.6, size / 2 + 2);
  }
  if (right <= left || bottom <= top) return { x: 0, y: 0, width: 0, height: 0 };
  left = Math.max(0, left); top = Math.max(0, top);
  return { x: left, y: top, width: Math.min(nativeWidth, right) - left, height: Math.min(nativeHeight, bottom) - top };
}

export function mobileLayout(layers, width) {
  const available = Math.max(1, width);
  const items = new Map(layers.map(layer => [layer.id, { ...layer, box: artworkBounds(layer) }]));
  const placed = new Map();
  const gap = 28;
  function place(id, x, y, desiredWidth) {
    const item = items.get(id);
    if (!item) return 0;
    const { box } = item;
    const scale = desiredWidth / Math.max(1, box.width);
    placed.set(id, { id, x: x - box.x * scale, y: y - box.y * scale, scale, box });
    return box.height * scale;
  }
  const column = Math.max(1, (available - 20) / 2);
  const angelWidth = Math.min(164, column);
  const angelHeight = place('angel', (column - angelWidth) / 2, 0, angelWidth);
  const clockWidth = Math.min(160, column);
  const right = column + 20;
  const clockHeight = place('clock', right + (column - clockWidth) / 2, 0, clockWidth);
  const predictionWidth = Math.min(66, column * .46);
  const penWidth = Math.min(64, column * .44);
  const smallY = clockHeight + 18;
  const predictionHeight = place('prediction', right, smallY, predictionWidth);
  const penHeight = place('one-word', right + column - penWidth, smallY + 6, penWidth);
  let y = Math.max(angelHeight, smallY + Math.max(predictionHeight, penHeight + 6)) + gap;

  // Size the ship and its integrated billboard together as one piece of artwork.
  if (items.has('ai-ticker')) y += place('ai-ticker', 0, y, available) + gap;
  if (items.has('uv-machine')) {
    const meterWidth = Math.min(280, available);
    y += place('uv-machine', (available - meterWidth) / 2, y, meterWidth) + gap;
  }
  if (items.has('monitor')) {
    const monitorWidth = Math.min(340, available);
    y += place('monitor', (available - monitorWidth) / 2, y, monitorWidth) + gap;
  }

  // The SoftBank TV, handwritten label and live chart form one drawing. Keep
  // their saved offsets and scale together, excluding the TV's empty canvas.
  const group = ['softbank', ...SOFTBANK_DRAWINGS].map(id => items.get(id)).filter(Boolean);
  if (group.length) {
    const rects = group.map(item => {
      const zoom = item.width / item.nativeWidth;
      return { x: item.x + item.box.x * zoom, y: item.y + item.box.y * zoom,
        width: item.box.width * zoom, height: item.box.height * zoom };
    });
    const left = Math.min(...rects.map(r => r.x)), top = Math.min(...rects.map(r => r.y));
    const groupWidth = Math.max(...rects.map(r => r.x + r.width)) - left;
    const groupHeight = Math.max(...rects.map(r => r.y + r.height)) - top;
    const scale = Math.min(1.15, available / Math.max(1, groupWidth));
    for (const item of group) placed.set(item.id, { id: item.id,
      x: (available - groupWidth * scale) / 2 + (item.x - left) * scale,
      y: y + (item.y - top) * scale, scale: item.width / item.nativeWidth * scale, box: item.box });
    y += groupHeight * scale + gap;
  }
  for (const item of items.values()) {
    if (placed.has(item.id)) continue;
    const itemWidth = Math.min(available, item.box.width * item.width / item.nativeWidth);
    y += place(item.id, (available - itemWidth) / 2, y, itemWidth) + gap;
  }
  return { items: [...placed.values()], height: Math.max(0, y - gap) };
}
