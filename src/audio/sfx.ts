// Fight, arena and menu sounds, synthesised. Impacts are layered: a transient "crack", the glove-leather slap
// (band-passed noise with a second resonance), the meaty mid of the body and a low pitched thump with a little sub;
// each strike type balances those differently. Arena sounds (bell, clapper, cage) and menu stings get the arena
// reverb from dsp.ts. Every sound here is original: built from oscillators and noise, no samples.

import {
  Biquad, Env, SAW, SINE, SOFT, Sweep, TAU, ad, finish, glide, look, mixInto, pcm, reverb, rng, sat, stereo, type Pcm,
} from './dsp';

export const SFX_SR = 44100;

// ---- impacts ------------------------------------------------------------------------------------------------------

interface Hit {
  /** Low thump: level, start / end pitch (Hz), decay (s). */
  thump: number;
  f0: number;
  f1: number;
  tauT: number;
  /** Glove leather slap: level, centre (Hz), decay (s). */
  slap: number;
  slapHz: number;
  tauS: number;
  /** Transient crack: level, decay (s). */
  crack: number;
  tauC: number;
  /** Meaty mid: level, centre (Hz), decay (s). */
  flesh: number;
  fleshHz: number;
  tauF: number;
  /** Low rumble under heavy shots. */
  sub?: number;
  /** Bony / woody ringing modes: [Hz, decay s, level]. */
  ring?: [number, number, number][];
  /** Saturation. */
  drive: number;
}

/** Render one layered impact (mono). `seed` varies the colours a little so variants differ. */
function hit(o: Hit, seed: number, seconds: number, sr = SFX_SR): Pcm {
  const p = pcm(seconds, sr);
  const d = p.ch[0];
  const r = rng(seed);
  const j = (x: number, amt: number) => x * (1 + (r() * 2 - 1) * amt);
  const slapHz = j(o.slapHz, 0.15);
  const f0 = j(o.f0, 0.08);
  const f1 = j(o.f1, 0.08);
  const bS = new Biquad().bp(slapHz, 1.1, sr);
  const bS2 = new Biquad().bp(slapHz * 1.85, 2.6, sr);
  const bC = new Biquad().hp(4200, 0.7, sr);
  const bF = new Biquad().bp(j(o.fleshHz, 0.12), 1.4, sr);
  const bSub = new Biquad().lp(170, 0.7, sr);
  const rings = (o.ring ?? []).map(([f, tau, a]) => ({ w: (TAU * j(f, 0.04)) / sr, env: new Env(0.0004, tau, sr, a) }));
  const n = d.length;
  const sweep = new Sweep(f0, f1, o.tauT * 2.5, sr);
  const eT = new Env(0.0015, o.tauT, sr, o.thump);
  const eS = new Env(0.0006, o.tauS, sr, o.slap * 3);
  const eC = new Env(0.0002, o.tauC, sr, o.crack * 1.6);
  const eF = new Env(0.0015, o.tauF, sr, o.flesh * 3);
  const eSub = new Env(0.003, o.tauT * 1.4, sr, (o.sub ?? 0) * 6);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = r() * 2 - 1;
    ph += sweep.next() / sr;
    let v = Math.sin(TAU * ph) * eT.next();
    v += (bS.run(x) + 0.45 * bS2.run(x)) * eS.next();
    v += bC.run(x) * eC.next();
    v += bF.run(x) * eF.next();
    if (o.sub) v += bSub.run(x) * eSub.next();
    for (const m of rings) v += Math.sin(m.w * i) * m.env.next();
    d[i] = sat(v, o.drive);
  }
  return finish(p, 0.92, 0.0002, 0.03);
}

