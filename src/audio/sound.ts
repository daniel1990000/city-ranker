// All the game's sound, synthesised with WebAudio: no sample files to license or download. Short sounds are rendered
// once into buffers (OfflineAudioContext) at start-up, then played with pitch / gain variation through three buses
// (sfx, crowd, music) into a limiter. The crowd is a looping bed whose level and brightness follow the excitement.

import type { FightEvent } from '../game/fight/types';

type Bus = 'sfx' | 'crowd' | 'music';

const SR = 44100;

function noise(n: number, seed = 1): Float32Array {
  const a = new Float32Array(n);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    a[i] = s / 2147483648 - 1;
  }
  return a;
}

/** Render a sound with an offline context. */
async function render(seconds: number, build: (ctx: OfflineAudioContext) => void): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
  build(ctx);
  return ctx.startRendering();
}

function noiseSource(ctx: BaseAudioContext, seconds: number, seed: number): AudioBufferSourceNode {
  const b = ctx.createBuffer(1, Math.ceil(seconds * SR), SR);
  b.copyToChannel(noise(b.length, seed) as Float32Array<ArrayBuffer>, 0);
  const s = ctx.createBufferSource();
  s.buffer = b;
  return s;
}

function env(ctx: BaseAudioContext, g: GainNode, t0: number, attack: number, peak: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

/** A punch: a pitched body thump + a filtered snap (glove on skin). `weight` 0..1, `bright` 0..1. */
function punch(weight: number, bright: number, seed: number) {
  return (ctx: OfflineAudioContext) => {
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140 + 60 * (1 - weight), 0);
    o.frequency.exponentialRampToValueAtTime(42 + 20 * (1 - weight), 0.12);
    const og = ctx.createGain();
    env(ctx, og, 0, 0.003, 0.9 * (0.5 + weight * 0.6), 0.09 + weight * 0.12);
    o.connect(og).connect(out);
    o.start(0);
    o.stop(0.4);
    const n = noiseSource(ctx, 0.2, seed);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + bright * 2600;
    bp.Q.value = 0.9;
    const ng = ctx.createGain();
    env(ctx, ng, 0, 0.001, 0.55 + bright * 0.4, 0.03 + weight * 0.04);
    n.connect(bp).connect(ng).connect(out);
    n.start(0);
    // a low "body" knock under heavy shots
    if (weight > 0.6) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      const n2 = noiseSource(ctx, 0.3, seed + 9);
      const g2 = ctx.createGain();
      env(ctx, g2, 0.004, 0.004, 0.8, 0.16);
      n2.connect(lp).connect(g2).connect(out);
      n2.start(0);
    }
  };
}

function whoosh(seed: number) {
  return (ctx: OfflineAudioContext) => {
    const n = noiseSource(ctx, 0.3, seed);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(500, 0);
    bp.frequency.exponentialRampToValueAtTime(2200, 0.12);
    bp.frequency.exponentialRampToValueAtTime(700, 0.24);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.35, 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, 0.26);
    n.connect(bp).connect(g).connect(ctx.destination);
    n.start(0);
  };
}

function block(seed: number) {
  return (ctx: OfflineAudioContext) => {
    const n = noiseSource(ctx, 0.15, seed);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    env(ctx, g, 0, 0.002, 0.9, 0.07);
    n.connect(bp).connect(g).connect(ctx.destination);
    n.start(0);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, 0);
    o.frequency.exponentialRampToValueAtTime(70, 0.08);
    const og = ctx.createGain();
    env(ctx, og, 0, 0.002, 0.4, 0.08);
    o.connect(og).connect(ctx.destination);
    o.start(0);
    o.stop(0.2);
  };
}

function thud() {
  return (ctx: OfflineAudioContext) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, 0);
    o.frequency.exponentialRampToValueAtTime(32, 0.35);
    const g = ctx.createGain();
    env(ctx, g, 0, 0.004, 1.0, 0.45);
    o.connect(g).connect(ctx.destination);
    o.start(0);
    o.stop(0.6);
    const n = noiseSource(ctx, 0.5, 77);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    env(ctx, ng, 0, 0.003, 0.7, 0.18);
    n.connect(lp).connect(ng).connect(ctx.destination);
    n.start(0);
  };
}

