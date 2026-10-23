// Math helpers incl. the decoded input-feel filters (docs/11 §1-2). All pure functions / tiny classes.

export const EPS = 1.1920929e-7; // FLT_EPSILON, used as a zero-guard in the reference
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Reference "RangeToRatio": clamp((a-x)/(y-x),0,1); 0 when |y-x| <= EPS. */
export const rangeToRatio = (a, x, y) => (Math.abs(y - x) > EPS ? clamp((a - x) / (y - x), 0, 1) : 0);
export const sign = (x) => (x < 0 ? -1 : 1);

export const wrapPi = (a) => {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
};
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const angleDiff = (a, b) => wrapPi(a - b);

export const v2 = (x = 0, y = 0) => ({ x, y });
export const vAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const vSub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const vScale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const vLen = (a) => Math.hypot(a.x, a.y);
export const vDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const vDot = (a, b) => a.x * b.x + a.y * b.y;
export const vNorm = (a) => { const l = Math.hypot(a.x, a.y); return l > EPS ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }; };
export const vFromAngle = (t) => ({ x: Math.cos(t), y: Math.sin(t) });
export const vAngle = (a) => Math.atan2(a.y, a.x);

/**
 * Decoded "LocoSpeedByAngle": 8-knot circular speed table, linear interpolation.
 * angle in radians (-π..π), 0 = straight ahead; D = [D1..D8] at knots 0, π/4, π/2, 3π/4, ±π, -3π/4, -π/2, -π/4.
 */
export function locoSpeedByAngle(angle, D) {
  const a = wrapPi(angle);
  const Q = Math.PI / 4;
  const seg = (lo, hi, vLo, vHi) => vLo + ((a - lo) * (vHi - vLo)) / (hi - lo);
  if (a > 3 * Q) return seg(3 * Q, Math.PI, D[3], D[4]);
  if (a > 2 * Q) return seg(2 * Q, 3 * Q, D[2], D[3]);
  if (a > Q) return seg(Q, 2 * Q, D[1], D[2]);
  if (a > 0) return seg(0, Q, D[0], D[1]);
  if (a > -Q) return seg(-Q, 0, D[7], D[0]);
  if (a > -2 * Q) return seg(-2 * Q, -Q, D[6], D[7]);
  if (a > -3 * Q) return seg(-3 * Q, -2 * Q, D[5], D[6]);
  return seg(-Math.PI, -3 * Q, D[4], D[5]);
}

/** Decoded "GreaterThanWithHysteresis" (Schmitt trigger): result = a > (prev ? b2 : b1). */
export const greaterThanWithHysteresis = (a, b1, b2, prev) => a > (prev ? b2 : b1);
export const lessThanWithHysteresis = (a, b1, b2, prev) => a < (prev ? b2 : b1);

/** Decoded "DeadZoneFilter": a leash. Output trails the input at most `radius` away. */
export class LeashFilter {
  constructor() { this.last = null; }
  update(input, radius, reset = false) {
    if (!this.last) this.last = { ...input };
    if (reset) { this.last = { ...input }; return { ...input }; }
    const dx = input.x - this.last.x, dy = input.y - this.last.y;
    const d = Math.hypot(dx, dy);
    if (d <= radius) return { ...this.last };
    if (radius <= 0) { this.last = { ...input }; return { ...input }; }
    const k = (d - radius) / d;
    this.last = { x: this.last.x + dx * k, y: this.last.y + dy * k };
    return { ...this.last };
  }
}

/** Decoded "ApproachFilter": eased chase with decel zone and snap distance (speed is per-second; /60 as in the original). */
export function approachFilter(inPos, target, decelDistance, maxApproachSpeed, snapDistance, dt) {
  const diff = target - inPos;
  const dist = Math.abs(diff);
  const v = maxApproachSpeed / 60;
  let step = diff;
  if (v > 0 && dist > snapDistance && dt > 0) {
    step = diff * v * dt;
    if (dist < decelDistance) { const f = dist / decelDistance; step *= f * f; }
  }
  if (!(dt > 0)) return { position: inPos, speed: 0 };
  if (Math.abs(step) > dist) return { position: target, speed: dist / dt * Math.sign(diff || 1) };
  return { position: inPos + step, speed: step / dt };
}

/** Triangle (ping-pong) wave used by the reference's needle meter: x in passes → t in [0,1]. */
export function pingPong(x) {
  const n = Math.floor(x);
  const f = x - n;
  return n % 2 === 1 ? 1 - f : f;
}

export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** Stable 32-bit FNV-1a over a list of numbers (for state hashes). */
export function hashNumbers(nums) {
  let h = 0x811c9dc5;
  for (const n of nums) {
    const q = Math.round(n * 1000) | 0;
    h ^= q & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
