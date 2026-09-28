import { blankDrawing } from './drawing.js';
import { WORLD } from './layout-model.js';

export function materialize(strokes) {
  if (!strokes.some(stroke => stroke.tool === 'pen' && stroke.points.length)) return null;
  const points = strokes.flatMap(stroke => stroke.points.map(([x, y]) => ({ x, y, radius: stroke.width / 2 })));
  let left = WORLD, top = Infinity, right = 0, bottom = 0;
  for (const p of points) {
    left = Math.min(left, p.x - p.radius - 6);
    top = Math.min(top, p.y - p.radius - 6);
    right = Math.max(right, p.x + p.radius + 6);
    bottom = Math.max(bottom, p.y + p.radius + 6);
  }
  let width = Math.max(32, Math.min(WORLD, right - left));
  top = Math.max(0, Math.min(6000, top));
  let height = Math.max(24, bottom - top);
  if (width / height > 20) height = width / 20;
  if (width / height < .05) width = height * .05;
  left = Math.max(0, Math.min(WORLD - width, left));
  const drawing = blankDrawing();
  drawing.number.enabled = false;
  drawing.aspect = width / height;
  drawing.strokes = strokes.map(stroke => ({ ...stroke, width: stroke.width * 800 / width,
    points: stroke.points.map(([x, y]) => [Math.max(0, Math.min(1, (x - left) / width)), Math.max(0, Math.min(1, (y - top) / height))]),
  }));
  return { drawing, position: { x: left, y: top, width, z: 1 } };
}
