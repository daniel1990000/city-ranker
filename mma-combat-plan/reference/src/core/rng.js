// Deterministic randomness. Everything in the sim draws from NAMED STREAMS derived from one fight seed,
// so replays are exact and unrelated systems cannot perturb each other (docs/17 §3, §7).

/** FNV-1a 32-bit string hash. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: tiny, fast, 32-bit state, good enough for gameplay. Portable to any language with 32-bit int math. */
export class Rng {
  constructor(seed = 1) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }
  /** float in [0,1) */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** signed 32-bit integer (used as per-strike dice seed) */
  nextInt32() {
    return (Math.floor(this.next() * 4294967296) | 0);
  }
  /** integer in [0,n) */
  int(n) { return Math.floor(this.next() * n); }
  range(a, b) { return a + (b - a) * this.next(); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[this.int(arr.length)]; }
  /** weighted pick: items[i] has weight weights[i] (>=0). Returns index. */
  weightedIndex(weights) {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return this.int(weights.length);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
  /** independent child stream (deterministic in label + current state) */
  fork(label) { return new Rng((this.state ^ hashString(label)) >>> 0); }
  snapshot() { return this.state; }
  restore(s) { this.state = s >>> 0; }
}

/** Named streams from a single seed: streams.get('hit').next() … */
export class RngStreams {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.map = new Map();
  }
  get(name) {
    let r = this.map.get(name);
    if (!r) {
      r = new Rng((this.seed ^ hashString(name)) >>> 0);
      this.map.set(name, r);
    }
    return r;
  }
  snapshot() {
    const o = {};
    for (const [k, v] of this.map) o[k] = v.snapshot();
    return o;
  }
  restore(o) {
    for (const [k, s] of Object.entries(o)) this.get(k).restore(s);
  }
}

// ---------------------------------------------------------------------------------------------
// Reference-compatible dice (decoded from the reference binary's SwitchHealthEvent, docs/06 §3).
//   state' = state * 1103515245 + 12345  (64-bit product),  output = bits 16..47, scaled by 2^-32  → [0,1)
// ---------------------------------------------------------------------------------------------
export const LCG_A = 1103515245;
export const LCG_C = 12345;

/** 32x32 → 64 unsigned multiply via 16-bit limbs. Returns {hi, lo} as uint32s. */
export function mul32(a, b) {
  a >>>= 0; b >>>= 0;
  const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16;
  const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  const lo = ((mid & 0xffff) << 16 | (p00 & 0xffff)) >>> 0;
  const hi = (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16)) >>> 0;
  return { hi, lo };
}

/** One LCG step. Returns the new 32-bit state and a uniform value in [0,1). */
export function lcgStep(state) {
  const { hi, lo } = mul32(state, LCG_A);
  const lo2 = (lo + LCG_C) >>> 0;
  const hi2 = (hi + (lo2 < lo ? 1 : 0)) >>> 0;
  const out = (((hi2 << 16) | (lo2 >>> 16)) >>> 0);
  return { state: lo2, value: out * 2.3283064365386963e-10 };
}

/**
 * Pure (cold-path) form of the reference's SwitchHealthEvent dice.
 * Returns the two uniform draws r1 (gates the event) and r2 (gates replacing an active event).
 */
export function healthEventDice(randomSeed, newEventId) {
  const seed = randomSeed | 0;
  const seed1 = Math.imul(newEventId, seed) >>> 0;
  const seed2 = (Math.trunc(seed / (newEventId + 1)) | 0) >>> 0;
  return { r1: lcgStep(seed1).value, r2: lcgStep(seed2).value };
}