const JAB: Hit = { thump: 0.55, f0: 155, f1: 72, tauT: 0.045, slap: 1, slapHz: 2300, tauS: 0.017, crack: 0.55, tauC: 0.003, flesh: 0.3, fleshHz: 620, tauF: 0.03, drive: 1.3 };
const POWER: Hit = { thump: 1, f0: 125, f1: 48, tauT: 0.085, slap: 1, slapHz: 1550, tauS: 0.03, crack: 0.65, tauC: 0.004, flesh: 0.6, fleshHz: 430, tauF: 0.05, sub: 0.5, drive: 1.9 };
const BODY: Hit = { thump: 1, f0: 98, f1: 42, tauT: 0.11, slap: 0.45, slapHz: 950, tauS: 0.03, crack: 0.2, tauC: 0.003, flesh: 1, fleshHz: 320, tauF: 0.07, sub: 0.8, drive: 1.7 };
const BODY_KICK: Hit = { thump: 1, f0: 108, f1: 45, tauT: 0.1, slap: 1.1, slapHz: 1350, tauS: 0.035, crack: 0.85, tauC: 0.005, flesh: 0.9, fleshHz: 380, tauF: 0.06, sub: 0.7, drive: 2.1 };
const LEG_KICK: Hit = { thump: 0.75, f0: 145, f1: 62, tauT: 0.06, slap: 1.35, slapHz: 1950, tauS: 0.028, crack: 1, tauC: 0.005, flesh: 0.7, fleshHz: 520, tauF: 0.04, drive: 2.3 };
const HEAD_KICK: Hit = { thump: 1, f0: 132, f1: 45, tauT: 0.1, slap: 1.3, slapHz: 1750, tauS: 0.04, crack: 1, tauC: 0.006, flesh: 0.8, fleshHz: 450, tauF: 0.06, sub: 0.9, drive: 2.5 };
const BLOCKED: Hit = { thump: 0.6, f0: 115, f1: 72, tauT: 0.05, slap: 0.55, slapHz: 760, tauS: 0.03, crack: 0.15, tauC: 0.002, flesh: 0.9, fleshHz: 540, tauF: 0.04, drive: 1.3 };
const PARRIED: Hit = { thump: 0.25, f0: 210, f1: 120, tauT: 0.02, slap: 1, slapHz: 2900, tauS: 0.012, crack: 0.8, tauC: 0.002, flesh: 0.2, fleshHz: 900, tauF: 0.015, drive: 1.4 };
const CHECKED: Hit = { thump: 0.7, f0: 185, f1: 92, tauT: 0.05, slap: 0.6, slapHz: 1250, tauS: 0.02, crack: 1, tauC: 0.004, flesh: 0.3, fleshHz: 600, tauF: 0.03, ring: [[340, 0.06, 0.5], [830, 0.04, 0.35], [1510, 0.025, 0.2]], drive: 1.7 };
const POUND: Hit = { thump: 0.9, f0: 105, f1: 46, tauT: 0.08, slap: 0.6, slapHz: 1150, tauS: 0.03, crack: 0.3, tauC: 0.003, flesh: 0.9, fleshHz: 380, tauF: 0.05, sub: 0.6, drive: 1.7 };
const SLAM: Hit = { thump: 1, f0: 88, f1: 34, tauT: 0.14, slap: 0.8, slapHz: 1100, tauS: 0.05, crack: 0.3, tauC: 0.004, flesh: 0.6, fleshHz: 250, tauF: 0.1, sub: 1, drive: 1.8 };
const THUD: Hit = { thump: 0.9, f0: 92, f1: 32, tauT: 0.12, slap: 0.4, slapHz: 900, tauS: 0.04, crack: 0.2, tauC: 0.003, flesh: 0.5, fleshHz: 260, tauF: 0.08, sub: 0.7, drive: 1.5 };

/** A swing through the air: band-passed noise sweeping up and back down. */
function whoosh(seed: number, len: number, lo: number, hi: number, sr = SFX_SR): Pcm {
  const p = pcm(len, sr);
  const d = p.ch[0];
  const r = rng(seed);
  const bp = new Biquad();
  const lp = new Biquad().lp(hi * 1.5, 0.7, sr);
  const peakAt = 0.35 + r() * 0.15;
  for (let i = 0; i < d.length; i++) {
    const u = i / d.length;
    if ((i & 31) === 0) {
      const f = u < peakAt ? glide(lo, hi, u, peakAt) : glide(hi, lo * 1.3, u - peakAt, 1 - peakAt);
      bp.bp(f, 1.3, sr);
    }
    const e = u < peakAt ? Math.pow(u / peakAt, 2) : Math.pow(1 - (u - peakAt) / (1 - peakAt), 1.6);
    d[i] = lp.run(bp.run(r() * 2 - 1)) * e;
  }
  return finish(p, 0.85, 0.002, 0.02);
}

