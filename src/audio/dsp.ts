// A tiny DSP kit for synthesising the game's sounds in plain TypeScript (no AudioContext): seeded noise, biquad
// filters, wavetable / polyBLEP oscillators, envelopes, a small "Freeverb"-style arena reverb, normalising and
// seamless loops. Everything writes into Float32Arrays, so the sound bank can be built and tested in Node
// and handed to WebAudio as plain buffers (no OfflineAudioContext round trips at start-up).

/** A rendered sound: one (mono) or two (stereo) channels at `sr` samples per second. */
export interface Pcm {
  sr: number;
  ch: Float32Array[];
}

export const TAU = Math.PI * 2;

/** Below this a recursive filter's state is flushed to zero (inaudible, and keeps the maths off subnormals). */
const DENORMAL = 1e-24;

/** Seeded uniform random numbers in [0, 1) (mulberry32). */
export function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pcm(seconds: number, sr: number, channels = 1): Pcm {
  const n = Math.max(1, Math.ceil(seconds * sr));
  const ch: Float32Array[] = [];
  for (let c = 0; c < channels; c++) ch.push(new Float32Array(n));
  return { sr, ch };
}

export function lengthOf(p: Pcm): number {
  return p.ch[0].length;
}

// ---- filters ------------------------------------------------------------------------------------------------------

/** RBJ biquad (transposed direct form II). Set it with lp / hp / bp, then run one sample at a time. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  private set(kind: 'lp' | 'hp' | 'bp', f: number, q: number, sr: number): this {
    const w = (TAU * Math.min(Math.max(f, 10), sr * 0.45)) / sr;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Math.max(q, 0.05));
    const a0 = 1 + alpha;
    let b0: number, b1: number, b2: number;
    if (kind === 'lp') {
      b1 = (1 - cw) / a0;
      b0 = b2 = b1 / 2;
    } else if (kind === 'hp') {
      b1 = -(1 + cw) / a0;
      b0 = b2 = -b1 / 2;
    } else {
      // constant 0 dB peak gain
      b0 = alpha / a0;
      b1 = 0;
      b2 = -b0;
    }
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  lp(f: number, q: number, sr: number): this {
    return this.set('lp', f, q, sr);
  }

  hp(f: number, q: number, sr: number): this {
    return this.set('hp', f, q, sr);
  }

  bp(f: number, q: number, sr: number): this {
    return this.set('bp', f, q, sr);
  }

  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    // flush decaying tails before they reach subnormal numbers (which are ~100x slower to compute with)
    if (this.z1 < DENORMAL && this.z1 > -DENORMAL) this.z1 = 0;
    if (this.z2 < DENORMAL && this.z2 > -DENORMAL) this.z2 = 0;
    return y;
  }
}

/** One-pole low-pass, cheap smoothing. */
export class OnePole {
  private y = 0;
  private k: number;
  constructor(f: number, sr: number) {
    this.k = 1 - Math.exp((-TAU * f) / sr);
  }
  run(x: number): number {
    this.y += this.k * (x - this.y);
    if (this.y < DENORMAL && this.y > -DENORMAL) this.y = 0;
    return this.y;
  }
}

// ---- oscillators --------------------------------------------------------------------------------------------------

const TABLE = 2048;

/** A single-cycle wavetable from harmonic amplitudes (index 0 = fundamental). */
export function table(harmonics: number[]): Float32Array {
  const t = new Float32Array(TABLE + 1);
  for (let i = 0; i <= TABLE; i++) {
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) if (harmonics[h]) v += harmonics[h] * Math.sin((TAU * (h + 1) * i) / TABLE);
    t[i] = v;
  }
  let peak = 0;
  for (let i = 0; i < t.length; i++) peak = Math.max(peak, Math.abs(t[i]));
  for (let i = 0; i < t.length; i++) t[i] /= peak || 1;
  return t;
}

export const SINE = table([1]);
/** Soft "chime" body: fundamental + a little octave and twelfth. */
export const SOFT = table([1, 0.32, 0.12, 0.05]);
/** Brass-like: band-limited saw up to 24 harmonics. */
export const SAW = table(Array.from({ length: 24 }, (_, i) => 1 / (i + 1)));

/** Read a wavetable at phase 0..1 (linear interpolation). */
export function look(t: Float32Array, phase: number): number {
  const x = (phase - Math.floor(phase)) * TABLE;
  const i = x | 0;
  return t[i] + (t[i + 1] - t[i]) * (x - i);
}