/** The round bell: inharmonic partials with a long ring. */
function bell() {
  return (ctx: OfflineAudioContext) => {
    const partials = [1, 2.76, 5.4, 8.93, 13.34];
    for (const [i, p] of partials.entries()) {
      for (const hitAt of [0, 0.28, 0.56]) {
        const o = ctx.createOscillator();
        o.frequency.value = 620 * p;
        const g = ctx.createGain();
        env(ctx, g, hitAt, 0.002, 0.28 / (i + 1), 1.4 / (1 + i * 0.6));
        o.connect(g).connect(ctx.destination);
        o.start(hitAt);
        o.stop(hitAt + 1.8);
      }
    }
  };
}

function clap() {
  return (ctx: OfflineAudioContext) => {
    for (const t of [0, 0.12, 0.24]) {
      const n = noiseSource(ctx, 0.08, 31 + t * 10);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const g = ctx.createGain();
      env(ctx, g, t, 0.001, 0.6, 0.04);
      n.connect(hp).connect(g).connect(ctx.destination);
      n.start(t);
    }
  };
}

function tone(freqs: number[], step: number, type: OscillatorType, len: number, vol = 0.25) {
  return (ctx: OfflineAudioContext) => {
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      env(ctx, g, i * step, 0.005, vol, len);
      o.connect(g).connect(ctx.destination);
      o.start(i * step);
      o.stop(i * step + len + 0.05);
    });
  };
}

/** A crowd "ooh" / roar: band-passed noise swelling and falling. */
function crowdBurst(seconds: number, center: number, seed: number) {
  return (ctx: OfflineAudioContext) => {
    const n = noiseSource(ctx, seconds, seed);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(center * 0.7, 0);
    bp.frequency.linearRampToValueAtTime(center, seconds * 0.3);
    bp.frequency.linearRampToValueAtTime(center * 0.8, seconds);
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.5, seconds * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, seconds);
    n.connect(bp).connect(g).connect(ctx.destination);
    n.start(0);
  };
}

export class Sound {
  private ctx: AudioContext | null = null;
  private buses: Record<Bus, GainNode> | null = null;
  private master: GainNode | null = null;
  private buf = new Map<string, AudioBuffer[]>();
  private bed: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private last = new Map<string, number>();
  private voices = 0;
  private volumes: Record<Bus, number> = { sfx: 0.9, crowd: 0.7, music: 0.6 };
  private ready = false;
  private muted = false;

