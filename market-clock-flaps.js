import * as THREE from './assets/vendor/three/three.module.min.js';
import { canCatchFlaps, stepFlap } from './market-clock-flap-physics.js';

// The visible digit halves are hinged panels. A separate feed leaf advances a
// character while the panels are caught in their normal reading positions.
export function createFlapDisplay(parent, { invalidate, reducedMotion = () => false }) {
  const group = new THREE.Group();
  group.name = 'hinged-countdowns';
  group.position.z = .018;
  parent.add(group);
  const cache = new Map();
  const rows = [[], []];
  const texts = ['', ''];
  const orientation = new THREE.Quaternion();
  const gravity = new THREE.Vector3();
  let lastFrame = null;
  const dark = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: .55, metalness: .15 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: .25, metalness: .8 });

  function glyph(character, half, reverse = false) {
    const key = `${character}:${half}:${reverse}`;
    if (cache.has(key)) return cache.get(key);
    const full = document.createElement('canvas');
    full.width = 192; full.height = 256;
    const ctx = full.getContext('2d');
    ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, 192, 256);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 218px "DejaVu Sans Mono", monospace';
    ctx.fillText(character, 96, 132, 166);
    const canvas = document.createElement('canvas');
    canvas.width = 192; canvas.height = 128;
    canvas.getContext('2d').drawImage(full, 0, half === 'top' ? 0 : 128, 192, 128, 0, 0, 192, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      map: texture, roughness: .62, metalness: .05, envMapIntensity: .2,
      side: reverse ? THREE.BackSide : THREE.FrontSide,
    });
    cache.set(key, material);
    return material;
  }
  function makeCell(x, y, width, index, previous) {
    const cell = new THREE.Group(); cell.name = 'flap-cell'; cell.position.set(x, y, 0); group.add(cell);
    const height = .35, w = width - .012;
    const casing = new THREE.Mesh(new THREE.BoxGeometry(w + .008, height + .014, .035), dark);
    cell.add(casing);
    function half(side, name, old) {
      const hinge = new THREE.Group(); hinge.name = `${name}-hinge`;
      hinge.position.set(0, side * .004, .028); cell.add(hinge);
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, height / 2 - .007, .012), dark);
      body.position.y = side * height / 4; hinge.add(body);
      const geometry = new THREE.PlaneGeometry(w, height / 2 - .007);
      geometry.translate(0, side * height / 4, .0065);
      const face = new THREE.Mesh(geometry, glyph(' ', name)); face.name = `${name}-face`; hinge.add(face);
      const backGeometry = geometry.clone(); backGeometry.translate(0, 0, -.013);
      const uv = backGeometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      const back = new THREE.Mesh(backGeometry, glyph(' ', name, true)); hinge.add(back);
      const motion = old ? { ...old.motion } : { angle: 0, velocity: 0, latched: true, moving: false };
      hinge.rotation.x = side * motion.angle;
      return { hinge, face, back, side, motion, variation: .94 + ((index * 7 + side + 1) % 11) * .012 };
    }
    const top = half(1, 'top', previous?.top), bottom = half(-1, 'bottom', previous?.bottom);
    const pivot = new THREE.Group(); pivot.name = 'feed-hinge'; pivot.position.z = .044; cell.add(pivot);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, height / 2 - .003, .012), dark);
    leaf.position.y = height / 4; pivot.add(leaf);
    const frontGeometry = new THREE.PlaneGeometry(w, height / 2 - .003);
    frontGeometry.translate(0, height / 4, .0065);
    const front = new THREE.Mesh(frontGeometry, glyph(' ', 'top')); front.name = 'old-top'; pivot.add(front);
    const reverseGeometry = frontGeometry.clone(); reverseGeometry.translate(0, 0, -.013);
    const uv = reverseGeometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const reverse = new THREE.Mesh(reverseGeometry, glyph(' ', 'bottom', true)); reverse.name = 'new-bottom'; pivot.add(reverse);
    for (const side of [-1, 1]) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .025, 8), metal);
      pin.rotation.z = Math.PI / 2; pin.position.set(side * w / 2, 0, .035); cell.add(pin);
    }
    pivot.visible = false;
    return { cell, top, bottom, pivot, front, reverse, character: null, next: ' ', start: null, pending: null };
  }
  function faces(cell, character) {
    cell.top.face.material = glyph(character, 'top');
    cell.top.back.material = glyph(character, 'bottom', true);
    cell.bottom.face.material = glyph(character, 'bottom');
    cell.bottom.back.material = glyph(character, 'top', true);
  }
  function finish(cell) {
    cell.character = cell.next;
    faces(cell, cell.next);
    cell.pivot.visible = false;
    cell.start = null;
  }
  function turn(cell, character, now, delay) {
    if (cell.start !== null) finish(cell);
    cell.next = character;
    if (reducedMotion()) { finish(cell); return; }
    faces(cell, cell.character);
    cell.front.material = glyph(cell.character, 'top');
    cell.reverse.material = glyph(character, 'bottom', true);
    cell.pivot.rotation.x = 0;
    cell.pivot.visible = false;
    cell.start = now + delay;
  }
  return {
    update(statuses, now = performance.now()) {
      for (let i = 0; i < 2; i++) {
        const text = statuses?.[i]?.countdown || (statuses?.[i]?.phase === 'unknown' ? 'UNKNOWN' : '…');
        if (text === texts[i]) continue;
        texts[i] = text;
        if (rows[i].length !== text.length) {
          const previous = rows[i];
          for (const old of previous) {
            old.cell.traverse(node => node.geometry?.dispose()); group.remove(old.cell);
          }
          const width = Math.min(.252, 1.52 / text.length);
          rows[i] = [...text].map((_, j) => makeCell((j - (text.length - 1) / 2) * width, (.5 - (377 + i * 390) / 1024) * 2.05, width, j + i * 17, previous[j] || previous[0]));
        }
        rows[i].forEach((cell, j) => {
          if (cell.character === null) { cell.next = text[j]; finish(cell); }
          else if (cell.pending?.character !== text[j] && cell.next !== text[j]) {
            cell.pending = { character: text[j], at: now + j * 42 + i * 85 };
          } else if (cell.next === text[j]) cell.pending = null;
        });
      }
      invalidate();
    },
    replay(now = performance.now()) {
      rows.forEach((row, i) => row.forEach((cell, j) => {
        // Reload the same true value through the hinge, never invent countdown values.
        cell.pending = { character: cell.pending?.character ?? cell.next, at: now + j * 42 + i * 85 };
      }));
      invalidate();
    },
    animate(now) {
      // World down expressed in the display's coordinates includes the coin's
      // spin, its back-face orientation, and the subtle parent hover tilt.
      parent.getWorldQuaternion(orientation).invert();
      gravity.set(0, -1, 0).applyQuaternion(orientation);
      const elapsed = lastFrame === null ? 0 : Math.max(0, (now - lastFrame) / 1000);
      lastFrame = now;
      let active = false;
      for (const cell of rows.flat()) {
        if (reducedMotion()) {
          for (const panel of [cell.top, cell.bottom]) {
            panel.motion = { angle: 0, velocity: 0, latched: true, moving: false };
            panel.hinge.rotation.x = 0;
          }
          cell.next = cell.pending?.character ?? cell.next;
          cell.pending = null; finish(cell); continue;
        }
        for (const panel of [cell.top, cell.bottom]) {
          panel.motion = stepFlap(panel.motion, elapsed, gravity, panel);
          panel.hinge.rotation.x = panel.side * panel.motion.angle;
          active ||= panel.motion.moving;
        }
        const caught = cell.top.motion.latched && cell.bottom.motion.latched && canCatchFlaps(gravity);
        // Character feeds wait for the retaining clips. An in-flight feed may
        // finish, but never resets the positions or momentum of the panels.
        if (cell.pending && caught && cell.start === null) {
          const pending = cell.pending; cell.pending = null;
          turn(cell, pending.character, now, Math.max(0, pending.at - now));
        }
        if (cell.start === null) continue;
        const progress = (now - cell.start) / 520;
        if (progress >= 1) { finish(cell); continue; }
        active = true;
        if (progress < 0) continue;
        cell.top.face.material = glyph(cell.next, 'top');
        cell.pivot.visible = true;
        // A driven feed advances the character; the exposed panels above use gravity.
        const eased = progress < .75 ? (progress / .75) ** 2 * .94
          : .94 + .06 * Math.sin((progress - .75) / .25 * Math.PI / 2);
        cell.pivot.rotation.x = eased * Math.PI;
      }
      return active;
    },
  };
}
