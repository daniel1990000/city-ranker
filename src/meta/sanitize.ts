/**
 * Small, strict readers for untrusted data: a save from an older version, a hand-edited save code, a cloud copy,
 * a remote tuning file. Each one returns a value of the right type and range whatever it is given, so a corrupt
 * or crafted file can never stop the game from starting or smuggle in impossible values.
 *
 * Shared by the save (meta/save.ts) and every progress slot the content code registers (registerProgressSlot).
 */

/** A plain object, or an empty one. Arrays and null are not objects here. */
export function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** A finite number clamped to [lo, hi], or `def`. Numeric strings are not accepted (a save never stores them). */
export function num(v: unknown, def: number, lo = -Number.MAX_SAFE_INTEGER, hi = Number.MAX_SAFE_INTEGER): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
}

/** A whole number clamped to [lo, hi] (rounded down), or `def`. */
export function int(v: unknown, def: number, lo = -Number.MAX_SAFE_INTEGER, hi = Number.MAX_SAFE_INTEGER): number {
  return Math.floor(num(v, def, lo, hi));
}

/** A string cut to `max` characters, or `def`. */
export function str(v: unknown, def = '', max = 64): string {
  return typeof v === 'string' ? v.slice(0, max) : def;
}

/** Only a real boolean counts; anything else is `def`. */
export function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}

/** One of a fixed list of values, or `def`. */
export function oneOf<T extends string | number>(v: unknown, allowed: readonly T[], def: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : def;
}

/** Unique non-empty strings no longer than `maxLen`, at most `maxItems` of them (the last ones kept). */
export function strList(v: unknown, maxItems = 100, maxLen = 64, allowed?: (s: string) => boolean): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const x of v) if (typeof x === 'string' && x.length > 0 && x.length <= maxLen && (!allowed || allowed(x))) out.add(x);
  return [...out].slice(-maxItems);
}

/** Unique whole numbers in [lo, hi]. */
export function intSet(v: unknown, lo: number, hi: number, maxItems = 200): number[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<number>();
  for (const x of v) if (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi) out.add(x);
  return [...out].slice(0, maxItems);
}

/** A string-keyed map whose values pass `read` (entries it rejects with `undefined` are dropped). */
export function record<T>(v: unknown, read: (x: unknown, key: string) => T | undefined, maxKeys = 200, maxKeyLen = 48): Record<string, T> {
  const out: Record<string, T> = {};
  let n = 0;
  for (const [k, x] of Object.entries(obj(v))) {
    if (n >= maxKeys) break;
    if (!k || k.length > maxKeyLen || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const r = read(x, k);
    if (r === undefined) continue;
    out[k] = r;
    n++;
  }
  return out;
}

/** Size of a value as JSON text (0 when it can't be serialised), for keeping saves and codes bounded. */
export function jsonSize(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}
