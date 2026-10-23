// A light, original menu loop: 8 bars at 120 BPM in A minor (Am - F - C - G, two bars each) with a synth kick, claps,
// hats, a pumping bass and pad, and a plucked arpeggio in the second half. Rendered circularly (the tail is folded
// onto the start) so it loops without a seam. 22.05 kHz stereo, about 16 seconds.

import { Biquad, SAW, SOFT, Sweep, TAU, ad, finish, fold, pcm, reverb, rng, type Pcm } from './dsp';
import { NOTE, tone } from './sfx';

export const MUSIC_SR = 22050;
const BPM = 120;
const STEP = 60 / BPM / 4;
const BAR = STEP * 16;
const BARS = 8;
export const MUSIC_LOOP_SECONDS = BAR * BARS;

const CHORDS: [string, string[]][] = [
  ['A2', ['A3', 'C4', 'E4']],
  ['F2', ['F3', 'A3', 'C4']],
  ['C2', ['G3', 'C4', 'E4']],
  ['G2', ['G3', 'B3', 'D4']],
];

function kick(p: Pcm, at: number, g: number): void {
  const sr = p.sr;
  const i0 = Math.round(at * sr);
  let ph = 0;
  const sweep = new Sweep(150, 46, 0.09, sr);
  for (let j = 0; j < 0.4 * sr; j++) {
    const t = j / sr;
    ph += sweep.next() / sr;
    const v = g * (Math.sin(TAU * ph) * ad(t, 0.001, 0.14) + 0.3 * Math.sin(TAU * 1800 * t) * ad(t, 0.0002, 0.002));
    p.ch[0][i0 + j] += v;
    p.ch[1][i0 + j] += v;
  }
}

function noiseHit(p: Pcm, at: number, g: number, kind: 'clap' | 'hat' | 'open', r: () => number, pan: number): void {
  const sr = p.sr;
  const i0 = Math.round(at * sr);
  const f = kind === 'clap' ? new Biquad().bp(1400, 0.9, sr) : new Biquad().hp(6500, 0.7, sr);
  const tau = kind === 'clap' ? 0.05 : kind === 'open' ? 0.12 : 0.022;
  const n = Math.round(tau * 7 * sr);
  for (let j = 0; j < n; j++) {
    const t = j / sr;
    // a clap is three tiny bursts, then the tail
    const e = kind === 'clap' ? Math.max(ad(t, 0.0005, 0.004), ad(t - 0.011, 0.0005, 0.004), ad(t - 0.022, 0.0005, tau)) : ad(t, 0.0005, tau);
    const v = f.run(r() * 2 - 1) * e * g * (kind === 'clap' ? 2.2 : 1);
    p.ch[0][i0 + j] += v * (1 - pan);
    p.ch[1][i0 + j] += v * (1 + pan);
  }
}

export function menuMusic(): Pcm {
  const sr = MUSIC_SR;
  const len = MUSIC_LOOP_SECONDS + 2.5;
  const dry = pcm(len, sr, 2);
  const pumped = pcm(len, sr, 2);
  const send = pcm(len, sr, 2);
  const r = rng(2026);
  const kicks: number[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * BAR;
    const [root, triad] = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    for (const s of [0, 7, 8, 10]) {
      kick(dry, t0 + s * STEP, s === 0 ? 0.9 : 0.7);
      kicks.push(t0 + s * STEP);
    }
    for (const s of [4, 12]) noiseHit(send, t0 + s * STEP, 0.55, 'clap', r, 0);
    for (let s = 0; s < 16; s += 2) noiseHit(dry, t0 + s * STEP + STEP * 0.04, s % 4 === 2 ? 0.3 : 0.18, s === 14 ? 'open' : 'hat', r, s % 4 === 2 ? 0.25 : -0.25);
    // bass
    for (const s of [0, 3, 6, 8, 10, 14]) {
      tone(pumped, t0 + s * STEP, NOTE(root), STEP * 1.6, { table: SAW, amp: 0.28, attack: 0.004, tau: 0.3, release: 0.03, cutoff: [700, 420], detune: 3 });
    }
    // pad: one chord every two bars
    if (bar % 2 === 0) for (const n of triad) tone(pumped, t0, NOTE(n), BAR * 2 - 0.1, { table: SAW, amp: 0.07, attack: 0.25, tau: 6, release: 0.3, cutoff: [800, 1500], detune: 14 });
    // second half: a plucked arpeggio over the chord
    if (bar >= 4) {
      const up = triad.map(n => NOTE(n) * 2);
      const order = [0, 2, 1, 2, 0, 2, 1, 2];
      for (let k = 0; k < 8; k++) tone(send, t0 + k * STEP * 2, up[order[k]] * (k === 4 ? 2 : 1), STEP, { table: SOFT, amp: 0.11, attack: 0.003, tau: 0.16, release: 0.05, detune: 5 });
    }
  }
  // side-chain pump: the bass and pad duck under each kick
  const pump = new Float32Array(pumped.ch[0].length);
  for (const k of kicks) {
    const i0 = Math.round(k * sr);
    for (let j = 0; j < 0.5 * sr && i0 + j < pump.length; j++) pump[i0 + j] = Math.max(pump[i0 + j], Math.exp(-j / sr / 0.11));
  }
  for (let i = 0; i < pump.length; i++) {
    const g = 1 - 0.55 * pump[i];
    pumped.ch[0][i] *= g;
    pumped.ch[1][i] *= g;
  }
  const verbed = reverb(send, { size: 0.78, damp: 0.45, wet: 0.5 });
  const out = pcm(len, sr, 2);
  for (let c = 0; c < 2; c++) for (let i = 0; i < out.ch[c].length; i++) out.ch[c][i] = dry.ch[c][i] + pumped.ch[c][i] + verbed.ch[c][i];
  return finish(fold(out, MUSIC_LOOP_SECONDS), 0.8, 0, 0);
}
