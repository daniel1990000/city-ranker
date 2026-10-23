// All the game's sound, synthesised with WebAudio: no sample files to license or download. Short sounds are rendered
// once into buffers (OfflineAudioContext) at start-up, then played with pitch / gain variation through three buses
// (sfx, crowd, music) into a limiter. The crowd is a looping bed whose level and brightness follow the excitement.
// That small bank is ready at once; the full arena bank (layered impacts, a synthesised crowd of voices, the bell,
// UI stings, menu music: sfx.ts, crowd.ts, music.ts) is built in a worker and takes over sound by sound as it arrives.

/** What a full-bank sound falls back to while it is still being built. */
const FALLBACK: Record<string, string> = {
  jab: 'light', power: 'heavy', body: 'medium', bodyKick: 'kick', legKick: 'kick', headKick: 'kick', pound: 'medium',
  blocked: 'block', parried: 'block', checked: 'block', knockdown: 'thud', slam: 'thud', cage: 'thud', whooshHeavy: 'whoosh',
  bellFinal: 'bell', clapper: 'clap', applause: 'clap', cheer: 'roar', claim: 'buy', starUp: 'reveal2', levelUp: 'reveal1',
  achievement: 'reveal2', mission: 'reveal1', trophy: 'reveal3', win: 'reveal2', cardFlip: 'whoosh',
};
const KICKS: Partial<Record<MoveId | 'pound', string>> = { lowKick: 'legKick', bodyKick: 'bodyKick', headKick: 'headKick', flyingKnee: 'power', clinchKnee: 'body', clinchKneeHead: 'power', clinchElbow: 'jab', clinchUpper: 'power' };

