export const blankDrawing = () => ({
  version: 1,
  strokes: [],
  number: { x: 0.5, y: 0.42, size: 48, color: '#111111' },
});

export function isDrawing(value) {
  const range = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
  const color = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  return value?.version === 1 && Array.isArray(value.strokes) && value.strokes.length <= 2000
    && range(value.number?.x, 0, 1) && range(value.number?.y, 0, 1)
    && range(value.number?.size, 14, 120) && color(value.number?.color)
    && (value.number.enabled === undefined || typeof value.number.enabled === 'boolean')
    && value.strokes.every(s => s && ['pen', 'eraser'].includes(s.tool) && color(s.color)
      && range(s.width, 1, 80) && Array.isArray(s.points) && s.points.length <= 20000
      && s.points.every(p => Array.isArray(p) && p.length === 2 && range(p[0], 0, 1) && range(p[1], 0, 1)))
    && value.strokes.reduce((n, s) => n + s.points.length, 0) <= 100000;
}

export function drawStrokes(canvas, drawing) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, 800, 600);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of drawing.strokes) {
    const points = stroke.points;
    if (!points.length) continue;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    if (points.length === 1) {
      ctx.arc(points[0][0] * 800, points[0][1] * 600, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.moveTo(points[0][0] * 800, points[0][1] * 600);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0] * 800, points[i][1] * 600);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function placeNumber(stage, output, drawing) {
  output.hidden = drawing.number.enabled === false;
  output.style.left = `${drawing.number.x * 100}%`;
  output.style.top = `${drawing.number.y * 100}%`;
  output.style.fontSize = `${drawing.number.size * stage.clientWidth / 800}px`;
  output.style.color = drawing.number.color;
}