/** Knockdown: a bass-heavy hit, then a slowed-down "whoomp" (a falling sub sweep and a rush of air), in the hall. */
function knockdown(seed: number): Pcm {
  const sr = SFX_SR;
  const p = pcm(2.1, sr);
  mixInto(p, hit({ ...HEAD_KICK, f0: 115, f1: 38, tauT: 0.16, sub: 1.3, drive: 2.7 }, seed, 0.6), 0, 1);
  const d = p.ch[0];
  const r = rng(seed + 1);
  const lp = new Biquad();
  let ph = 0;
  const start = 0.06;
  const sweep = new Sweep(72, 25, 1.15, sr);
  for (let i = Math.round(start * sr); i < d.length; i++) {
    const t = i / sr - start;
    ph += sweep.next() / sr;
    const e = ad(t, 0.24, 0.42);
    if ((i & 31) === 0) lp.lp(glide(1300, 110, t, 1.0), 0.9, sr);
    d[i] += 0.75 * Math.sin(TAU * ph) * e + 0.9 * lp.run(r() * 2 - 1) * ad(t, 0.16, 0.34);
  }
  finish(p, 0.9, 0.0002, 0.05);
  return finish(reverb(p, { size: 0.86, damp: 0.45, wet: 0.35, pre: 0.02 }), 0.95, 0.0002, 0.2);
}

/** A fighter thrown into the fence: a dull post thump, the panel wobbling and the chain links jingling. */
function cage(seed: number): Pcm {
  const sr = SFX_SR;
  const p = pcm(1.2, sr, 2);
  const r = rng(seed);
  const thump = hit({ ...THUD, thump: 1, f0: 100, f1: 52, tauT: 0.09, slap: 0.6, slapHz: 900 }, seed, 0.4);
  for (let c = 0; c < 2; c++) {
    const d = p.ch[c];
    const links = Array.from({ length: 8 }, () => new Biquad().bp(1600 + r() * 6000, 18 + r() * 25, sr));
    const panels = [380, 610, 880].map(f => new Biquad().bp(f * (0.95 + r() * 0.1), 14, sr));
    const wob = 9 + r() * 4;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      // impulses whose density decays: links knocking against each other
      const dens = 0.03 * Math.exp(-t / 0.22);
      const x = r() < dens ? (r() * 2 - 1) * (0.4 + 0.6 * Math.exp(-t / 0.3)) : 0;
      let v = 0;
      for (const b of links) v += b.run(x);
      let w = 0;
      for (const b of panels) w += b.run(x);
      d[i] = v * 2.7 + w * 1.5 * (0.6 + 0.4 * Math.sin(TAU * wob * t));
    }
  }
  finish(p, 0.6);
  mixInto(p, thump, 0, 0.9);
  return finish(reverb(p, { size: 0.72, damp: 0.5, wet: 0.2 }), 0.9, 0.0002, 0.1);
}

// ---- arena --------------------------------------------------------------------------------------------------------

/** One strike of the round bell: inharmonic partials (higher ones die sooner), stereo-detuned so it shimmers. */
function bellStrike(p: Pcm, at: number, gain: number, base: number): void {
  const sr = p.sr;
  const ratios = [1, 1.51, 2.0, 2.74, 3.62, 4.93, 6.31];
  const amps = [1, 0.45, 0.55, 0.35, 0.25, 0.17, 0.11];
  const taus = [1.3, 0.95, 0.8, 0.55, 0.4, 0.3, 0.2];
  const i0 = Math.round(at * sr);
  for (let c = 0; c < p.ch.length; c++) {
    const d = p.ch[c];
    ratios.forEach((ratio, k) => {
      const f = base * ratio + (c === 0 ? -0.7 : 0.7) * (k + 1) * 0.5;
      const n = Math.min(d.length - i0, Math.round(taus[k] * 6.5 * sr));
      let ph = 0;
      for (let j = 0; j < n; j++) {
        ph += f / sr;
        d[i0 + j] += look(SINE, ph) * amps[k] * gain * ad(j / sr, 0.0008, taus[k]);
      }
    });
    // the clapper's tick
    const hp = new Biquad().hp(3500, 0.7, sr);
    const r = rng(i0 + c);
    for (let j = 0; j < Math.min(800, d.length - i0); j++) d[i0 + j] += hp.run(r() * 2 - 1) * 0.5 * gain * ad(j / sr, 0.0002, 0.003);
  }
}

function bell(strikes: number[], seconds: number): Pcm {
  // one strike, rendered once and copied for each hit
  const one = pcm(Math.min(seconds, 2.6), SFX_SR, 2);
  bellStrike(one, 0, 1, 1040);
  const p = pcm(seconds, SFX_SR, 2);
  strikes.forEach((t, i) => mixInto(p, one, t, i === 0 ? 1 : 0.9));
  return finish(reverb(p, { size: 0.82, damp: 0.35, wet: 0.25 }), 0.85, 0.0005, 0.3);
}

