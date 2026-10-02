// The selected local Marquee study, at its original pace and intensity.
// Decorative light pixels animate independently of the live HTML prices.
import { createFogRenderer } from './airship-fog.js';
import { MOBILE_QUERY } from './mobile-layout.js';
export const vertexShader = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() { v_uv = a_position * .5 + .5; gl_Position = vec4(a_position, 0., 1.); }
`;
export const fragmentShader = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_art;
uniform sampler2D u_mask;
uniform sampler2D u_glow;
uniform float u_time;
const float TAU = 6.28318530718;
float loopBell(float value, float center, float width) {
 float d = abs(fract(value) - center);
 d = min(d, 1. - d) / width;
 return exp(-d * d * 2.);
}
void main() {
 vec4 art = texture2D(u_art, v_uv);
 vec4 mask = texture2D(u_mask, v_uv);
 vec4 glow = texture2D(u_glow, v_uv);
 vec2 p = vec2(v_uv.x, 1. - v_uv.y);
 bool frame = mask.g > .5;
 float position = frame ? atan((p.y - .55) / .34, (p.x - .815) / .145) / TAU + .5 : p.x * .79 + p.y * .21;
 float phase = position - u_time / (frame ? 7. : 9.);
 float chase = loopBell(phase, .22, frame ? .12 : .17);
 float echo = loopBell(phase, .70, .07);
 float strength = (frame ? .72 : .42) + 1.8 * chase + .35 * echo;
 vec3 lit = art.rgb * mix(1., strength, mask.r);
 float bloom = glow.a * max(0., strength - .65) * .46;
 float alpha = art.a + bloom * (1. - art.a);
 vec3 colour = (lit * art.a + glow.rgb * bloom) / max(alpha, .0001);
 gl_FragColor = vec4(clamp(colour, 0., 1.), clamp(alpha, 0., 1.));
}
`;

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (lo, hi, value) => { const t = clamp((value - lo) / (hi - lo)); return t * t * (3 - 2 * t); };
export function lightPixel(r, g, b, x, y) {
 const emission = Math.max(smooth(.12, .48, r - b) * smooth(.32, .85, r), smooth(.74, .98, Math.min(r, g, b)));
 const frame = x > .74 - y * .077 && y > .17 && y < .91 && x < .96;
 return { emission, frame };
}
function canvas(doc, width, height) {
 const element = doc.createElement('canvas'); element.width = width; element.height = height; return element;
}
function makeMasks(artwork, doc) {
 const width = artwork.naturalWidth, height = artwork.naturalHeight;
 const source = canvas(doc, width, height), ctx = source.getContext('2d', { willReadFrequently: true });
 ctx.drawImage(artwork, 0, 0);
 const art = ctx.getImageData(0, 0, width, height), mask = ctx.createImageData(width, height), emission = ctx.createImageData(width, height);
 for (let pixel = 0; pixel < width * height; pixel++) {
  const i = pixel * 4;
  if (!art.data[i + 3]) continue;
  const light = lightPixel(art.data[i] / 255, art.data[i + 1] / 255, art.data[i + 2] / 255, pixel % width / width, Math.floor(pixel / width) / height);
  mask.data[i] = Math.round(light.emission * 255); mask.data[i + 1] = light.frame ? 255 : 0; mask.data[i + 3] = 255;
  emission.data[i] = art.data[i]; emission.data[i + 1] = art.data[i + 1]; emission.data[i + 2] = art.data[i + 2]; emission.data[i + 3] = Math.round(art.data[i + 3] * light.emission);
 }
 ctx.putImageData(mask, 0, 0);
 const lights = canvas(doc, width, height); lights.getContext('2d').putImageData(emission, 0, 0);
 const glow = canvas(doc, width, height), glowContext = glow.getContext('2d');
 glowContext.filter = 'blur(4.5px)'; glowContext.drawImage(lights, 0, 0);
 return { mask: source, glow };
}
export async function createMarqueeRenderer(root, { signal, startFog = createFogRenderer } = {}) {
 const doc = root.ownerDocument, view = doc.defaultView;
 const artwork = root.querySelector('.airship-artwork'); await artwork.decode();
 if (signal?.aborted) return;
 const surface = canvas(doc, artwork.naturalWidth, artwork.naturalHeight);
 surface.className = 'airship-lights'; surface.setAttribute('aria-hidden', 'true');
 const gl = surface.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false });
 if (!gl) return;
 const shaders = [], textures = [];
 let program, buffer, observer, visibilityObserver, frame, fog, visibilityTarget = root, disposed = false, inView = true, elapsed = 0, last = 0, lastDraw = 0;
 function destroy() {
  if (disposed) return;
  disposed = true; view.cancelAnimationFrame(frame); observer?.disconnect(); visibilityObserver?.disconnect(); fog?.destroy();
  doc.removeEventListener('visibilitychange', restart); signal?.removeEventListener('abort', destroy);
  surface.remove(); root.removeAttribute('data-marquee');
  for (const texture of textures) gl.deleteTexture(texture);
  for (const shader of shaders) gl.deleteShader(shader);
  if (buffer) gl.deleteBuffer(buffer);
  if (program) gl.deleteProgram(program);
 }
 function restart() { view.cancelAnimationFrame(frame); last = 0; if (inView && !doc.hidden && !disposed) frame = view.requestAnimationFrame(tick); }
 let time;
 function render() { if (!disposed) { gl.uniform1f(time, elapsed); gl.drawArrays(gl.TRIANGLES, 0, 6); fog?.render(elapsed); } }
 function tick(now) {
  if (disposed || doc.hidden || !inView) return;
  elapsed += last ? Math.min((now - last) / 1000, .1) : 0; last = now;
  if (now - lastDraw >= 1000 / 30) { render(); lastDraw = now; }
  frame = view.requestAnimationFrame(tick);
 }
 try {
  const compile = (type, source) => {
   const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
   if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
   return shader;
  };
  program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader)); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const masks = makeMasks(artwork, doc);
  for (const [index, name, image] of [[0, 'art', artwork], [1, 'mask', masks.mask], [2, 'glow', masks.glow]]) {
   const texture = gl.createTexture(); textures.push(texture);
   gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, texture);
   gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, index === 1 ? gl.NEAREST : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, index === 1 ? gl.NEAREST : gl.LINEAR);
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
   gl.uniform1i(gl.getUniformLocation(program, 'u_' + name), index);
  }
  time = gl.getUniformLocation(program, 'u_time');
  const resize = () => {
   if (disposed) return;
   surface.width = Math.max(1, Math.min(1672, Math.round(root.clientWidth * Math.min(view.devicePixelRatio || 1, 1.5))));
   surface.height = Math.max(1, Math.round(surface.width * artwork.naturalHeight / artwork.naturalWidth));
   gl.viewport(0, 0, surface.width, surface.height); render();
  };
  surface.addEventListener('webglcontextlost', event => { event.preventDefault(); destroy(); });
  root.insertBefore(surface, root.querySelector('.airship-display'));
  observer = new view.ResizeObserver(resize); observer.observe(root); resize();
  if (view.IntersectionObserver) {
   visibilityObserver = new view.IntersectionObserver(entries => {
    if (disposed) return;
    // A lost fog context removes its canvas; keep the visible marquee running.
    if (visibilityTarget !== root && !root.contains(visibilityTarget)) {
     visibilityObserver.unobserve(visibilityTarget); visibilityTarget = root; visibilityObserver.observe(root);
     fog?.destroy(); fog = undefined; inView = true; restart(); return;
    }
    let entry;
    for (const candidate of entries) if (candidate.target === visibilityTarget) entry = candidate;
    if (!entry || entry.isIntersecting === inView) return;
    inView = entry.isIntersecting; restart();
   }, { rootMargin: '200px' }); // Include the fog extending beyond the hull.
   visibilityObserver.observe(root);
  }
  root.dataset.marquee = 'ready';
  doc.addEventListener('visibilitychange', restart); signal?.addEventListener('abort', destroy, { once: true }); restart();
  startFog(root, { signal }).then(renderer => {
   if (disposed) renderer?.destroy();
   else {
    fog = renderer;
    if (fog?.surface && visibilityObserver) {
     visibilityObserver.unobserve(visibilityTarget); visibilityTarget = fog.surface; visibilityObserver.observe(visibilityTarget);
    }
    fog?.render(elapsed);
   }
  }).catch(() => {}); // Unsupported fog leaves the marquee and live prices usable.
 } catch (error) { destroy(); throw error; }
 return { destroy };
}
export function mountAirshipMarquee(root, { media = root.ownerDocument.defaultView.matchMedia('(prefers-reduced-motion: reduce)'), compact = root.ownerDocument.defaultView.matchMedia?.(MOBILE_QUERY), start = createMarqueeRenderer } = {}) {
 let controller;
 const update = () => {
  controller?.abort(); controller = undefined;
  if (media.matches || compact?.matches) return;
  controller = new AbortController();
  // Graphics failures leave the original artwork and live links in place.
  start(root, { signal: controller.signal }).catch(() => {});
 };
 media.addEventListener('change', update); compact?.addEventListener('change', update); update();
 return () => { controller?.abort(); media.removeEventListener('change', update); compact?.removeEventListener('change', update); };
}
if (typeof document !== 'undefined') {
 const root = document.querySelector('.market-airship');
 if (root) mountAirshipMarquee(root);
}
