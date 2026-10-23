// The crowd, synthesised: many voices (alias-reduced saws with their own pitch contour and vibrato) shaped by vowel
// formants, breathy noise, hand claps and the odd whistle, each stereo side from its own voices for width, then the
// arena reverb. Loops (the bed) are rendered circularly, so they repeat without a seam. Rendered at 22.05 kHz: a
// crowd has little above 8 kHz and this halves the start-up cost and the memory.

import { Biquad, OnePole, SINE, blep, finish, fold, look, reverb, rng, type Pcm } from './dsp';

export const CROWD_SR = 22050;
const BLOCK = 64;

export interface CrowdSpec {
  /** One-shots: the rendered length. Loops: the loop length (a tail is rendered and folded back onto the start). */
  seconds: number;
  loop?: boolean;
  seed: number;
  /** Voices per stereo side. */
  voices: number;
  /** When voices start (seconds). Loops always use [0, seconds). */
  start: [number, number];
  /** Voice length range (seconds). */
  len: [number, number];
  /** Fundamental range (Hz, picked log-uniformly). */
  pitch: [number, number];
  /** Pitch multiplier over a voice's life `u` 0..1; `k` is a per-voice random -1..1. */
  contour: (u: number, k: number) => number;
  /** Voice attack and release, as fractions of its length. */
  shape: [number, number];
  /** Formant pairs (F1, F2) the voices are spread across. */
  vowels: [number, number][];
  /** Breath / roar noise level relative to the voices, and its centre frequency. */
  noise: number;
  noiseHz: number;
  /** Loudness over time (loops: keep it 1). */
  env: (t: number) => number;
  /** Claps per second at full loudness, and their level. */
  claps?: [number, number];
  /** Whistles (count, level). */
  whistles?: [number, number];
  /** Arena reverb amount. */
  wet: number;
  /** Final low-pass (Hz). */
  bright: number;
  /** Peak level of the result. */
  peak?: number;
}

function rmsNormalise(a: Float32Array, upTo: number): void {
  let s = 0;
  const n = Math.max(1, Math.min(upTo, a.length));
  for (let i = 0; i < n; i++) s += a[i] * a[i];
  const r = Math.sqrt(s / n);
  if (r > 0) for (let i = 0; i < a.length; i++) a[i] /= r;
}