/** The ten-second clapper: two wooden boards smacked together, echoing round the hall. */
function clapper(): Pcm {
  const sr = SFX_SR;
  const p = pcm(1.9, sr);
  const d = p.ch[0];
  const r = rng(99);
  const modes: [number, number, number][] = [[840, 0.035, 1], [1720, 0.026, 0.7], [2680, 0.018, 0.5], [3950, 0.012, 0.3]];
  for (let k = 0; k < 6; k++) {
    const i0 = Math.round(k * 0.2 * sr);
    const g = k % 2 ? 0.85 : 1;
    const hp = new Biquad().hp(2500, 0.7, sr);
    for (let j = 0; j < 0.25 * sr && i0 + j < d.length; j++) {
      const t = j / sr;
      let v = hp.run(r() * 2 - 1) * 1.2 * ad(t, 0.0002, 0.003);
      for (const [f, tau, a] of modes) v += a * Math.sin(TAU * f * t) * ad(t, 0.0003, tau);
      d[i0 + j] += v * g;
    }
  }
  finish(p, 0.9);
  return finish(reverb(p, { size: 0.84, damp: 0.4, wet: 0.32 }), 0.85, 0.0002, 0.2);
}

/** The referee waving them in: a quick arm chop and a sharp double hand clap. No voice. */
function fightCue(): Pcm {
  const sr = SFX_SR;
  const p = pcm(1.2, sr);
  mixInto(p, whoosh(5, 0.16, 700, 3600), 0, 0.55);
  const d = p.ch[0];
  const r = rng(5);
  for (const [at, g] of [[0.15, 1], [0.29, 0.9]] as const) {
    const b1 = new Biquad().bp(1150, 0.9, sr);
    const b2 = new Biquad().bp(2350, 1.3, sr);
    const i0 = Math.round(at * sr);
    for (let j = 0; j < 0.12 * sr; j++) {
      const t = j / sr;
      const x = r() * 2 - 1;
      d[i0 + j] += g * (2.5 * (b1.run(x) + 0.7 * b2.run(x)) * ad(t, 0.0004, 0.011) + 0.3 * Math.sin(TAU * 210 * t) * ad(t, 0.001, 0.01));
    }
  }
  finish(p, 0.9);
  return finish(reverb(p, { size: 0.8, damp: 0.45, wet: 0.25 }), 0.9, 0.0002, 0.2);
}

/** Three quick taps (hand on the opponent / the mat). */
function taps(seed: number): Pcm {
  const p = pcm(0.8, SFX_SR);
  const one: Hit = { thump: 0.3, f0: 160, f1: 90, tauT: 0.03, slap: 0.8, slapHz: 1300, tauS: 0.02, crack: 0.2, tauC: 0.002, flesh: 0.5, fleshHz: 500, tauF: 0.03, drive: 1.2 };
  [0, 0.17, 0.34].forEach((t, i) => mixInto(p, hit(one, seed + i, 0.2), t, 1 - i * 0.08));
  return finish(p, 0.85);
}

function heartbeat(): Pcm {
  const p = pcm(0.7, SFX_SR);
  const beat: Hit = { thump: 1, f0: 62, f1: 44, tauT: 0.06, slap: 0, slapHz: 500, tauS: 0.01, crack: 0, tauC: 0.001, flesh: 0.3, fleshHz: 160, tauF: 0.05, drive: 1.1 };
  mixInto(p, hit(beat, 3, 0.3), 0, 1);
  mixInto(p, hit(beat, 4, 0.3), 0.24, 0.7);
  return finish(p, 0.8);
}

// ---- music-box helpers for the menu stings --------------------------------------------------------------------------

export const NOTE = (n: string): number => {
  const m = /^([A-G])(#?)(\d)$/.exec(n);
  if (!m) return 440;
  const idx = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1] as 'C'] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, idx / 12);
};

interface Tone {
  table: Float32Array;
  amp: number;
  attack: number;
  /** Decay time constant while held. */
  tau: number;
  /** Release time constant after `dur`. */
  release: number;
  /** Low-pass that opens from [0] to [1] Hz over the attack (brass). */
  cutoff?: [number, number];
  /** Stereo detune in cents (left -, right +). */
  detune?: number;
  /** Add an inharmonic partial (bell / chime) at this ratio. */
  bell?: number;
}

