// Degrees, seconds, and angular velocity in degrees per second.
export function stepSpin(state, elapsed) {
  let { angle, velocity, target } = state;
  let remaining = Math.min(Math.max(elapsed, 0), .05);
  while (remaining > 0) {
    const dt = Math.min(remaining, 1 / 120);
    remaining -= dt;
    if (target === null) {
      const decay = Math.exp(-2.4 * dt);
      angle += velocity * (1 - decay) / 2.4;
      velocity *= decay;
      // A gentle detent leaves either face readable instead of stopping edge-on.
      if (Math.abs(velocity) < 75) target = state.destination ?? Math.round(angle / 180) * 180;
    } else {
      velocity += ((target - angle) * 90 - velocity * 14) * dt;
      angle += velocity * dt;
    }
  }
  const done = target !== null && Math.abs(target - angle) < .04 && Math.abs(velocity) < .15;
  return { ...state, angle: done ? target : angle, velocity: done ? 0 : velocity, target, done };
}

export function clickSpin(angle, direction = 1) {
  const destination = Math.round(angle / 180) * 180 + 540 * direction;
  return { angle, velocity: (destination - angle) * 2.4, target: null, destination };
}

export function releaseVelocity(samples, now) {
  const recent = samples.filter(sample => now - sample.time <= 100);
  if (recent.length < 2) return 0;
  const first = recent[0], last = recent.at(-1);
  const elapsed = last.time - first.time;
  if (elapsed < 8) return 0;
  return Math.max(-1440, Math.min(1440, (last.angle - first.angle) * 1000 / elapsed));
}

export function attachClockPhysics(button, getRotation, setRotation) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let drag = null;
  let motion = null;
  let frame = 0;
  let lastFrame = 0;
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    motion = null;
  }
  function tick(now) {
    frame = 0;
    motion = stepSpin(motion, (now - lastFrame) / 1000);
    lastFrame = now;
    setRotation(motion.angle);
    if (motion.done) {
      setRotation(motion.angle % 360);
      motion = null;
    } else {
      frame = requestAnimationFrame(tick);
    }
  }
  function sample(now) {
    drag.samples.push({ angle: getRotation(), time: now });
    drag.samples = drag.samples.filter(item => now - item.time <= 120);
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.distance = Math.max(drag.distance, Math.hypot(event.clientX - drag.x, (event.clientY || 0) - drag.y));
    if (drag.distance > 5) setRotation(drag.angle + (event.clientX - drag.x) * 180 / drag.width);
    sample(performance.now());
  }
  function flip(direction = 1) {
    stop();
    motion = clickSpin(getRotation(), direction);
    if (reducedMotion.matches) {
      setRotation(motion.destination % 360);
      motion = null;
      return;
    }
    lastFrame = performance.now();
    frame = requestAnimationFrame(tick);
  }
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || drag) return;
    event.preventDefault();
    stop();
    drag = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY || 0, distance: 0, angle: getRotation(),
      width: Math.max(1, button.getBoundingClientRect().width), samples: [],
    };
    sample(performance.now());
    button.setPointerCapture(event.pointerId);
    button.focus({ preventScroll: true });
    button.classList.add('is-dragging');
  });
  button.addEventListener('pointermove', move);
  function finish(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.type === 'pointerup') move(event);
    const velocity = releaseVelocity(drag.samples, performance.now());
    const tapped = drag.distance <= 5;
    drag = null;
    button.classList.remove('is-dragging');
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    if (event.type !== 'pointerup') return;
    if (tapped) {
      const bounds = button.getBoundingClientRect();
      flip(event.clientY < bounds.top + bounds.height / 2 ? 1 : -1);
      return;
    }
    if (reducedMotion.matches) {
      setRotation(Math.round(getRotation() / 180) * 180 % 360);
      return;
    }
    motion = { angle: getRotation(), velocity, target: null };
    lastFrame = performance.now();
    frame = requestAnimationFrame(tick);
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, finish);
  button.addEventListener('click', event => {
    // Pointer taps are handled on release; zero-detail clicks cover assistive activation.
    if (event.detail === 0 && !drag) flip();
  });
  button.addEventListener('keydown', event => {
    if (drag || !['ArrowLeft', 'ArrowRight', 'Home', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter' || event.key === ' ') { if (!event.repeat) flip(); return; }
    stop();
    setRotation(event.key === 'Home' ? 0 : getRotation() + (event.key === 'ArrowLeft' ? -15 : 15));
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    stop();
    if (drag) finish({ type: 'pointercancel', pointerId: drag.pointerId });
  });
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches || !motion) return;
    const destination = motion.destination ?? Math.round(getRotation() / 180) * 180;
    stop();
    setRotation(destination % 360);
  });
}
