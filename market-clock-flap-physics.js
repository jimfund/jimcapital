// Opening angles are measured away from the display. The two leaves turn in
// opposite directions and stop just short of meeting above the centre rail.
export const FLAP_LIMIT = Math.PI / 2 - .035;
export const canCatchFlaps = gravity => gravity.y < -.86 && Math.abs(gravity.z) < .22;

export function stepFlap(state, elapsed, gravity, { side = 1, variation = 1 } = {}) {
  let { angle, velocity, latched } = state;
  if (latched) {
    if (gravity.z <= .3 * variation && gravity.y <= .25) {
      return { angle: 0, velocity: 0, latched: true, moving: false };
    }
    latched = false;
    velocity = .08; // A small release from the retaining clip.
  }
  const catching = canCatchFlaps(gravity);
  // The return spring and clip preload draw a nearly upright leaf fully home,
  // even with a slight residual tilt. Release and capture use different angles.
  const torque = () => 80 * variation * (gravity.z * Math.cos(angle) - side * gravity.y * Math.sin(angle))
    - (catching ? 140 * angle + 20 : 0);
  let remaining = Math.min(.05, Math.max(0, elapsed));
  while (remaining > 0) {
    const dt = Math.min(remaining, 1 / 240);
    remaining -= dt;
    velocity += (torque() - (catching ? 14 : 2.8 * variation) * velocity) * dt;
    angle += velocity * dt;
    if (angle < 0 || angle > FLAP_LIMIT) {
      angle = Math.max(0, Math.min(FLAP_LIMIT, angle));
      velocity *= -.16;
      if (Math.abs(velocity) < .12) velocity = 0;
    }
    if (catching && angle < .012 && Math.abs(velocity) < .2) {
      return { angle: 0, velocity: 0, latched: true, moving: false };
    }
  }
  const force = torque();
  const supported = (angle === 0 && force <= 0) || (angle === FLAP_LIMIT && force >= 0);
  const resting = Math.abs(velocity) < .003 && (supported || Math.abs(force) < .035);
  return { angle, velocity: resting ? 0 : velocity, latched, moving: !resting };
}