/** Add a note into a stereo buffer. */
export function tone(p: Pcm, at: number, freq: number, dur: number, o: Tone): void {
  const sr = p.sr;
  const i0 = Math.round(at * sr);
  const n = Math.min(Math.round((dur + o.release * 7) * sr), p.ch[0].length - i0);
  for (let c = 0; c < p.ch.length; c++) {
    const d = p.ch[c];
    const f = freq * Math.pow(2, ((c === 0 ? -1 : 1) * (o.detune ?? 0)) / 1200);
    const lp = o.cutoff ? new Biquad() : null;
    let ph = c * 0.25;
    let ph2 = 0;
    for (let j = 0; j < n; j++) {
      const t = j / sr;
      ph += f / sr;
      let v = look(o.table, ph);
      if (o.bell) {
        ph2 += (f * o.bell) / sr;
        v += 0.25 * look(SINE, ph2) * Math.exp(-t / (o.tau * 0.4));
      }
      if (lp && o.cutoff && (j & 63) === 0) lp.lp(glide(o.cutoff[0], o.cutoff[1], t, o.attack * 2.5), 0.8, sr);
      if (lp) v = lp.run(v);
      let e = t < o.attack ? t / o.attack : Math.exp(-(t - o.attack) / o.tau);
      if (t > dur) e *= Math.exp(-(t - dur) / o.release);
      d[i0 + j] += v * e * o.amp;
    }
  }
}

const PLUCK: Tone = { table: SOFT, amp: 0.5, attack: 0.004, tau: 0.35, release: 0.08, detune: 4 };
const CHIME: Tone = { table: SOFT, amp: 0.38, attack: 0.002, tau: 0.6, release: 0.2, detune: 6, bell: 2.76 };
const BRASS: Tone = { table: SAW, amp: 0.22, attack: 0.05, tau: 2.5, release: 0.12, cutoff: [500, 3200], detune: 7 };
const PAD: Tone = { table: SAW, amp: 0.1, attack: 0.35, tau: 4, release: 0.5, cutoff: [700, 1500], detune: 12 };

function chord(p: Pcm, at: number, notes: string[], dur: number, o: Tone, spread = 0): void {
  notes.forEach((n, i) => tone(p, at + i * spread, NOTE(n), dur, o));
}

/** High glassy pings scattered across the stereo field. */
function sparkle(p: Pcm, at: number, len: number, count: number, seed: number, gain = 0.12, rising = false): void {
  const r = rng(seed);
  const sr = p.sr;
  for (let k = 0; k < count; k++) {
    const t0 = at + (rising ? (k / count) * len : r() * len);
    const f = rising ? 2000 * Math.pow(2, (k / count) * 1.6) : 2200 + r() * 4200;
    const pan = r();
    const i0 = Math.round(t0 * sr);
    const n = Math.min(Math.round(0.35 * sr), p.ch[0].length - i0);
    let ph = 0;
    for (let j = 0; j < n; j++) {
      ph += f / sr;
      const v = look(SINE, ph) * gain * ad(j / sr, 0.001, 0.06);
      p.ch[0][i0 + j] += v * (1 - pan);
      p.ch[1][i0 + j] += v * pan;
    }
  }
}

/** Low cinematic hit: a sub drop and a burst of low noise. */
function boom(p: Pcm, at: number, gain: number, seed: number): void {
  const sr = p.sr;
  const r = rng(seed);
  const i0 = Math.round(at * sr);
  const n = Math.min(Math.round(1.2 * sr), p.ch[0].length - i0);
  for (let c = 0; c < 2; c++) {
    const lp = new Biquad().lp(380, 0.7, sr);
    const sweep = new Sweep(95, 34, 0.5, sr);
    let ph = 0;
    for (let j = 0; j < n; j++) {
      const t = j / sr;
      ph += sweep.next() / sr;
      p.ch[c][i0 + j] += gain * (Math.sin(TAU * ph) * ad(t, 0.002, 0.28) + 1.6 * lp.run(r() * 2 - 1) * ad(t, 0.002, 0.08));
    }
  }
}

