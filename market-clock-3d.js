import { createFlapDisplay } from './market-clock-flaps.js';
import { drawClockDisplay } from './market-clock-display.js';
import * as THREE from './assets/vendor/three/three.module.min.js';

// Real, bevelled geometry with a polished stone material and reflected studio lights.
export function createClock3D(host, { displayStyle = 'classic' } = {}) {
  const mechanical = displayStyle === 'marble-flap';
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xffffff, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const canvas = renderer.domElement;
  canvas.className = 'clock-sculpture';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.z = 4.5;
  const presentation = new THREE.Group();
  const sculpture = new THREE.Group();
  presentation.add(sculpture);
  scene.add(presentation);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x313139, 2));
  const key = new THREE.DirectionalLight(0xffffff, 4);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 3);
  rim.position.set(4, -2, -3);
  scene.add(rim);

  const studio = document.createElement('canvas');
  studio.width = 1024; studio.height = 512;
  const light = studio.getContext('2d');
  light.fillStyle = '#28282c'; light.fillRect(0, 0, 1024, 512);
  for (const [x, y, w, h] of [[100, 70, 170, 270], [660, 140, 70, 270], [380, 20, 300, 45]]) {
    light.fillStyle = '#ffffff'; light.fillRect(x, y, w, h);
  }
  let environment;
  function lightEnvironment() {
    const studioTexture = new THREE.CanvasTexture(studio);
    studioTexture.mapping = THREE.EquirectangularReflectionMapping;
    studioTexture.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment?.dispose();
    environment = pmrem.fromEquirectangular(studioTexture);
    scene.environment = environment.texture;
    studioTexture.dispose(); pmrem.dispose();
  }
  lightEnvironment();

  const stoneCanvas = document.createElement('canvas');
  stoneCanvas.width = stoneCanvas.height = 512;
  const stoneContext = stoneCanvas.getContext('2d');
  const pixels = stoneContext.createImageData(512, 512);
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  function turbulence(x, y) {
    let value = 0, weight = .5;
    for (let octave = 0; octave < 5; octave++) {
      value += noise(x, y) * weight;
      x = x * 2.03 + 7.1; y = y * 2.03 + 3.7; weight *= .5;
    }
    return value;
  }
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const cloud = turbulence(x / 125, y / 125);
    const wave = Math.sin(x * .025 + y * .011 + cloud * 12);
    const vein = Math.pow(Math.max(0, 1 - Math.abs(wave) * 12), 2);
    const value = 16 + 64 * vein + 12 * cloud;
    const i = (y * 512 + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    pixels.data[i + 3] = 255;
  }
  stoneContext.putImageData(pixels, 0, 0);
  const stoneTexture = new THREE.CanvasTexture(stoneCanvas);
  stoneTexture.colorSpace = THREE.SRGBColorSpace;
  stoneTexture.wrapS = stoneTexture.wrapT = THREE.RepeatWrapping;
  const marble = new THREE.MeshPhysicalMaterial({
    map: stoneTexture, color: 0xffffff, roughness: .19, metalness: .12,
    clearcoat: 1, clearcoatRoughness: .055, envMapIntensity: 1.5,
  });
  // Pale stone keeps the black dial clear; the edge and both faces share real depth.
  const paleCanvas = document.createElement('canvas');
  paleCanvas.width = paleCanvas.height = 512;
  const paleContext = paleCanvas.getContext('2d');
  const palePixels = paleContext.createImageData(512, 512);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = Math.max(105, 241 - (pixels.data[i] - 14) * 1.7);
    palePixels.data[i] = palePixels.data[i + 1] = palePixels.data[i + 2] = value;
    palePixels.data[i + 3] = 255;
  }
  paleContext.putImageData(palePixels, 0, 0);
  const paleTexture = new THREE.CanvasTexture(paleCanvas);
  paleTexture.colorSpace = THREE.SRGBColorSpace;
  paleTexture.wrapS = paleTexture.wrapT = THREE.RepeatWrapping;
  const paleMarble = new THREE.MeshPhysicalMaterial({
    map: paleTexture, roughness: .2, metalness: 0,
    clearcoat: 1, clearcoatRoughness: .045, envMapIntensity: 1.2,
  });
  const discShape = new THREE.Shape();
  discShape.absarc(0, 0, 1.09, 0, Math.PI * 2, false);
  const discGeometry = new THREE.ExtrudeGeometry(discShape, {
    depth: .22, steps: 1, curveSegments: 96,
    bevelEnabled: true, bevelSegments: 5, bevelSize: .035, bevelThickness: .035,
  });
  function stoneUV(geometry) {
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      uv.setXY(i, (position.getX(i) + 1.13) / 2.26, (position.getY(i) + 1.13) / 2.26);
    }
  }
  discGeometry.translate(0, 0, -.11);
  stoneUV(discGeometry);
  sculpture.add(new THREE.Mesh(discGeometry, paleMarble));
  const arcs = new THREE.Group();
  arcs.position.z = .151;
  sculpture.add(arcs);
  function extrude(shape, depth = .012) {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: 72,
      bevelEnabled: true, bevelSegments: 3, bevelSize: .003, bevelThickness: .003,
    });
    geometry.translate(0, 0, -depth / 2);
    stoneUV(geometry);
    return new THREE.Mesh(geometry, marble);
  }
  const shape = new THREE.Shape();
  const r = 12 / Math.sqrt(3) / 106;
  shape.moveTo(0, r); shape.lineTo(-6 / 106, -r / 2);
  shape.lineTo(6 / 106, -r / 2); shape.closePath();
  const marker = extrude(shape, .012);
  sculpture.add(marker);

  // The reverse screen is recessed within the polished marble rim.
  const back = new THREE.Group();
  back.rotation.x = Math.PI;
  back.position.z = -.147;
  sculpture.add(back);
  const backing = new THREE.Mesh(new THREE.CircleGeometry(1.025, 128), mechanical ? paleMarble : marble);
  back.add(backing);
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = screenCanvas.height = 1024;
  const screenContext = screenCanvas.getContext('2d');
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  const screenMaterial = new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false, transparent: mechanical, depthWrite: !mechanical });
  const screen = new THREE.Mesh(new THREE.CircleGeometry(1.025, 128), screenMaterial);
  screen.position.z = .002;
  back.add(screen);

  let flaps;
  let frame = 0;
  let contextLost = false;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let hoverAmount = 0, hoverFrom = 0, hoverTarget = 0, hoverStarted = 0;
  const render = () => {
    if (frame || contextLost || document.hidden) return;
    frame = requestAnimationFrame(now => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, (now - hoverStarted) / 240));
      hoverAmount = hoverFrom + (hoverTarget - hoverFrom) * (1 - (1 - progress) ** 3);
      presentation.rotation.set(-hoverAmount * .045, hoverAmount * .10, 0);
      const moving = flaps?.animate(now);
      renderer.render(scene, camera);
      if (moving || (progress < 1 && hoverFrom !== hoverTarget)) render();
    });
  };
  function hover(target) {
    if (target === hoverTarget) return;
    hoverFrom = hoverAmount;
    hoverTarget = target;
    hoverStarted = performance.now();
    render();
  }
  host.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse' && !preference.matches) hover(1);
  });
  host.addEventListener('pointerleave', () => hover(0));
  host.addEventListener('pointercancel', () => hover(0));
  preference.addEventListener('change', () => {
    if (!preference.matches) return;
    hoverAmount = hoverFrom = hoverTarget = 0;
    render();
  });
  if (mechanical) {
    flaps = createFlapDisplay(back, { invalidate: render, reducedMotion: () => preference.matches });
  }
  function resize() {
    renderer.setSize(host.clientWidth || 300, host.clientWidth || 300, false);
    render();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true; host.classList.remove('is-3d');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false; lightEnvironment(); host.classList.add('is-3d'); render();
  });
  resize();
  host.classList.add('is-3d');

  let sessionKey = '';
  let displayKey = '';
  return {
    rotate(degrees) {
      sculpture.rotation.x = degrees * Math.PI / 180;
      render();
    },
    replayFlaps() { flaps?.replay(); },
    update(minutes, windows, rows) {
      const angle = minutes / 1440 * Math.PI * 2;
      marker.position.set(Math.sin(angle) * 79 / 106, Math.cos(angle) * 79 / 106, .151);
      marker.rotation.z = -angle;
      const nextKey = JSON.stringify(windows);
      if (nextKey !== sessionKey) {
        sessionKey = nextKey;
        for (const mesh of [...arcs.children]) { arcs.remove(mesh); mesh.geometry.dispose(); }
        for (const [start, end] of windows) {
          const from = Math.PI / 2 - end / 1440 * Math.PI * 2;
          const to = Math.PI / 2 - start / 1440 * Math.PI * 2;
          const arc = new THREE.Shape();
          const outer = 1 + 3 / 106, inner = 1 - 3 / 106;
          arc.absarc(0, 0, outer, from, to, false);
          arc.lineTo(inner * Math.cos(to), inner * Math.sin(to));
          arc.absarc(0, 0, inner, to, from, true);
          arc.closePath(); arcs.add(extrude(arc));
        }
      }
      const nextDisplayKey = JSON.stringify(rows);
      if (nextDisplayKey !== displayKey) {
        displayKey = nextDisplayKey;
        drawClockDisplay(screenContext, rows, displayStyle, { overlay: mechanical });
        flaps?.update(rows);
        screenTexture.needsUpdate = true;
      }
      render();
    },
  };
}
