// Heterogeneous 3D fog, integrated in front of a depth approximation of the
// photographed ship. The resulting transmittance also occludes the HTML screen.
import { createFogWake, WIND_LIMITS } from './airship-fog-wake.js';
export const FOG_SETTINGS = Object.freeze({ density: 1, wind: .7, scatter: 2.5 });
export const fogVertexShader = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() { v_uv = a_position * .5 + .5; gl_Position = vec4(a_position, 0., 1.); }
`;
export const fogFragmentShader = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_noise;
uniform sampler2D u_ship;
uniform sampler2D u_wake;
uniform float u_time;
uniform float u_density;
uniform float u_scatter;
uniform float u_night;
uniform vec4 u_lights[9];
uniform vec3 u_colours[9];
float noise3(vec3 p) {
 vec3 cell = floor(p), f = fract(p);
 f = f * f * (3. - 2. * f);
 vec2 uv = cell.xy + vec2(37., 239.) * cell.z + f.xy;
 vec2 n = texture2D(u_noise, (uv + .5) / 256.).rg;
 return mix(n.r, n.g, f.z);
}
float densityAt(vec3 p) {
 vec3 wind = vec3(u_time * .075, u_time * .018, -u_time * .041);
 vec3 q = p * 2.1 + wind;
 q += .24 * sin(p.yzx * 2.8 + vec3(.11, -.07, .09) * u_time);
 float field = .57 * noise3(q) + .28 * noise3(q * 2.07 - wind * .61) + .15 * noise3(q * 4.19 + wind * .37);
 float pockets = smoothstep(.30, .72, field);
 float bank = .75 + .45 * sin(p.x * 1.7 + p.z * 1.4 - u_time * .13);
 float edge = 1. - smoothstep(.56, 1.18, length(p / vec3(1.72, 1.19, 1.75)));
 return (.025 + pockets * pockets * 4.9) * bank * edge * u_density;
}
float shipDepth(vec2 p) {
 vec2 hull = (p - vec2(.49, .52)) / vec2(.52, .38);
 float shell = sqrt(max(0., 1. - dot(hull, hull)));
 float depth = .31 - .34 * shell + (.55 - p.x) * .24;
 if (p.x > .74 - p.y * .077 && p.y > .18 && p.y < .90) depth = -.17 - (p.x - .72) * .38;
 return depth;
}
float phaseMie(float cosine) {
 const float g = .63;
 float d = max(.06, 1. + g * g - 2. * g * cosine);
 return .07957747 * (1. - g * g) * inversesqrt(d * d * d);
}
void main() {
 if (u_density <= .001) { gl_FragColor = vec4(0.); return; }
 vec2 p = vec2(v_uv.x * 1.32 - .16, (1. - v_uv.y) * 1.40 - .20);
 float within = step(0., p.x) * step(p.x, 1.) * step(0., p.y) * step(p.y, 1.);
 float ship = texture2D(u_ship, vec2(clamp(p.x, 0., 1.), 1. - clamp(p.y, 0., 1.))).a * within;
 float end = mix(1.30, shipDepth(p), ship);
 float stepSize = (end + 1.48) / 16.;
 float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
 float edge = smoothstep(0., .09, v_uv.x) * smoothstep(0., .09, 1. - v_uv.x)
            * smoothstep(0., .10, v_uv.y) * smoothstep(0., .10, 1. - v_uv.y);
 // Transport the density field with the gust. A little compression gathers
 // mist at its leading edge; the light still scatters through the moving fog.
 vec3 flow = (texture2D(u_wake, vec2(v_uv.x, 1. - v_uv.y)).rgb * 255. - 128.) / 127.;
 vec2 displacement = flow.rg * vec2(${WIND_LIMITS.x * 3.168}, ${-WIND_LIMITS.y * 2.1});
 float compression = 1. + flow.b * ${WIND_LIMITS.density};
 float cameraDensity = edge * compression, skyDensity = .47 * compression;
 vec3 point = vec3((p.x - .5) * 2.4, (.5 - p.y) * 1.5, -1.48 + jitter * stepSize);
 vec3 radiance = vec3(0.);
 float transmission = 1.;
 for (int sampleIndex = 0; sampleIndex < 16; sampleIndex++) {
  // Different depths move by different amounts, giving the wake volume.
  vec3 carriedPoint = point - vec3(displacement * (.85 - .18 * point.z), 0.);
  float rho = densityAt(carriedPoint) * cameraDensity;
  float attenuation = exp(-rho * stepSize * 1.8);
  // A short sample toward the sky adds soft self-shadowing to the billows.
  float sky = exp(-densityAt(carriedPoint + vec3(-.17, .30, .16)) * skyDensity);
  vec3 daylight = mix(vec3(.72, .79, .87), vec3(.98, .99, 1.), sky);
  vec3 nightlight = mix(vec3(.075, .11, .16), vec3(.25, .31, .39), sky);
  vec3 incoming = mix(daylight, nightlight, u_night);
  for (int lightIndex = 0; lightIndex < 9; lightIndex++) {
   vec3 delta = u_lights[lightIndex].xyz - point;
   float distanceSquared = dot(delta, delta);
   float distanceToLight = sqrt(max(distanceSquared, .0001));
   float phase = phaseMie(delta.z / distanceToLight);
   // Approximate extinction on the light path; the camera path is marched.
   float lightPath = exp(-rho * distanceToLight * .72);
   float falloff = u_lights[lightIndex].w / (.045 + distanceSquared);
   incoming += u_colours[lightIndex] * falloff * phase * lightPath * u_scatter;
  }
  radiance += transmission * (1. - attenuation) * incoming;
  transmission *= attenuation;
  point.z += stepSize;
  if (transmission < .001) break;
 }
 float alpha = 1. - transmission;
 gl_FragColor = vec4(clamp(radiance / max(alpha, .0001), 0., 1.), alpha);
}
`;