/** Cymbal: bright noise, either a crash (from `at`) or a swell that peaks at `at + len`. */
function cymbal(p: Pcm, at: number, len: number, gain: number, swell: boolean, seed: number): void {
  const sr = p.sr;
  const r = rng(seed);
  const i0 = Math.round(at * sr);
  const n = Math.min(Math.round((swell ? len : len * 6) * sr), p.ch[0].length - i0);
  for (let c = 0; c < 2; c++) {
    const hp = new Biquad().hp(5200, 0.7, sr);
    for (let j = 0; j < n; j++) {
      const t = j / sr;
      const e = swell ? Math.pow(t / len, 2.2) : ad(t, 0.001, len);
      p.ch[c][i0 + j] += hp.run(r() * 2 - 1) * e * gain;
    }
  }
}

function sting(seconds: number, build: (p: Pcm) => void, wet = 0.28, peak = 0.85): Pcm {
  const p = pcm(seconds, SFX_SR, 2);
  build(p);
  return finish(reverb(p, { size: 0.8, damp: 0.4, wet, pre: 0.015 }), peak, 0.001, 0.15);
}

/** A crisp UI tick (pitch picks click / back). */
function click(hi: number, lo: number): Pcm {
  const sr = SFX_SR;
  const p = pcm(0.07, sr);
  const d = p.ch[0];
  const r = rng(11);
  const hp = new Biquad().hp(3000, 0.7, sr);
  let ph = 0;
  const sweep = new Sweep(hi, lo, 0.02, sr);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += sweep.next() / sr;
    d[i] = Math.sin(TAU * ph) * ad(t, 0.0005, 0.008) + 0.5 * hp.run(r() * 2 - 1) * ad(t, 0.0001, 0.0015) + 0.3 * Math.sin(TAU * 420 * t) * ad(t, 0.0005, 0.006);
  }
  return finish(p, 0.8, 0.0002, 0.01);
}

/** Pack opening build-up: a rising noise sweep, two saws gliding up an octave, a drum roll that speeds up. */
function packBuild(): Pcm {
  const sr = SFX_SR;
  const len = 1.9;
  const p = pcm(len + 0.2, sr, 2);
  const r = rng(77);
  for (let c = 0; c < 2; c++) {
    const d = p.ch[c];
    const bp = new Biquad();
    const lp = new Biquad();
    let ph1 = c * 0.3;
    let ph2 = 0;
    const sweep = new Sweep(110 * (c ? 1.004 : 0.996), 220 * (c ? 1.004 : 0.996), len, sr);
    for (let i = 0; i < len * sr; i++) {
      const t = i / sr;
      const u = t / len;
      if ((i & 31) === 0) {
        bp.bp(glide(350, 7000, u, 1), 1.1, sr);
        lp.lp(glide(300, 3500, u, 1), 0.9, sr);
      }
      const f = sweep.next();
      ph1 += f / sr;
      ph2 += (f * 1.5) / sr;
      d[i] += bp.run(r() * 2 - 1) * 0.9 * u * u + lp.run(look(SAW, ph1) + 0.6 * look(SAW, ph2)) * 0.25 * u;
    }
  }
  // drum roll: the gaps shrink from 0.2 s to 0.04 s
  let t = 0;
  let gap = 0.2;
  const tom: Hit = { thump: 1, f0: 140, f1: 80, tauT: 0.07, slap: 0.2, slapHz: 900, tauS: 0.02, crack: 0.1, tauC: 0.002, flesh: 0.4, fleshHz: 300, tauF: 0.04, drive: 1.3 };
  const toms = [hit(tom, 300, 0.25), hit(tom, 301, 0.25)];
  let k = 0;
  while (t < len - 0.03) {
    mixInto(p, toms[k++ % 2], t, 0.25 + 0.55 * (t / len));
    t += gap;
    gap = Math.max(0.04, gap * 0.86);
  }
  return finish(reverb(p, { size: 0.75, damp: 0.4, wet: 0.2 }), 0.85, 0.002, 0.12);
}

// ---- the bank -----------------------------------------------------------------------------------------------------

export type SfxId =
  | 'jab' | 'power' | 'body' | 'bodyKick' | 'legKick' | 'headKick' | 'pound' | 'blocked' | 'parried' | 'checked'
  | 'knockdown' | 'slam' | 'thud' | 'whoosh' | 'whooshHeavy' | 'tap' | 'cage' | 'heartbeat'
  | 'bell' | 'bellFinal' | 'clapper' | 'fightCue'
  | 'click' | 'back' | 'deny' | 'cardFlip' | 'packBuild' | 'reveal0' | 'reveal1' | 'reveal2' | 'reveal3'
  | 'buy' | 'claim' | 'levelUp' | 'starUp' | 'achievement' | 'mission' | 'trophy' | 'win' | 'lose' | 'specialReady';

