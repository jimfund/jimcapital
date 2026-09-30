// The original GIF has ten frames: nine at 100 ms, then the uncapped pen.
// Play its sprite frames forward to open, backward to close, and hold at either end.
export function animatePenLink(link) {
  const image = link.querySelector('img');
  const win = link.ownerDocument.defaultView;
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  let hovered = false, keyboardFocused = false, active = false;
  let animation = null, started = 0, frame = 0, origin = 0, direction = 1;

  function show(nextFrame) {
    frame = nextFrame;
    image.style.transform = `translateX(${-frame * 10}%)`;
  }
  function stop() {
    if (animation !== null) win.cancelAnimationFrame(animation);
    animation = null;
  }
  function tick(now) {
    const steps = Math.floor((now - started) / 100);
    show(Math.max(0, Math.min(9, origin + direction * steps)));
    animation = frame !== (active ? 9 : 0) ? win.requestAnimationFrame(tick) : null;
  }
  function update() {
    const next = hovered || keyboardFocused;
    if (next === active) return;
    active = next;
    stop();
    if (reducedMotion.matches) return show(active ? 9 : 0);
    if (frame === (active ? 9 : 0)) return;
    origin = frame;
    direction = active ? 1 : -1;
    started = win.performance.now();
    animation = win.requestAnimationFrame(tick);
  }

  link.addEventListener('pointerenter', event => {
    if (event.pointerType === 'touch') return;
    hovered = true;
    update();
  });
  link.addEventListener('pointerleave', () => { hovered = false; update(); });
  link.addEventListener('pointercancel', () => { hovered = false; update(); });
  link.addEventListener('focus', () => {
    keyboardFocused = link.matches(':focus-visible');
    update();
  });
  link.addEventListener('blur', () => { keyboardFocused = false; update(); });
  // Clicking the link must not leave it open after the pointer moves away.
  link.addEventListener('pointerdown', () => { keyboardFocused = false; update(); });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) { stop(); show(active ? 9 : 0); }
  });
  show(0);
}