  /** Create the context (needs a user gesture on mobile to start) and render the sound bank. */
  async init(): Promise<void> {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.buses = { sfx: ctx.createGain(), crowd: ctx.createGain(), music: ctx.createGain() };
    for (const b of Object.keys(this.buses) as Bus[]) {
      this.buses[b].gain.value = this.volumes[b];
      this.buses[b].connect(this.master);
    }
    const bank: [string, number, (s: number) => (c: OfflineAudioContext) => void, number][] = [
      ['light', 0.4, s => punch(0.2, 0.9, s), 3],
      ['medium', 0.4, s => punch(0.55, 0.6, s), 3],
      ['heavy', 0.5, s => punch(0.9, 0.4, s), 3],
      ['kick', 0.45, s => punch(0.7, 1.0, s + 100), 2],
      ['block', 0.25, s => block(s), 3],
      ['whoosh', 0.3, s => whoosh(s), 3],
      ['thud', 0.7, () => thud(), 1],
      ['bell', 2.2, () => bell(), 1],
      ['clap', 0.4, () => clap(), 1],
      ['ooh', 1.4, s => crowdBurst(1.3, 900, s), 2],
      ['roar', 2.6, s => crowdBurst(2.5, 1200, s), 2],
      ['click', 0.08, () => tone([1800], 0, 'triangle', 0.04, 0.15), 1],
      ['buy', 0.6, () => tone([660, 880, 1320], 0.08, 'triangle', 0.25), 1],
      ['reveal0', 0.5, () => tone([523, 659], 0.09, 'triangle', 0.25), 1],
      ['reveal1', 0.6, () => tone([523, 659, 784], 0.09, 'triangle', 0.3), 1],
      ['reveal2', 0.8, () => tone([523, 659, 784, 1047], 0.09, 'triangle', 0.35), 1],
      ['reveal3', 1.2, () => tone([523, 659, 784, 1047, 1319, 1568], 0.08, 'triangle', 0.45, 0.3), 1],
    ];
    for (const [name, len, build, variants] of bank) {
      const list: AudioBuffer[] = [];
      for (let v = 0; v < variants; v++) list.push(await render(len, build(v * 17 + 3)));
      this.buf.set(name, list);
    }
    // the crowd bed: two seconds of shaped noise, looped
    const bedBuf = await render(4, c => {
      const n = noiseSource(c, 4, 4242);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700;
      bp.Q.value = 0.5;
      const g = c.createGain();
      g.gain.value = 0.35;
      n.connect(bp).connect(g).connect(c.destination);
      n.start(0);
    });
    const src = ctx.createBufferSource();
    src.buffer = bedBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.buses.crowd);
    src.start();
    this.bed = { src, gain, filter };
    this.ready = true;
    const unlock = () => void ctx.resume();
    addEventListener('pointerdown', unlock, { passive: true });
    addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
  }

  setVolume(bus: Bus, v: number): void {
    this.volumes[bus] = v;
    if (this.buses) this.buses[bus].gain.value = v;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 1;
  }

  play(name: string, opts: { gain?: number; rate?: number; bus?: Bus } = {}): void {
    if (!this.ready || !this.ctx || !this.buses || this.muted) return;
    const list = this.buf.get(name);
    if (!list) return;
    // never the same variant twice in a row; at most 12 voices
    if (this.voices >= 12) return;
    const prev = this.last.get(name) ?? -1;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === prev) i = (i + 1) % list.length;
    this.last.set(name, i);
    const src = this.ctx.createBufferSource();
    src.buffer = list[i];
    src.playbackRate.value = (opts.rate ?? 1) * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain();
    g.gain.value = (opts.gain ?? 1) * (0.85 + Math.random() * 0.3);
    src.connect(g).connect(this.buses[opts.bus ?? 'sfx']);
    this.voices++;
    src.onended = () => this.voices--;
    src.start();
  }

  /** Crowd bed level 0..1 (silent outside fights). */
  setCrowd(level: number): void {
    if (!this.bed || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.bed.gain.gain.setTargetAtTime(level * 0.9, t, 0.4);
    this.bed.filter.frequency.setTargetAtTime(700 + level * 1800, t, 0.4);
  }

  /** Map the simulation's events to sounds. */
  onFightEvents(events: FightEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          if (e.blocked) this.play('block', { gain: 0.8 });
          else {
            const kick = e.move === 'lowKick' || e.move === 'bodyKick' || e.move === 'headKick' || e.move === 'flyingKnee';
            this.play(kick ? 'kick' : e.strength, { gain: e.counter ? 1.25 : 1 });
            if (e.strength === 'heavy' || e.counter) this.play('ooh', { bus: 'crowd', gain: 0.7 });
          }
          break;
        case 'miss':
          this.play('whoosh', { gain: 0.6 });
          break;
        case 'evade':
          this.play('whoosh', { gain: 0.5, rate: 1.2 });
          break;
        case 'knockdown':
          this.play('thud');
          this.play('roar', { bus: 'crowd' });
          break;
        case 'stun':
          // rocked: the crowd comes up out of its seats
          this.play('roar', { bus: 'crowd', gain: 0.85 });
          break;
        case 'hurt':
          if (e.zone === 'body') this.play('thud', { gain: 0.5, rate: 0.8 });
          this.play('ooh', { bus: 'crowd', gain: 0.8 });
          break;
        case 'recover':
          this.play('ooh', { bus: 'crowd', gain: 0.45, rate: 1.1 });
          break;
        case 'takedown':
          this.play('thud', { gain: 0.7, rate: 1.2 });
          this.play('ooh', { bus: 'crowd', gain: 0.6 });
          break;
        case 'roundStart':
        case 'roundEnd':
          this.play('bell', { gain: 0.8 });
          break;
        case 'fightEnd':
          this.play('bell', { gain: 0.9 });
          this.play('roar', { bus: 'crowd', gain: 1 });
          break;
        case 'tapOut':
          this.play('roar', { bus: 'crowd' });
          break;
        default:
          break;
      }
    }
  }
}

export const sound = new Sound();
