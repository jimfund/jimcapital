// A small clearance field is sampled once per fog pixel, outside the volume
// march. Only recent cursor motion needs CPU work or a texture upload.
export function createWakeField(width = 128, height = 76) {
 const values = new Float32Array(width * height), data = new Uint8Array(width * height);
 let active = false, changed = false;
 function write(index, value) {
  values[index] = value;
  const byte = Math.round(value * 255);
  if (data[index] !== byte) { data[index] = byte; changed = true; }
 }
 return {
  width, height, data,
  fade(seconds) {
   if (!active || seconds <= 0) return;
   const decay = Math.exp(-seconds * 1.45);
   active = false;
   for (let i = 0; i < values.length; i++) {
    if (!values[i]) continue;
    const value = values[i] * decay;
    write(i, value < 1 / 255 ? 0 : value);
    if (values[i]) active = true;
   }
  },
  stroke(from, to, screenWidth, screenHeight, radius = 38) {
   if (!(screenWidth > 0 && screenHeight > 0 && radius > 0)) return;
   const ax = from[0] * screenWidth, ay = from[1] * screenHeight;
   const bx = to[0] * screenWidth, by = to[1] * screenHeight;
   const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
   const left = Math.max(0, Math.floor((Math.min(ax, bx) - radius) / screenWidth * width));
   const right = Math.min(width - 1, Math.ceil((Math.max(ax, bx) + radius) / screenWidth * width));
   const top = Math.max(0, Math.floor((Math.min(ay, by) - radius) / screenHeight * height));
   const bottom = Math.min(height - 1, Math.ceil((Math.max(ay, by) + radius) / screenHeight * height));
   for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const px = (x + .5) / width * screenWidth - ax, py = (y + .5) / height * screenHeight - ay;
    const t = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(px - dx * t, py - dy * t) / radius;
    if (distance >= 1) continue;
    const feather = Math.max(0, (distance - .3) / .7);
    const clearance = 1 - feather * feather * (3 - 2 * feather), index = y * width + x;
    if (clearance > values[index]) { write(index, clearance); active = true; }
   }
  },
  clear() {
   if (!active) return;
   values.fill(0); data.fill(0); active = false; changed = true;
  },
  consumeChanges() { const result = changed; changed = false; return result; },
 };
}

export function createFogWake(surface) {
 const doc = surface.ownerDocument, view = doc.defaultView, field = createWakeField();
 const pending = [];
 let previous, lastTime = 0, disposed = false;
 const resetPointer = () => { pending.length = 0; previous = undefined; };
 const move = event => {
  if (event.pointerType === 'touch' || event.isPrimary === false || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
  // Bound the queue even while the ship is paused outside the viewport.
  if (pending.length === 64) pending.splice(0, 2);
  pending.push(event.clientX, event.clientY);
 };
 const leave = event => { if (!event.relatedTarget) resetPointer(); };
 const visibility = () => { if (doc.hidden) { resetPointer(); field.clear(); } };
 doc.addEventListener('pointermove', move, { passive: true });
 doc.addEventListener('pointerout', leave, { passive: true });
 doc.addEventListener('pointercancel', resetPointer, { passive: true });
 doc.addEventListener('visibilitychange', visibility);
 doc.addEventListener('wheel', resetPointer, { passive: true });
 view.addEventListener('blur', resetPointer);
 view.addEventListener('resize', resetPointer);
 return {
  width: field.width, height: field.height, data: field.data,
  update(time) {
   if (disposed) return false;
   field.fade(Math.max(0, time - lastTime)); lastTime = time;
   if (pending.length) {
    // Read the transformed position once for the entire frame, including pan.
    const rect = surface.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
     for (let i = 0; i < pending.length; i += 2) {
      const point = [(pending[i] - rect.left) / rect.width, (pending[i + 1] - rect.top) / rect.height];
      field.stroke(previous || point, point, rect.width, rect.height); previous = point;
     }
    } else previous = undefined;
    pending.length = 0;
   }
   return field.consumeChanges();
  },
  destroy() {
   if (disposed) return;
   disposed = true; resetPointer();
   doc.removeEventListener('pointermove', move);
   doc.removeEventListener('pointerout', leave);
   doc.removeEventListener('pointercancel', resetPointer);
   doc.removeEventListener('visibilitychange', visibility);
   doc.removeEventListener('wheel', resetPointer);
   view.removeEventListener('blur', resetPointer);
   view.removeEventListener('resize', resetPointer);
  },
 };
}