function side(spec: CrowdSpec, seed: number, total: number, srcEnd: number): Float32Array {
  const sr = CROWD_SR;
  const r = rng(seed);
  const groups = spec.vowels.map(() => new Float32Array(total));
  const [s0, s1] = spec.loop ? [0, spec.seconds] : spec.start;
  const logLo = Math.log(spec.pitch[0]);
  const logHi = Math.log(spec.pitch[1]);
  // voices
  for (let v = 0; v < spec.voices; v++) {
    const g = groups[Math.floor(r() * groups.length)];
    const t0 = s0 + r() * (s1 - s0);
    const len = spec.len[0] + r() * (spec.len[1] - spec.len[0]);
    const f0 = Math.exp(logLo + r() * (logHi - logLo));
    const amp = 0.45 + r() * 0.55;
    const k = r() * 2 - 1;
    const vibRate = 4 + r() * 3;
    const vibDepth = 0.008 + r() * 0.022;
    let vibPh = r();
    let ph = r();
    const i0 = Math.round(t0 * sr);
    const n = Math.round(len * sr);
    const [att, rel] = spec.shape;
    // pitch and loudness move at control rate (every BLOCK samples, linearly interpolated): the inner loop is cheap
    let fPrev = -1;
    let ePrev = 0;
    for (let b = 0; b < n; b += BLOCK) {
      const m = Math.min(BLOCK, n - b, total - (i0 + b));
      if (m <= 0) break;
      const u = (b + m) / n;
      vibPh += (vibRate * m) / sr;
      const fNext = f0 * spec.contour(u, k) * (1 + vibDepth * look(SINE, vibPh));
      const eLin = Math.min(1, u / att, (1 - u) / rel);
      const eNext = eLin > 0 ? eLin * eLin * amp : 0;
      if (fPrev < 0) fPrev = fNext;
      const df = (fNext - fPrev) / m;
      const de = (eNext - ePrev) / m;
      let f = fPrev;
      let e = ePrev;
      const base = i0 + b;
      for (let j = 0; j < m; j++) {
        const dt = f / sr;
        ph += dt;
        if (ph >= 1) ph -= 1;
        g[base + j] += (2 * ph - 1 - blep(ph, dt)) * e;
        f += df;
        e += de;
      }
      fPrev = fNext;
      ePrev = eNext;
    }
  }
  // formants
  const out = new Float32Array(total);
  spec.vowels.forEach(([f1, f2], gi) => {
    const b1 = new Biquad().bp(f1, 2.5, sr);
    const b2 = new Biquad().bp(f2, 4, sr);
    const b3 = new Biquad().bp(2700, 5, sr);
    const src = groups[gi];
    for (let i = 0; i < total; i++) {
      const x = src[i];
      out[i] += b1.run(x) + 0.55 * b2.run(x) + 0.18 * b3.run(x);
    }
  });
  rmsNormalise(out, srcEnd);
  // breath / roar noise (only sourced inside the loop for loops, so the folded tail stays seamless)
  if (spec.noise > 0) {
    const nz = new Float32Array(total);
    const pink = new OnePole(1600, sr);
    const bp = new Biquad().bp(spec.noiseHz, 0.8, sr);
    for (let i = 0; i < total; i++) nz[i] = bp.run(pink.run(i < srcEnd ? r() * 2 - 1 : 0));
    rmsNormalise(nz, srcEnd);
    for (let i = 0; i < total; i++) out[i] += nz[i] * spec.noise;
  }
  // overall loudness contour (control rate)
  for (let b = 0; b < total; b += BLOCK) {
    const e = spec.env((b + BLOCK / 2) / sr);
    for (let i = b; i < Math.min(total, b + BLOCK); i++) out[i] *= e;
  }
  // claps
  if (spec.claps) {
    const [rate, level] = spec.claps;
    const cl = new Float32Array(total);
    const tries = Math.round(rate * (srcEnd / sr));
    for (let c = 0; c < tries; c++) {
      const t = r() * (srcEnd / sr);
      if (r() > spec.env(t)) continue;
      const i0 = Math.round(t * sr);
      const a = 0.3 + r() * 0.7;
      const tau = 0.005 + r() * 0.01;
      const n = Math.round(tau * 7 * sr);
      for (let j = 0; j < n && i0 + j < total; j++) {
        const tt = j / sr;
        cl[i0 + j] += (r() * 2 - 1) * a * (tt < 0.0007 ? tt / 0.0007 : Math.exp(-(tt - 0.0007) / tau));
      }
    }
    const c1 = new Biquad().bp(1250, 0.9, sr);
    const c2 = new Biquad().bp(2400, 1.3, sr);
    for (let i = 0; i < total; i++) cl[i] = c1.run(cl[i]) + 0.6 * c2.run(cl[i]);
    rmsNormalise(cl, srcEnd);
    for (let i = 0; i < total; i++) out[i] += cl[i] * level;
  }
  // whistles
  if (spec.whistles) {
    const [count, level] = spec.whistles;
    for (let w = 0; w < count; w++) {
      const t0 = s0 + r() * Math.max(0.01, s1 - s0);
      const len = 0.35 + r() * 0.6;
      const f0 = 1900 + r() * 1300;
      const up = r() < 0.5;
      const i0 = Math.round(t0 * sr);
      const n = Math.round(len * sr);
      let ph = 0;
      for (let j = 0; j < n && i0 + j < total; j++) {
        const u = j / n;
        const f = f0 * (up ? 0.8 + 0.35 * Math.sin(u * Math.PI) : 1.1 - 0.25 * u) * (1 + 0.01 * Math.sin(j * 0.0019));
        ph += f / sr;
        const e = Math.min(1, u / 0.12, (1 - u) / 0.3);
        out[i0 + j] += look(SINE, ph) * e * level * (spec.env(t0) + 0.2);
      }
    }
  }
  return out;
}

/** Render a crowd sound (stereo). */
export function crowd(spec: CrowdSpec): Pcm {
  const sr = CROWD_SR;
  const tail = spec.loop ? 2.6 : 0;
  const total = Math.ceil((spec.seconds + tail) * sr);
  const srcEnd = spec.loop ? Math.round(spec.seconds * sr) : total;
  let p: Pcm = { sr, ch: [side(spec, spec.seed, total, srcEnd), side(spec, spec.seed + 7919, total, srcEnd)] };
  // a little shared centre so it does not sound like two separate rooms
  const [l, rr] = p.ch;
  for (let i = 0; i < total; i++) {
    const m = (l[i] + rr[i]) * 0.15;
    l[i] = l[i] * 0.85 + m;
    rr[i] = rr[i] * 0.85 + m;
  }
  p = reverb(p, { size: 0.86, damp: 0.5, wet: spec.wet * 2.2, dry: 1, pre: 0.025 });
  for (const c of p.ch) {
    const lp = new Biquad().lp(spec.bright, 0.7, sr);
    const hp = new Biquad().hp(90, 0.7, sr);
    for (let i = 0; i < c.length; i++) c[i] = hp.run(lp.run(c[i]));
  }
  if (spec.loop) return finish(fold(p, spec.seconds), spec.peak ?? 0.8, 0, 0);
  return finish(p, spec.peak ?? 0.85, 0.004, 0.25);
}

