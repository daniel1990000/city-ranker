// Integer maths for the fight simulation. Everything here is exact on every JavaScript engine: integer adds and
// multiplies stay far below 2^53, divisions are truncated, and the RNG is mulberry32 on 32-bit integers (Math.imul).
// No Math.random, Math.sin/cos/exp/pow or Date anywhere in src/game/fight (tests/fight-determinism.test.ts checks).

/** Clamp an integer to [lo, hi]. */
export function clampi(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Integer division truncated toward zero. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** a * b / c, truncated: the workhorse for "scale by a per-mille / per-10000 factor". */
export function muldiv(a: number, b: number, c: number): number {
  return Math.trunc((a * b) / c);
}

/** Scale `v` by a per-mille factor (1000 = unchanged), rounding to nearest. */
export function permille(v: number, pm: number): number {
  const p = v * pm;
  return p >= 0 ? Math.trunc((p + 500) / 1000) : -Math.trunc((-p + 500) / 1000);
}

/** Linear interpolation between integers by t in 0..1000, truncated. */
export function lerpi(a: number, b: number, t1000: number): number {
  return a + Math.trunc(((b - a) * t1000) / 1000);
}

// ---- seeded RNG ------------------------------------------------------------------------------------------------

/** Anything that carries an RNG state (the fight state, an AI's own state). */
export interface RngHolder {
  rng: number;
}

/** Mix a seed into a well-spread non-zero 32-bit state. */
export function seedRng(seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0 || 0x6d2b79f5;
}

/** Next 32-bit unsigned value (mulberry32), advancing the holder's state. */
export function rngNext(h: RngHolder): number {
  const s = (h.rng = (h.rng + 0x6d2b79f5) >>> 0);
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform integer in [0, n). Exact: the product stays below 2^53 and dividing by 2^32 is exact. */
export function rngInt(h: RngHolder, n: number): number {
  return Math.floor((rngNext(h) * n) / 4294967296);
}

/** Uniform integer in [lo, hi]. */
export function rngRange(h: RngHolder, lo: number, hi: number): number {
  return lo + rngInt(h, hi - lo + 1);
}

/** True with probability p / 10000. */
export function rngChance(h: RngHolder, p10000: number): boolean {
  return rngInt(h, 10000) < p10000;
}

/** Pick by integer weights (all >= 0; at least one > 0, else the first item). */
export function rngWeighted<T>(h: RngHolder, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i] > 0 ? weights[i] : 0;
  if (total <= 0) return items[0];
  let r = rngInt(h, total);
  for (let i = 0; i < items.length; i++) {
    const w = weights[i] > 0 ? weights[i] : 0;
    if (r < w) return items[i];
    r -= w;
  }
  return items[items.length - 1];
}

/**
 * Approximately normal integer noise with standard deviation `sd` (sum of four uniforms, Irwin-Hall), for the AI's
 * timing errors. Integer-only so it is the same everywhere.
 */
export function rngNoise(h: RngHolder, sd: number): number {
  // four uniforms in [0, 1000): mean 2000, sd ~577
  const s = rngInt(h, 1000) + rngInt(h, 1000) + rngInt(h, 1000) + rngInt(h, 1000) - 1998;
  return Math.trunc((s * sd) / 577);
}

// ---- hashing ---------------------------------------------------------------------------------------------------

/** FNV-1a style 32-bit mixing of one integer into a running hash. */
export function mixHash(h: number, v: number): number {
  h = Math.imul(h ^ (v & 0xffff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 16) & 0xffff), 0x01000193);
  // values above 2^32 (never expected in the state) still change the hash
  const hi = Math.floor(v / 4294967296);
  if (hi !== 0) h = Math.imul(h ^ (hi & 0xffffffff), 0x01000193);
  return h >>> 0;
}

/** Hash any plain JSON value (objects by sorted keys, so key order never matters). */
export function hashValue(h: number, v: unknown): number {
  if (v === null || v === undefined) return mixHash(h, 0x6e756c6c);
  switch (typeof v) {
    case 'number':
      if (Number.isInteger(v)) return mixHash(mixHash(h, 1), v);
      // a non-integer in the state is a bug (tests check there are none); hash its text so it still counts
      return hashString(mixHash(h, 2), String(v));
    case 'boolean':
      return mixHash(h, v ? 3 : 4);
    case 'string':
      return hashString(mixHash(h, 5), v);
    case 'object': {
      if (Array.isArray(v)) {
        h = mixHash(h, 6 + v.length * 16);
        for (let i = 0; i < v.length; i++) h = hashValue(h, v[i]);
        return h;
      }
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      h = mixHash(h, 7 + keys.length * 16);
      for (const k of keys) {
        if (o[k] === undefined) continue;
        h = hashString(h, k);
        h = hashValue(h, o[k]);
      }
      return h;
    }
    default:
      return mixHash(h, 8);
  }
}

function hashString(h: number, s: string): number {
  h = mixHash(h, s.length);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Deep copy of plain JSON data (objects, arrays, primitives): faster than structuredClone for small states. */
export function cloneData<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array<unknown>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = cloneData(v[i] as unknown);
    return out as T;
  }
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k in src) out[k] = cloneData(src[k]);
  return out as T;
}