export function makeNoiseTexture(size = 256) {
 const values = new Uint8Array(size * size), rgba = new Uint8Array(size * size * 4);
 let seed = 0x5eaf67e6;
 for (let i = 0; i < values.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; values[i] = seed >>> 24; }
 for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = (y * size + x) * 4;
  rgba[i] = values[y * size + x]; rgba[i + 1] = values[((y + 239) % size) * size + (x + 37) % size]; rgba[i + 3] = 255;
 }
 return rgba;
}
const TAU = Math.PI * 2;
const fract = x => x - Math.floor(x);
function pulse(value, center, width) { const d = Math.abs(fract(value) - center); return Math.exp(-2 * (Math.min(d, 1 - d) / width) ** 2); }
function marqueePower(x, y, group, time) {
 const frame = group === 3;
 const position = frame ? Math.atan2((y - .55) / .34, (x - .815) / .145) / TAU + .5 : x * .79 + y * .21;
 const phase = position - time / (frame ? 7 : 9);
 return (frame ? .72 : .42) + 1.8 * pulse(phase, .22, frame ? .12 : .17) + .35 * pulse(phase, .70, .07);
}
// Luminous fixtures in the actual artwork; the billboard's cyan emission is steady.
const lamps = [
 [.18,.30,.04, .42, 1,[1,.69,.30]], [.387,.418,-.03,.27,0,[1,.16,.035]],
 [.607,.525,-.03,.23,0,[1,.20,.045]], [.473,.029,.22,.24,1,[1,.55,.16]],
 [.665,.025,.18,.24,1,[1,.56,.20]], [.689,.733,-.18,.31,3,[1,.38,.085]],
 [.895,.815,-.23,.31,3,[1,.38,.085]], [.812,.525,-.19,.52,4,[.22,.72,1]],
 [.51,.847,.02,.26,2,[1,.76,.42]],
];
export function fogLightUniforms(time = 0, buffers) {
 const result = buffers || { positions: new Float32Array(36), colours: new Float32Array(27) };
 const { positions, colours } = result;
 for (let index = 0; index < lamps.length; index++) {
  const [x,y,z,energy,group,colour] = lamps[index];
  if (!buffers) {
   positions.set([(x - .5) * 2.4, (.5 - y) * 1.5, z], index * 4);
   colours.set(colour, index * 3);
  }
  const strength = group === 4 ? 1 : marqueePower(x,y,group,time);
  positions[index * 4 + 3] = energy * Math.max(.08, strength);
 }
 return result;
}
export async function createFogRenderer(root, { signal } = {}) {
 const doc = root.ownerDocument, view = doc.defaultView;
 const artwork = root.querySelector('.airship-artwork'); await artwork.decode();
 if (signal?.aborted) return;
 const surface = doc.createElement('canvas'); surface.className = 'airship-fog'; surface.setAttribute('aria-hidden', 'true');
 const gl = surface.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false });
 if (!gl) return;
 const shaders = [], textures = [], lights = fogLightUniforms();
 let program, buffer, observer, uniforms, wake, elapsed = 0, disposed = false, dirty = true, drawnTime;
 function destroy() {
  if (disposed) return;
  disposed = true; observer?.disconnect(); wake?.destroy(); signal?.removeEventListener('abort', destroy); surface.remove();
  for (const texture of textures) gl.deleteTexture(texture);
  for (const shader of shaders) gl.deleteShader(shader);
  if (buffer) gl.deleteBuffer(buffer);
  if (program) gl.deleteProgram(program);
 }
 // Share the marquee's clock: background tabs and reduced motion stop both.
 function render(time = elapsed) {
  if (disposed) return;
  elapsed = time;
  if (!dirty && drawnTime === elapsed) return;
  if (wake.update(elapsed)) {
   gl.activeTexture(gl.TEXTURE0 + 2); gl.bindTexture(gl.TEXTURE_2D, textures[2]);
   gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, wake.width, wake.height, gl.RGBA, gl.UNSIGNED_BYTE, wake.data);
  }
  gl.uniform1f(uniforms.time, elapsed * FOG_SETTINGS.wind);
  fogLightUniforms(elapsed, lights); gl.uniform4fv(uniforms['lights[0]'], lights.positions);
  gl.drawArrays(gl.TRIANGLES,0,6);
  drawnTime = elapsed; dirty = false;
 }
 try {
  const compile = (type, source) => {
   const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
   if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
   return shader;
  };
  program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, fogVertexShader)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fogFragmentShader)); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  wake = createFogWake(surface);
  for (const [index,name] of [[0,'noise'],[1,'ship'],[2,'wake']]) {
   const texture = gl.createTexture(); textures.push(texture);
   gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, texture);
   for (const wrap of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,wrap,index ? gl.CLAMP_TO_EDGE : gl.REPEAT);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   if (index === 2) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,wake.width,wake.height,0,gl.RGBA,gl.UNSIGNED_BYTE,wake.data);
   }
   else if (index === 1) { gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,artwork); }
   else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,256,0,gl.RGBA,gl.UNSIGNED_BYTE,makeNoiseTexture());
   gl.uniform1i(gl.getUniformLocation(program,'u_' + name),index);
  }
  uniforms = Object.fromEntries(['time','density','scatter','night','lights[0]','colours[0]'].map(name=>[name,gl.getUniformLocation(program,'u_' + name)]));
  gl.uniform1f(uniforms.density, FOG_SETTINGS.density); gl.uniform1f(uniforms.scatter, FOG_SETTINGS.scatter); gl.uniform1f(uniforms.night, 0);
  gl.uniform3fv(uniforms['colours[0]'], lights.colours);
  const resize = () => {
   if (disposed) return;
   // Diffuse fog needs fewer pixels than the artwork beneath it. Keep the
   // 30fps movement, with a smaller surface and 16 samples through its volume.
   const width = Math.max(1, Math.min(640, Math.round(root.clientWidth * .6)));
   const height = Math.max(1, Math.round(width * artwork.naturalHeight / artwork.naturalWidth * 1.4 / 1.32));
   if (surface.width === width && surface.height === height) return;
   surface.width = width; surface.height = height; dirty = true;
   gl.viewport(0,0,surface.width,surface.height); render();
  };
  surface.addEventListener('webglcontextlost',event=>{event.preventDefault();destroy();});
  root.append(surface); observer = new view.ResizeObserver(resize); observer.observe(root); resize();
  signal?.addEventListener('abort', destroy, { once: true });
 } catch (error) {
  destroy(); throw error;
 }
 return { render, destroy, surface };
}