// ---- the crowd's repertoire ---------------------------------------------------------------------------------------

const OO: [number, number][] = [[340, 820], [420, 900], [380, 760]];
const AH: [number, number][] = [[760, 1250], [660, 1700], [560, 1900]];
const MIX: [number, number][] = [[500, 1500], [700, 1100], [380, 900]];

const swellFall = (rise: number, hold: number, fall: number) => (t: number) =>
  t < rise ? Math.sin((t / rise) * (Math.PI / 2)) : t < rise + hold ? 1 : Math.max(0, Math.exp(-(t - rise - hold) / fall));

export type CrowdId = 'bedCalm' | 'bedHot' | 'ooh' | 'roar' | 'cheer' | 'boo' | 'applause';

export function crowdSound(id: CrowdId, variant: number): Pcm {
  const seed = 1000 + variant * 131;
  switch (id) {
    case 'bedCalm':
      // the murmur of a full arena between exchanges: dense chatter, far away
      return crowd({
        seconds: 8, loop: true, seed, voices: 150, start: [0, 8], len: [0.2, 0.7], pitch: [95, 250],
        contour: (u, k) => 1 + k * 0.25 * (u - 0.5), shape: [0.2, 0.35], vowels: MIX,
        noise: 0.6, noiseHz: 650, env: () => 1, claps: [1.2, 0.25], wet: 0.6, bright: 2600, peak: 0.75,
      });
    case 'bedHot':
      // the crowd on its feet: sustained yells, claps and whistles (a different length to the calm bed, so their
      // combination does not repeat for a long time)
      return crowd({
        seconds: 6.5, loop: true, seed: seed + 5, voices: 160, start: [0, 6.5], len: [0.5, 1.5], pitch: [170, 430],
        contour: (u, k) => 1 + k * 0.18 * Math.sin(u * Math.PI), shape: [0.18, 0.4], vowels: AH,
        noise: 0.9, noiseHz: 1300, env: () => 1, claps: [9, 0.45], whistles: [3, 0.12], wet: 0.5, bright: 4200, peak: 0.75,
      });
    case 'ooh':
      // a near miss / big block: rises, then the pitch sags as the crowd sits back down
      return crowd({
        seconds: 2.1, seed, voices: 48, start: [0, 0.16], len: [0.9, 1.6], pitch: [150, 330],
        contour: u => (u < 0.3 ? 1 + 0.27 * u : 1.08 - 0.3 * (u - 0.3)), shape: [0.22, 0.45], vowels: OO,
        noise: 0.35, noiseHz: 600, env: swellFall(0.2, 0.35, 0.5), wet: 0.4, bright: 3000,
      });
    case 'roar':
      // knockdowns, rocked fighters, finishes
      return crowd({
        seconds: 3.6, seed, voices: 72, start: [0, 0.3], len: [1.5, 3.1], pitch: [200, 500],
        contour: (u, k) => 1 + 0.1 * Math.sin(u * Math.PI) + k * 0.05 * u, shape: [0.1, 0.4], vowels: AH,
        noise: 1.1, noiseHz: 1400, env: swellFall(0.15, 1.2, 0.9), claps: [16, 0.4], whistles: [4, 0.14], wet: 0.45,
        bright: 5000,
      });
    case 'cheer':
      // the walkout: "woo"s rising, claps building
      return crowd({
        seconds: 4.6, seed, voices: 84, start: [0, 1.4], len: [0.7, 1.8], pitch: [190, 420],
        contour: u => 0.85 + 0.4 * u, shape: [0.25, 0.35], vowels: [OO[0], AH[0], AH[2]],
        noise: 0.8, noiseHz: 1200, env: swellFall(1, 1.6, 0.8), claps: [22, 0.55], whistles: [6, 0.15], wet: 0.45,
        bright: 4800,
      });
    case 'boo':
      // a long stretch with nothing thrown
      return crowd({
        seconds: 3.2, seed, voices: 52, start: [0, 0.45], len: [1.6, 2.6], pitch: [95, 185],
        contour: u => 1 - 0.1 * u, shape: [0.2, 0.35], vowels: OO,
        noise: 0.25, noiseHz: 420, env: swellFall(0.4, 1.4, 0.6), wet: 0.5, bright: 2200,
      });
    case 'applause':
      // end of a round, a fighter getting up, a decision
      return crowd({
        seconds: 3.4, seed, voices: 16, start: [0, 0.8], len: [0.5, 1.2], pitch: [190, 400],
        contour: u => 0.9 + 0.25 * u, shape: [0.25, 0.4], vowels: AH,
        noise: 0.3, noiseHz: 1100, env: swellFall(0.25, 1.2, 0.8), claps: [70, 1.4], wet: 0.4, bright: 5200,
      });
  }
}