export function sfxSound(id: SfxId, v: number): Pcm {
  const seed = 17 + v * 101;
  switch (id) {
    case 'jab': return hit(JAB, seed, 0.3);
    case 'power': return hit(POWER, seed, 0.45);
    case 'body': return hit(BODY, seed, 0.5);
    case 'bodyKick': return hit(BODY_KICK, seed, 0.5);
    case 'legKick': return hit(LEG_KICK, seed, 0.4);
    case 'headKick': return hit(HEAD_KICK, seed, 0.55);
    case 'pound': return hit(POUND, seed, 0.4);
    case 'blocked': return hit(BLOCKED, seed, 0.3);
    case 'parried': {
      const p = hit(PARRIED, seed, 0.25);
      mixInto(p, whoosh(seed, 0.12, 1200, 3200), 0.03, 0.35);
      return finish(p, 0.9);
    }
    case 'checked': return hit(CHECKED, seed, 0.35);
    case 'knockdown': return knockdown(seed);
    case 'slam': {
      const p = hit(SLAM, seed, 0.75);
      mixInto(p, whoosh(seed + 1, 0.2, 1500, 3000), 0.015, 0.15);
      return finish(p, 0.92);
    }
    case 'thud': return hit(THUD, seed, 0.6);
    case 'whoosh': return whoosh(seed, 0.24 + v * 0.03, 480, 2300);
    case 'whooshHeavy': return whoosh(seed, 0.36 + v * 0.03, 260, 1300);
    case 'tap': return taps(seed);
    case 'cage': return cage(seed);
    case 'heartbeat': return heartbeat();
    case 'bell': return bell([0, 0.32, 0.64], 3.2);
    case 'bellFinal': return bell([0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9], 3.6);
    case 'clapper': return clapper();
    case 'fightCue': return fightCue();
    case 'click': return click(2600, 1900);
    case 'back': return click(1500, 1050);
    case 'deny':
      return sting(0.45, p => {
        const o: Tone = { table: SAW, amp: 0.3, attack: 0.004, tau: 0.5, release: 0.03, cutoff: [900, 900], detune: 3 };
        tone(p, 0, 196, 0.07, o);
        tone(p, 0.1, 185, 0.1, o);
      }, 0.08, 0.6);
    case 'cardFlip':
      return sting(0.35, p => {
        mixInto(p, stereo(whoosh(seed, 0.16, 900, 4200)), 0, 0.5);
        mixInto(p, click(3200, 2400), 0.12, 0.35);
      }, 0.12, 0.6);
    case 'packBuild': return packBuild();
    case 'reveal0':
      return sting(1.1, p => {
        chord(p, 0, ['C5', 'E5', 'G5'], 0.3, PLUCK, 0.06);
        sparkle(p, 0.1, 0.3, 4, seed, 0.06);
      });
    case 'reveal1':
      return sting(1.5, p => {
        boom(p, 0, 0.35, seed);
        chord(p, 0, ['G5', 'C6', 'E6'], 0.5, CHIME, 0.07);
        chord(p, 0, ['C4', 'G4'], 0.6, PAD);
        sparkle(p, 0.15, 0.5, 8, seed, 0.08);
      });
    case 'reveal2':
      return sting(2.1, p => {
        boom(p, 0, 0.6, seed);
        cymbal(p, 0, 0.35, 0.22, false, seed);
        chord(p, 0, ['C4', 'E4', 'G4', 'C5'], 0.9, BRASS);
        chord(p, 0.12, ['C6', 'E6', 'G6', 'C7'], 0.4, CHIME, 0.07);
        sparkle(p, 0.2, 0.9, 16, seed, 0.09);
      }, 0.32);
    case 'reveal3':
      return sting(3, p => {
        cymbal(p, 0, 0.44, 0.25, true, seed);
        chord(p, 0, ['F4', 'A4', 'C5'], 0.18, BRASS);
        chord(p, 0.22, ['G4', 'B4', 'D5'], 0.18, BRASS);
        boom(p, 0.44, 0.9, seed);
        cymbal(p, 0.44, 0.6, 0.3, false, seed + 1);
        chord(p, 0.44, ['C4', 'E4', 'G4', 'C5', 'E5'], 1.4, BRASS);
        chord(p, 0.44, ['C3', 'G3', 'E4'], 1.6, PAD);
        chord(p, 0.56, ['C6', 'E6', 'G6', 'C7'], 0.6, CHIME, 0.08);
        sparkle(p, 0.5, 1.6, 34, seed, 0.09);
      }, 0.34);
    case 'buy':
      return sting(1.1, p => {
        tone(p, 0, NOTE('B5'), 0.08, CHIME);
        tone(p, 0.09, NOTE('E6'), 0.4, CHIME);
        tone(p, 0.09, NOTE('B6'), 0.3, { ...CHIME, amp: 0.15 });
        sparkle(p, 0.12, 0.4, 7, seed, 0.07);
      });
    case 'claim':
      return sting(0.8, p => {
        tone(p, 0, NOTE('E6'), 0.25, CHIME);
        sparkle(p, 0.04, 0.3, 5, seed, 0.06);
      });
    case 'levelUp':
      return sting(1.5, p => {
        ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => tone(p, i * 0.075, NOTE(n), 0.2, PLUCK));
        chord(p, 0.3, ['C5', 'E5', 'G5', 'C6'], 0.6, { ...CHIME, amp: 0.22 });
        sparkle(p, 0.3, 0.6, 10, seed, 0.07, true);
      });
    case 'starUp':
      return sting(1.4, p => {
        sparkle(p, 0, 0.45, 12, seed, 0.1, true);
        chord(p, 0.42, ['E6', 'B6'], 0.5, CHIME);
        chord(p, 0.42, ['E4', 'B4'], 0.6, PAD);
      });
    case 'achievement':
      return sting(1.8, p => {
        chord(p, 0, ['G4', 'B4', 'D5'], 0.1, BRASS);
        chord(p, 0.16, ['C5', 'E5', 'G5', 'C6'], 0.7, BRASS);
        tone(p, 0.16, NOTE('G6'), 0.4, CHIME);
        sparkle(p, 0.2, 0.8, 14, seed, 0.08);
      });
    case 'mission':
      return sting(1.1, p => {
        mixInto(p, click(2100, 1700), 0, 0.5);
        mixInto(p, click(2600, 2100), 0.08, 0.5);
        chord(p, 0.16, ['G5', 'C6', 'E6'], 0.35, CHIME, 0.03);
      });
    case 'trophy':
      return sting(3.2, p => {
        const short = { ...BRASS, release: 0.05 };
        for (const t of [0, 0.16, 0.32]) chord(p, t, ['C4', 'E4', 'G4'], 0.1, short);
        chord(p, 0.48, ['F4', 'A4', 'C5'], 0.18, BRASS);
        chord(p, 0.72, ['G4', 'B4', 'D5'], 0.18, BRASS);
        cymbal(p, 0.3, 0.7, 0.22, true, seed);
        for (const [t, g] of [[0, 0.5], [0.48, 0.5], [0.72, 0.55], [1, 1]] as const) boom(p, t, g, seed + t * 10);
        cymbal(p, 1, 0.8, 0.3, false, seed + 1);
        chord(p, 1, ['C4', 'E4', 'G4', 'C5', 'E5', 'G5'], 1.5, BRASS);
        chord(p, 1, ['C3', 'G3'], 1.7, PAD);
        sparkle(p, 1, 1.6, 30, seed, 0.08);
      }, 0.32);
    case 'win':
      return sting(1.7, p => {
        chord(p, 0, ['C4', 'E4', 'G4', 'C5'], 0.8, BRASS, 0.02);
        tone(p, 0.05, NOTE('G6'), 0.4, CHIME);
        sparkle(p, 0.1, 0.6, 8, seed, 0.07);
      });
    case 'lose':
      return sting(1.6, p => {
        tone(p, 0, NOTE('E4'), 0.35, { ...PAD, amp: 0.25, attack: 0.05 });
        tone(p, 0.38, NOTE('C4'), 0.6, { ...PAD, amp: 0.25, attack: 0.05 });
        tone(p, 0, NOTE('A2'), 1, { ...PAD, amp: 0.2, attack: 0.1 });
      }, 0.3, 0.6);
    case 'specialReady':
      return sting(0.8, p => {
        tone(p, 0, NOTE('E6'), 0.1, CHIME);
        tone(p, 0.08, NOTE('B6'), 0.25, CHIME);
        sparkle(p, 0.05, 0.25, 5, seed, 0.06, true);
      }, 0.2, 0.7);
  }
}
