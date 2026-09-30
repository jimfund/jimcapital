// The original GIF has ten frames: nine at 100 ms, then the uncapped pen.
// Its frames are stored side by side so playback can stop on the last one.
export function animatePenLink(link) {
  const image = link.querySelector('img');
  const win = link.ownerDocument.defaultView;
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  let hovered = false, keyboardFocused = false, active = false;
  let animation = null, started = 0;

  function show(frame) {
    image.style.transform = `translateX(${-frame * 10}%)`;
  }
  function stop() {
    if (animation !== null) win.cancelAnimationFrame(animation);
    animation = null;
  }
  function tick(now) {
    const frame = Math.min(9, Math.floor((now - started) / 100));
    show(frame);
    animation = frame < 9 ? win.requestAnimationFrame(tick) : null;
  }
  function update() {
    const next = hovered || keyboardFocused;
    if (next === active) return;
    active = next;
    stop();
    if (!active) return show(0);
    if (reducedMotion.matches) return show(9);
    show(0);
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
    if (active && reducedMotion.matches) { stop(); show(9); }
  });
  show(0);
}