/** polyBLEP correction for a saw (alias-reduced), `p` phase 0..1, `dt` phase step. */
export function blep(p: number, dt: number): number {
  if (p < dt) {
    const t = p / dt;
    return t + t - t * t - 1;
  }
  if (p > 1 - dt) {
    const t = (p - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

// ---- envelopes and shaping ----------------------------------------------------------------------------------------

/** Attack (linear) then exponential decay with time constant `tau` (seconds). 0 before t = 0. */
export function ad(t: number, attack: number, tau: number): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / tau);
}

/** Exponential glide from f0 to f1 over `len` seconds (holds f1 after). */
export function glide(f0: number, f1: number, t: number, len: number): number {
  const k = Math.min(1, Math.max(0, t / len));
  return f0 * Math.pow(f1 / f0, k);
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Soft saturation, unity gain for small signals. */
export function sat(x: number, drive: number): number {
  return Math.tanh(x * drive) / Math.tanh(drive);
}

export function peakOf(p: Pcm): number {
  let m = 0;
  for (const c of p.ch) for (let i = 0; i < c.length; i++) {
    const v = c[i] < 0 ? -c[i] : c[i];
    if (v > m) m = v;
  }
  return m;
}

/** Scale so the loudest sample is `peak`; short fades at both ends so nothing clicks (0 = no fade, for loops). */
export function finish(p: Pcm, peak = 0.9, fadeIn = 0.0005, fadeOut = 0.02): Pcm {
  const m = peakOf(p);
  const g = m > 0 ? peak / m : 0;
  // a fade of 0 leaves that end untouched (loops)
  const fi = Math.round(fadeIn * p.sr);
  const fo = Math.round(fadeOut * p.sr);
  for (const c of p.ch) {
    const n = c.length;
    for (let i = 0; i < n; i++) c[i] *= g;
    for (let i = 0; i < Math.min(fi, n); i++) c[i] *= i / fi;
    for (let i = 0; i < Math.min(fo, n); i++) c[n - 1 - i] *= i / fo;
  }
  return p;
}

/** Mono -> stereo (copies the channel). */
export function stereo(p: Pcm): Pcm {
  if (p.ch.length === 2) return p;
  return { sr: p.sr, ch: [p.ch[0], p.ch[0].slice()] };
}

/** Add `src` into `dst` from `at` seconds, scaled by `gain` (mono src goes to every channel). */
export function mixInto(dst: Pcm, src: Pcm, at: number, gain = 1): void {
  const off = Math.round(at * dst.sr);
  for (let c = 0; c < dst.ch.length; c++) {
    const s = src.ch[Math.min(c, src.ch.length - 1)];
    const d = dst.ch[c];
    const n = Math.min(s.length, d.length - off);
    for (let i = Math.max(0, -off); i < n; i++) d[off + i] += s[i] * gain;
  }
}

/**
 * Wrap a buffer that was rendered `loopSeconds` long plus a tail: everything after the loop point is added back onto
 * the start (circular rendering), so the loop is exactly seamless, with the same density across the seam.
 */
export function fold(p: Pcm, loopSeconds: number): Pcm {
  const n = Math.round(loopSeconds * p.sr);
  const ch = p.ch.map(c => {
    const o = c.slice(0, n);
    for (let i = n; i < c.length; i++) o[i % n] += c[i];
    return o;
  });
  return { sr: p.sr, ch };
}

// ---- arena reverb -------------------------------------------------------------------------------------------------

class Comb {
  private buf: Float32Array;
  private i = 0;
  private store = 0;
  constructor(len: number, private fb: number, private damp: number) {
    this.buf = new Float32Array(Math.max(1, len));
  }
  run(x: number): number {
    const y = this.buf[this.i];
    this.store = y * (1 - this.damp) + this.store * this.damp;
    if (this.store < DENORMAL && this.store > -DENORMAL) this.store = 0;
    this.buf[this.i] = x + this.store * this.fb;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  }
}

class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(len: number) {
    this.buf = new Float32Array(Math.max(1, len));
  }
  run(x: number): number {
    const b = this.buf[this.i];
    const w = x + b * 0.5;
    this.buf[this.i] = w < DENORMAL && w > -DENORMAL ? 0 : w;
    if (++this.i >= this.buf.length) this.i = 0;
    return b - x;
  }
}

export interface ReverbOpts {
  /** Comb feedback 0..0.98: tail length. */
  size: number;
  /** High-frequency damping 0..1. */
  damp: number;
  wet: number;
  dry?: number;
  /** Pre-delay (seconds). */
  pre?: number;
}

/** A light Freeverb-style hall (4 combs + 2 allpasses per side). Returns a stereo buffer the same length. */
export function reverb(p: Pcm, o: ReverbOpts): Pcm {
  const sr = p.sr;
  const s = sr / 44100;
  const n = lengthOf(p);
  const out = pcm(n / sr, sr, 2);
  const pre = Math.round((o.pre ?? 0.012) * sr);
  const dry = o.dry ?? 1;
  for (let side = 0; side < 2; side++) {
    const spread = side * 23;
    const combs = [1116, 1188, 1277, 1356].map(d => new Comb(Math.round((d + spread) * s), o.size, o.damp));
    const aps = [556, 441].map(d => new Allpass(Math.round((d + spread) * s)));
    const src = p.ch[Math.min(side, p.ch.length - 1)];
    const mono = p.ch.length === 2 ? null : src;
    const dst = out.ch[side];
    for (let i = 0; i < n; i++) {
      const j = i - pre;
      const x = j >= 0 ? (mono ? mono[j] : (p.ch[0][j] + p.ch[1][j]) * 0.5) * 0.12 : 0;
      let y = combs[0].run(x) + combs[1].run(x) + combs[2].run(x) + combs[3].run(x);
      y = aps[1].run(aps[0].run(y));
      dst[i] = src[i] * dry + y * o.wet;
    }
  }
  return out;
}
