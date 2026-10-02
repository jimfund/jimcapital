// A small flow simulation carries the fog with the cursor. The texture stores
// displacement and compression, rather than a mask that erases the volume.
export const WIND_LIMITS = Object.freeze({ x: .18, y: .25, density: .55 });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createWakeField(width = 96, height = 56) {
 const size = width * height, data = new Uint8Array(size * 4);
 let current = Array.from({ length: 5 }, () => new Float32Array(size));
 let next = Array.from({ length: 5 }, () => new Float32Array(size));
 let active = false, changed = false;
 data.fill(128); for (let i = 3; i < data.length; i += 4) data[i] = 255;
 function encode() {
  for (let i = 0; i < size; i++) {
   for (let channel = 0; channel < 3; channel++) {
    const scale = channel === 0 ? WIND_LIMITS.x : channel === 1 ? WIND_LIMITS.y : WIND_LIMITS.density;
    const byte = 128 + Math.round(127 * current[channel + 2][i] / scale), index = i * 4 + channel;
    if (data[index] !== byte) { data[index] = byte; changed = true; }
   }
  }
 }
 function clear() {
  if (!active) return;
  for (const values of [...current, ...next]) values.fill(0);
  active = false; encode();
 }
 return {
  width, height, data,
  advance(seconds) {
   if (!active || seconds <= 0) return;
   // Keep work bounded after a suspended frame. Normal animation runs at 30fps.
   if (seconds > 4) { clear(); return; }
   const steps = Math.min(3, Math.ceil(seconds * 30)), dt = Math.min(seconds, .1) / steps;
   const velocityDecay = Math.exp(-2.2 * seconds / steps);
   const displacementDecay = Math.exp(-.85 * seconds / steps), densityDecay = Math.exp(-1.4 * seconds / steps);
   for (let step = 0; step < steps; step++) {
    const [vx, vy] = current;
    let energy = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
     const i = y * width + x;
     // Semi-Lagrangian transport lets eddies move on their own after input ends.
     // A little of the prevailing wind carries the entire wake along the ship.
     const backX = clamp(x - (vx[i] - .009) * dt * width, 0, width - 1.001);
     const backY = clamp(y - (vy[i] + .003) * dt * height, 0, height - 1.001);
     const ix = Math.floor(backX), iy = Math.floor(backY), fx = backX - ix, fy = backY - iy;
     const a = iy * width + ix, b = a + 1, c = a + width, d = c + 1;
     const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
     for (let channel = 0; channel < 5; channel++) {
      const source = current[channel];
      next[channel][i] = source[a] * wa + source[b] * wb + source[c] * wc + source[d] * wd;
     }
     const left = y * width + Math.max(0, x - 1), right = y * width + Math.min(width - 1, x + 1);
     const top = Math.max(0, y - 1) * width + x, bottom = Math.min(height - 1, y + 1) * width + x;
     const smooth = Math.min(.12, dt * 2.4);
     next[0][i] = (next[0][i] * (1 - smooth) + (vx[left] + vx[right] + vx[top] + vx[bottom]) * .25 * smooth) * velocityDecay;
     next[1][i] = (next[1][i] * (1 - smooth) + (vy[left] + vy[right] + vy[top] + vy[bottom]) * .25 * smooth) * velocityDecay;
     next[2][i] = clamp((next[2][i] + next[0][i] * dt) * displacementDecay, -WIND_LIMITS.x, WIND_LIMITS.x);
     next[3][i] = clamp((next[3][i] + next[1][i] * dt) * displacementDecay, -WIND_LIMITS.y, WIND_LIMITS.y);
     const divergence = (vx[right] - vx[left]) * width * .5 + (vy[bottom] - vy[top]) * height * .5;
     next[4][i] = clamp((next[4][i] - divergence * dt * .32) * densityDecay, -.38, WIND_LIMITS.density);
     energy = Math.max(energy, Math.abs(next[0][i]), Math.abs(next[1][i]), Math.abs(next[2][i]), Math.abs(next[3][i]), Math.abs(next[4][i]));
    }
    [current, next] = [next, current];
    if (energy < .00045) { clear(); return; }
   }
   encode();
  },
  stroke(from, to, screenWidth, screenHeight, seconds = 1 / 30, radius = 100) {
   if (!(screenWidth > 0 && screenHeight > 0 && radius > 0)) return;
   const ax = from[0] * screenWidth, ay = from[1] * screenHeight;
   const bx = to[0] * screenWidth, by = to[1] * screenHeight;
   const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
   if (length < .5) return; // A resting pointer does not disturb the fog.
   const ux = dx / length, uy = dy / length, radiusSquared = radius * radius;
   const speed = length / Math.max(1 / 240, seconds);
   const impulse = 140 * Math.min(length / (radius * 1.2), 1.7) * (.35 + .65 * Math.min(speed / 800, 1));
   const left = Math.max(0, Math.floor((Math.min(ax, bx) - radius) / screenWidth * width));
   const right = Math.min(width - 1, Math.ceil((Math.max(ax, bx) + radius) / screenWidth * width));
   const top = Math.max(0, Math.floor((Math.min(ay, by) - radius) / screenHeight * height));
   const bottom = Math.min(height - 1, Math.ceil((Math.max(ay, by) + radius) / screenHeight * height));
   for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const px = (x + .5) / width * screenWidth - ax, py = (y + .5) / height * screenHeight - ay;
    const along = px * ux + py * uy, side = -px * uy + py * ux;
    const end = along - clamp(along, 0, length), distanceSquared = end * end + side * side;
    if (distanceSquared >= radiusSquared) continue;
    const feather = 1 - distanceSquared / radiusSquared, envelope = feather * feather;
    // A moving core and counter-rotating shoulders roll the mist back around
    // the gust, instead of translating a flat strip of fog.
    const forward = envelope * (feather - 3.6 * side * side / radiusSquared);
    const curl = envelope * 3.6 * side * end / radiusSquared;
    const i = y * width + x;
    current[0][i] = clamp(current[0][i] + (ux * forward - uy * curl) * impulse / screenWidth, -420 / screenWidth, 420 / screenWidth);
    current[1][i] = clamp(current[1][i] + (uy * forward + ux * curl) * impulse / screenHeight, -420 / screenHeight, 420 / screenHeight);
    active = true;
   }
  },
  clear,
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
  if (pending.length === 96) pending.splice(0, 3);
  pending.push(event.clientX, event.clientY, event.timeStamp);
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
   if (pending.length) {
    const rect = surface.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
     for (let i = 0; i < pending.length; i += 3) {
      const point = [pending[i], pending[i + 1], pending[i + 2]];
      if (previous && point[2] - previous[2] < 250) {
       // Map both endpoints with the same current bounds: moving the page
       // underneath a stationary pointer must not manufacture a gust.
       field.stroke([(previous[0] - rect.left) / rect.width, (previous[1] - rect.top) / rect.height],
        [(point[0] - rect.left) / rect.width, (point[1] - rect.top) / rect.height],
        rect.width, rect.height, Math.max(1 / 240, (point[2] - previous[2]) / 1000));
      }
      previous = point;
     }
    } else previous = undefined;
    pending.length = 0;
   }
   field.advance(Math.max(0, time - lastTime)); lastTime = time;
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