import type { FightEvent, MoveId } from '../game/fight/types';
import type { BankMessage } from './bankWorker';

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
  /** the full bank, filled by the worker */
  private hq = new Map<string, AudioBuffer[]>();
  private beds: { calm: GainNode; hot: GainNode } | null = null;
  private crowdLevel = 0;
  private music: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private musicWanted = true; // the game opens on the menus

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
    this.startBank();
    const unlock = () => void ctx.resume();
    addEventListener('pointerdown', unlock, { passive: true });
    addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
  }

  /** Build the full bank in a worker; each sound replaces its start-up stand-in as it arrives. */
  private startBank(): void {
    if (typeof Worker === 'undefined') return;
    let w: Worker;
    try {
      w = new Worker(new URL('./bankWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      return;
    }
    w.onmessage = (ev: MessageEvent<BankMessage>) => {
      const ctx = this.ctx;
      const m = ev.data;
      if (!ctx || !m?.ch?.length) return;
      const b = ctx.createBuffer(m.ch.length, m.ch[0].length, m.sr);
      m.ch.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      const list = this.hq.get(m.name) ?? [];
      list.push(b);
      this.hq.set(m.name, list);
      if (m.name === 'bedHot' && this.hq.has('bedCalm')) this.startBeds();
      if (m.name === 'music') {
        w.terminate();
        if (this.musicWanted) this.setMusic(true);
      }
    };
    w.onerror = () => w.terminate();
  }

  /** The two crowd loops (murmur and on-its-feet) take over from the noise bed. */
  private startBeds(): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses || this.beds) return;
    const loop = (name: string) => {
      const src = ctx.createBufferSource();
      src.buffer = (this.hq.get(name) as AudioBuffer[])[0];
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect((this.buses as Record<Bus, GainNode>).crowd);
      src.start();
      return g;
    };
    this.beds = { calm: loop('bedCalm'), hot: loop('bedHot') };
    if (this.bed) {
      this.bed.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      const old = this.bed.src;
      setTimeout(() => old.stop(), 2000);
      this.bed = null;
    }
    this.setCrowd(this.crowdLevel);
  }

  /** Menu music on or off (fades; starts once the music is built). */
  setMusic(on: boolean): void {
    this.musicWanted = on;
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    const t = ctx.currentTime;
    if (on && !this.music) {
      const buf = this.hq.get('music')?.[0];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.buses.music);
      src.start();
      gain.gain.setTargetAtTime(0.5, t, 0.8);
      this.music = { src, gain };
    } else if (!on && this.music) {
      const m = this.music;
      m.gain.gain.setTargetAtTime(0, t, 0.25);
      setTimeout(() => m.src.stop(), 1500);
      this.music = null;
    }
  }

  /** QA: the full bank's progress. */
  debug(): { built: number; beds: boolean; music: boolean; state: string } {
    return { built: this.hq.size, beds: !!this.beds, music: !!this.music, state: this.ctx?.state ?? 'none' };
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
    // the full bank's sound if it is built, else the start-up stand-in
    const list = this.hq.get(name) ?? this.buf.get(name) ?? (FALLBACK[name] ? this.buf.get(FALLBACK[name]) : undefined);
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
    this.crowdLevel = level;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.beds) {
      // the murmur is there whenever a crowd is; the on-its-feet loop comes in with the excitement
      const on = level > 0.01 ? 1 : 0;
      this.beds.calm.gain.setTargetAtTime(on * (0.35 + level * 0.25), t, 0.5);
      this.beds.hot.gain.setTargetAtTime(on * Math.pow(Math.max(0, level - 0.25) / 0.75, 1.4) * 0.8, t, 0.35);
      return;
    }
    if (!this.bed) return;
    this.bed.gain.gain.setTargetAtTime(level * 0.9, t, 0.4);
    this.bed.filter.frequency.setTargetAtTime(700 + level * 1800, t, 0.4);
  }

  /** Map the simulation's events to sounds. */
  onFightEvents(events: FightEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          if (e.blocked) this.play('blocked', { gain: 0.8 });
          else {
            const id = KICKS[e.move] ?? (e.move === 'pound' ? 'pound' : e.zone === 'body' ? 'body' : e.strength === 'light' ? 'jab' : 'power');
            this.play(id, { gain: (e.counter ? 1.25 : 1) * (e.strength === 'medium' && id === 'power' ? 0.8 : 1) });
            if (e.strength === 'heavy' || e.counter) this.play('ooh', { bus: 'crowd', gain: 0.7 });
          }
          break;
        case 'miss':
          this.play(e.move === 'headKick' || e.move === 'bodyKick' || e.move === 'flyingKnee' ? 'whooshHeavy' : 'whoosh', { gain: 0.6 });
          break;
        case 'evade':
          this.play('whoosh', { gain: 0.5, rate: 1.2 });
          break;
        case 'parry':
          this.play('parried', { gain: 0.9 });
          break;
        case 'check':
          this.play('checked');
          this.play('ooh', { bus: 'crowd', gain: 0.5 });
          break;
        case 'guardBreak':
          this.play('blocked', { gain: 1.2, rate: 0.85 });
          this.play('ooh', { bus: 'crowd', gain: 0.6 });
          break;
        case 'knockdown':
          this.play('knockdown');
          this.play('roar', { bus: 'crowd' });
          break;
        case 'getUp':
          this.play('applause', { bus: 'crowd', gain: 0.6 });
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
        case 'special':
          this.play('whooshHeavy', { gain: 0.8 });
          break;
        case 'specialReady':
          if (e.side === 0) this.play('specialReady', { gain: 0.6 });
          break;
        case 'gassed':
          if (e.side === 0) this.play('heartbeat', { gain: 0.7 });
          break;
        case 'shoot':
          this.play('whooshHeavy', { gain: 0.5, rate: 0.9 });
          break;
        case 'sprawl':
          if (e.success) {
            this.play('thud', { gain: 0.6 });
            this.play('applause', { bus: 'crowd', gain: 0.45 });
          }
          break;
        case 'takedown':
          this.play('slam', { gain: 0.9 });
          this.play('ooh', { bus: 'crowd', gain: 0.6 });
          break;
        case 'position':
          if (e.pos === 'mount') this.play('ooh', { bus: 'crowd', gain: 0.45 });
          break;
        case 'subStart':
          this.play('ooh', { bus: 'crowd', gain: 0.7, rate: 0.9 });
          break;
        case 'subEscape':
          this.play('applause', { bus: 'crowd', gain: 0.6 });
          break;
        case 'standUp':
          if (e.reason === 'ref') this.play('clapper', { gain: 0.5 });
          break;
        case 'clinchStart':
          this.play('thud', { gain: 0.35, rate: 1.3 });
          if (e.wall) this.play('cage', { gain: 0.6 });
          break;
        case 'clinchWall':
          this.play('cage', { gain: 0.55 });
          break;
        case 'clinchTripEnd':
          if (e.success) this.play('slam', { gain: 0.9 });
          else this.play('applause', { bus: 'crowd', gain: 0.35 });
          break;
        case 'clinchContestEnd':
          if (e.success) this.play('ooh', { bus: 'crowd', gain: 0.4, rate: 1.1 });
          break;
        case 'clinchBreak':
          if (e.reason === 'ref') this.play('clapper', { gain: 0.45 });
          break;
        case 'roundStart':
          this.play('bell', { gain: 0.8 });
          if (e.round === 1) this.play('cheer', { bus: 'crowd', gain: 0.7 });
          break;
        case 'roundEnd':
          this.play('bell', { gain: 0.8 });
          this.play('applause', { bus: 'crowd', gain: 0.5 });
          break;
        case 'fightEnd':
          this.play('bellFinal', { gain: 0.9 });
          this.play('roar', { bus: 'crowd', gain: 1 });
          break;
        case 'tapOut':
          this.play('tap', { gain: 0.8 });
          this.play('roar', { bus: 'crowd' });
          break;
        default:
          break;
      }
    }
  }
}

export const sound = new Sound();
