import * as THREE from './assets/vendor/three/three.module.min.js';

// One physical leaf folds down around the centre hinge: old top on its front,
// new bottom on its reverse. The fixed halves behind it finish the new glyph.
export function createFlapDisplay(parent, { invalidate, reducedMotion = () => false }) {
  const group = new THREE.Group();
  group.name = 'hinged-countdowns';
  group.position.z = .018;
  parent.add(group);
  const cache = new Map();
  const rows = [[], []];
  const texts = ['', ''];
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
  function makeCell(x, y, width) {
    const cell = new THREE.Group(); cell.name = 'flap-cell'; cell.position.set(x, y, 0); group.add(cell);
    const height = .35, w = width - .012;
    const casing = new THREE.Mesh(new THREE.BoxGeometry(w + .008, height + .014, .035), dark);
    cell.add(casing);
    function half(y) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, height / 2 - .003), glyph(' ', 'top'));
      mesh.position.set(0, y, .023); cell.add(mesh); return mesh;
    }
    const top = half(height / 4), bottom = half(-height / 4);
    top.name = 'fixed-top'; bottom.name = 'fixed-bottom';
    const pivot = new THREE.Group(); pivot.name = 'hinge'; pivot.position.z = .035; cell.add(pivot);
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
    return { cell, top, bottom, pivot, front, reverse, character: ' ', next: ' ', start: null };
  }
  function finish(cell) {
    cell.character = cell.next;
    cell.top.material = glyph(cell.next, 'top');
    cell.bottom.material = glyph(cell.next, 'bottom');
    cell.pivot.visible = false;
    cell.start = null;
  }
  function turn(cell, character, now, delay) {
    if (cell.start !== null) finish(cell);
    cell.next = character;
    if (reducedMotion()) { finish(cell); return; }
    cell.top.material = glyph(cell.character, 'top');
    cell.bottom.material = glyph(cell.character, 'bottom');
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
          for (const old of rows[i]) {
            old.cell.traverse(node => node.geometry?.dispose()); group.remove(old.cell);
          }
          const width = Math.min(.252, 1.52 / text.length);
          rows[i] = [...text].map((_, j) => makeCell((j - (text.length - 1) / 2) * width, (.5 - (377 + i * 390) / 1024) * 2.05, width));
        }
        rows[i].forEach((cell, j) => {
          if (cell.next !== text[j]) turn(cell, text[j], now, j * 42 + i * 85);
        });
      }
      invalidate();
    },
    replay(now = performance.now()) {
      rows.forEach((row, i) => row.forEach((cell, j) => {
        // Reload the same true value through the hinge, never invent countdown values.
        turn(cell, cell.next, now, j * 42 + i * 85);
      }));
      invalidate();
    },
    animate(now) {
      let active = false;
      for (const cell of rows.flat()) {
        if (cell.start === null) continue;
        if (reducedMotion()) { finish(cell); continue; }
        const progress = (now - cell.start) / 520;
        if (progress >= 1) { finish(cell); continue; }
        active = true;
        if (progress < 0) continue;
        cell.top.material = glyph(cell.next, 'top');
        cell.pivot.visible = true;
        // Accelerate under gravity, then cushion the landing on the lower half.
        const eased = progress < .75 ? (progress / .75) ** 2 * .94
          : .94 + .06 * Math.sin((progress - .75) / .25 * Math.PI / 2);
        cell.pivot.rotation.x = eased * Math.PI;
      }
      return active;
    },
  };
}
