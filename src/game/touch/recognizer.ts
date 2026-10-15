// The gesture recogniser: touch points and key presses (with timestamps) in, one FightInput per simulation tick out.
//
// It is a pure, deterministic state machine: no DOM, no clock of its own, no randomness. The DOM layer
// (src/ui/fight/touch-overlay.ts) feeds it pointer and key events as they happen; the game calls `tick(now, ctx)`
// once per 60 Hz simulation tick. The same event trace and tick times always give the same inputs, which is what
// the unit tests in tests/touch-recognizer.test.ts rely on.
//
// How it reads the screen (landscape, right-handed; `mirrored` swaps the halves):
//   RIGHT half (offence): tap = jab; swipe toward the opponent = cross; up = uppercut; up-forward = rear hook;
//     up-back or back = lead hook; down = body shot; a LONG swipe down = takedown. Two fingers at once = a kick
//     (direction picks it: up = head, down = low, otherwise body). KICK button: tap = body kick, swipe up from it =
//     head kick, swipe down = low kick; holding KICK turns the other finger's strike into a kick by direction.
//     TAKEDOWN button = shoot. SPECIAL button (only when the meter is full) = special.
//   LEFT half (defence): hold = block (instantly, and it comes back after a dodge if the thumb stays down); flick =
//     dodge: back (away from the opponent) = sway back, up = slip left, down = slip right, forward = slip (alternating).
//     The MOVE pad in the bottom-left corner: drag left/right from where the thumb lands to step.
//   Opponent shooting a takedown: any swipe down, or the TAKEDOWN button, sprawls (FightInput.shoot).
//   Ground: swipe anywhere = the prompted direction (screen up/down/left/right); tap = ground-and-pound; hold on the
//     defence half = block.  Submission: every touch anywhere is a mash tap.
//
// Timing: swipes fire as soon as they are long enough (`commit`), before the finger lifts; taps fire on release.
// Everything recognised between two ticks is queued, so a tap that starts and ends inside one 16 ms tick is never
// lost. Each tick emits at most one action per channel (attack, evade, ground, tap); extra ones wait a tick or two.

import { NO_INPUT, type Evade, type FightInput, type GroundDir, type Strike } from '../fight/types';
import { DEFAULT_TOUCH_CONFIG, scaleConfig, type ScaledConfig } from './config';
import { dir4, dir8, dist, inRect, isDown, isUp } from './geometry';
import { GROUND_KEYS, STAND_KEYS, SUB_KEYS } from './keyboard';
import { computeTouchLayout } from './layout';
import {
  DEFAULT_CONTEXT,
  type Action,
  type ActiveTouch,
  type Dir8,
  type FightMode,
  type GestureEvent,
  type GestureKind,
  type TouchConfig,
  type TouchContext,
  type TouchLayout,
  type Zone,
} from './types';

/** What an offence swipe throws, by direction. */
export const OFFENCE_SWIPES: Readonly<Record<Dir8, Strike>> = Object.freeze({
  F: 'cross',
  UF: 'hookR',
  U: 'uppercut',
  UB: 'hookL',
  B: 'hookL',
  DB: 'bodyShot',
  D: 'bodyShot',
  DF: 'bodyShot',
});

/** Which kick a direction picks (KICK button swipes, two-finger swipes, KICK-held swipes). */
export function kickFor(d: Dir8 | null): Strike {
  if (d && isUp(d)) return 'headKick';
  if (d && isDown(d)) return 'lowKick';
  return 'bodyKick';
}

/** What a defence flick does, by direction ('F' alternates left/right, see `flickEvade`). */
export const DEFENCE_FLICKS: Readonly<Record<Exclude<Dir8, 'F'>, Evade>> = Object.freeze({
  B: 'back',
  UB: 'back',
  DB: 'back',
  U: 'left',
  UF: 'left',
  D: 'right',
  DF: 'right',
});

/** Channels: each tick emits at most one action from each. */
type Channel = 'attack' | 'evade' | 'ground' | 'tap';

function channelOf(a: Action): Channel {
  switch (a.k) {
    case 'strike':
    case 'special':
    case 'shoot':
      return 'attack';
    case 'evade':
      return 'evade';
    case 'ground':
      return 'ground';
    case 'tap':
      return 'tap';
  }
}

interface Sample {
  x: number;
  y: number;
  t: number;
}

interface Track {
  id: number;
  zone: Zone;
  /** The mode changed since this touch began: it can still hold block / move, but fires no gestures. */
  orphan: boolean;
  /** Used up (a button press, a pair partner, a cancelled rest): its release does nothing. */
  consumed: boolean;
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  t: number;
  /** Recent samples; samples[0] is where the finger was at the start of the swipe window. */
  samples: Sample[];
  /** Furthest distance from the touch-down point. */
  maxD: number;
  /** Can fire a swipe or flick (false after one fires, until the finger settles). */
  armed: boolean;
  /** Has fired something (so its release is not also a tap). */
  fired: boolean;
  /** Where and when the finger last settled (for re-arming). */
  stillX: number;
  stillY: number;
  stillT: number;
  /** A body shot waiting to see whether the swipe keeps going into a takedown. */
  down: { x: number; y: number; dir: Dir8; prog: number; progT: number } | null;
  /** Two-finger kick pairing: the other finger's id, or -1. */
  partner: number;
  /** Started while the KICK button was held: strikes from this finger are kicks. */
  kickMod: boolean;
  /** Move pad: floating origin x and the current screen direction. */
  ox: number;
  moveX: -1 | 0 | 1;
}

interface Queued {
  a: Action;
  /** Ticks this action has waited (dropped after `bufferTicks`). */
  waited: number;
}

type Ev =
  | { e: 'down' | 'move' | 'up'; id: number; x: number; y: number; t: number }
  | { e: 'cancel'; id: number; t: number }
  | { e: 'cancelAll'; t: number }
  | { e: 'key'; code: string; down: boolean; t: number };

export interface RecognizerOptions {
  config?: Partial<TouchConfig>;
  /** CSS px per dp (1 on phones; see pxPerDpFor). */
  pxPerDp?: number;
  layout?: TouchLayout;
}

export class InputRecognizer {
  private cfgDp: TouchConfig;
  private cfg: ScaledConfig;
  private layout: TouchLayout;
  private ctx: TouchContext = { ...DEFAULT_CONTEXT };
  private mode: FightMode = 'stand';
  private events: Ev[] = [];
  private tracks = new Map<number, Track>();
  private queue: Queued[] = [];
  private gestures: GestureEvent[] = [];
  /** Keys held, in press order (the last pressed move key wins). */
  private keys: string[] = [];
  /** Forward flicks alternate between slipping left and right. */
  private nextForwardSlip: Evade = 'left';
  private touchesOut: ActiveTouch[] = [];
  /** Ticks an action may wait in the queue before it is stale. */
  private bufferTicks: number;

  constructor(opts: RecognizerOptions = {}) {
    this.cfgDp = { ...DEFAULT_TOUCH_CONFIG, ...opts.config };
    const pxPerDp = opts.pxPerDp ?? opts.layout?.pxPerDp ?? 1;
    this.layout = opts.layout ?? computeTouchLayout(844, 390, undefined, { pxPerDp });
    this.cfg = scaleConfig(this.cfgDp, pxPerDp, this.layout.height);
    this.bufferTicks = Math.max(1, Math.round((this.cfg.bufferMs * 60) / 1000));
  }

  /** New screen size, safe areas or handedness: the zones and the screen-relative thresholds follow. */
  setLayout(layout: TouchLayout): void {
    this.layout = layout;
    this.cfg = scaleConfig(this.cfgDp, layout.pxPerDp, layout.height);
  }

  getLayout(): TouchLayout {
    return this.layout;
  }

  /** The thresholds in use, in CSS px (for the overlay and the docs). */
  scaled(): Readonly<ScaledConfig> {
    return this.cfg;
  }

  // ---------------------------------------------------------------- event intake (call from DOM handlers)

  pointerDown(id: number, x: number, y: number, t: number): void {
    this.events.push({ e: 'down', id, x, y, t });
  }

  pointerMove(id: number, x: number, y: number, t: number): void {
    this.events.push({ e: 'move', id, x, y, t });
  }

  pointerUp(id: number, x: number, y: number, t: number): void {
    this.events.push({ e: 'up', id, x, y, t });
  }

  /** The system took the touch away (a system gesture, a call): it fires nothing. */
  pointerCancel(id: number, t: number): void {
    this.events.push({ e: 'cancel', id, t });
  }

  /** Window lost focus, pause, screen change: every finger and key is released without firing. */
  cancelAll(t: number): void {
    this.events.push({ e: 'cancelAll', t });
  }

  keyDown(code: string, t: number): void {
    this.events.push({ e: 'key', code, down: true, t });
  }

  keyUp(code: string, t: number): void {
    this.events.push({ e: 'key', code, down: false, t });
  }

  /** Forget everything (between fights, after a pause). */
  reset(): void {
    this.events.length = 0;
    this.tracks.clear();
    this.queue.length = 0;
    this.gestures.length = 0;
    this.keys.length = 0;
    this.nextForwardSlip = 'left';
  }

  // ---------------------------------------------------------------- the tick

  /**
   * Advance to time `now` (ms, same clock as the event timestamps) with the fight's current context and return this
   * tick's input. Call exactly once per simulation tick.
   */
  tick(now: number, ctx: TouchContext = DEFAULT_CONTEXT): FightInput {
    this.ctx = { ...ctx };
    if (ctx.mode !== this.mode) this.changeMode(ctx.mode);
    for (const ev of this.events) this.process(ev);
    this.events.length = 0;
    this.timers(now);

    const out: FightInput = { ...NO_INPUT };
    if (this.mode === 'locked') {
      this.queue.length = 0;
      return out;
    }
    // one action per channel, oldest first; stale ones are dropped
    const taken = new Set<Channel>();
    const keep: Queued[] = [];
    for (const q of this.queue) {
      const ch = channelOf(q.a);
      if (!taken.has(ch)) {
        taken.add(ch);
        this.apply(out, q.a);
      } else if (++q.waited <= this.bufferTicks) keep.push(q);
    }
    this.queue = keep;

    out.block = this.blocking(now) && out.evade === null;
    out.move = this.mode === 'stand' ? this.moving() : 0;
    return out;
  }

  /** Recognised gestures since the last call (for on-screen feedback and the lab readout). */
  drainGestures(): GestureEvent[] {
    const g = this.gestures;
    this.gestures = [];
    return g;
  }

  /** The fingers currently down, for drawing. The array is reused: read it, don't keep it. */
  touches(): readonly ActiveTouch[] {
    const out = this.touchesOut;
    out.length = 0;
    for (const tr of this.tracks.values()) {
      out.push({
        id: tr.id,
        zone: tr.zone,
        x: tr.x,
        y: tr.y,
        ox: tr.ox,
        blocking: this.trackBlocks(tr, tr.t),
        moveX: tr.moveX,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- internals

  private apply(out: FightInput, a: Action): void {
    switch (a.k) {
      case 'strike':
        out.strike = a.strike;
        break;
      case 'special':
        out.special = true;
        break;
      case 'shoot':
        out.shoot = true;
        break;
      case 'evade':
        out.evade = a.evade;
        break;
      case 'ground':
        out.ground = a.dir;
        break;
      case 'tap':
        out.tap = true;
        break;
    }
  }

  private changeMode(mode: FightMode): void {
    this.mode = mode;
    // inputs meant for the old mode would mean something else now (a jab is not a ground-and-pound)
    this.queue.length = 0;
    for (const tr of this.tracks.values()) {
      tr.orphan = true;
      tr.down = null;
      tr.partner = -1;
      tr.kickMod = false;
    }
  }

  private emit(a: Action, gesture: GestureKind, tr: Track | null, dir: Dir8 | null, t: number): void {
    this.queue.push({ a, waited: 0 });
    if (this.gestures.length < 64) {
      this.gestures.push({
        action: a,
        gesture,
        zone: tr ? tr.zone : 'ignore',
        dir,
        x0: tr ? tr.samples[0].x : -1,
        y0: tr ? tr.samples[0].y : -1,
        x1: tr ? tr.x : -1,
        y1: tr ? tr.y : -1,
        t,
      });
    }
  }

  private zoneAt(x: number, y: number): Zone {
    const L = this.layout;
    if (inRect(L.pause, x, y)) return 'ignore';
    if (this.mode === 'stand') {
      if (this.ctx.specialReady && inRect(L.specialZone, x, y)) return 'special';
      if (inRect(L.kickZone, x, y)) return 'kick';
      if (inRect(L.shootZone, x, y)) return 'shoot';
      if (inRect(L.moveZone, x, y)) return 'move';
    }
    const right = x >= L.splitX;
    return right !== L.mirrored ? 'offence' : 'defence';
  }

  private process(ev: Ev): void {
    switch (ev.e) {
      case 'down':
        this.down(ev.id, ev.x, ev.y, ev.t);
        break;
      case 'move': {
        const tr = this.tracks.get(ev.id);
        if (tr) this.moveTo(tr, ev.x, ev.y, ev.t);
        break;
      }
      case 'up':
        this.up(ev.id, ev.x, ev.y, ev.t);
        break;
      case 'cancel':
        this.drop(ev.id);
        break;
      case 'cancelAll':
        this.tracks.clear();
        this.keys.length = 0;
        break;
      case 'key':
        this.key(ev.code, ev.down, ev.t);
        break;
    }
  }

  private down(id: number, x: number, y: number, t: number): void {
    if (this.tracks.has(id)) this.drop(id); // a lost pointerup: start over
    if (this.tracks.size >= this.cfg.maxTouches) return;
    const zone = this.zoneAt(x, y);
    const tr: Track = {
      id,
      zone,
      orphan: this.mode === 'locked',
      consumed: zone === 'ignore',
      x0: x,
      y0: y,
      t0: t,
      x,
      y,
      t,
      samples: [{ x, y, t }],
      maxD: 0,
      armed: true,
      fired: false,
      stillX: x,
      stillY: y,
      stillT: t,
      down: null,
      partner: -1,
      kickMod: false,
      ox: x,
      moveX: 0,
    };
    this.tracks.set(id, tr);
    if (tr.orphan || tr.consumed) return;

    if (this.mode === 'sub') {
      // mashing: every finger that lands counts, wherever it lands
      tr.consumed = true;
      this.emit({ k: 'tap' }, 'mash', tr, null, t);
      return;
    }
    if (this.mode !== 'stand') return;

    if (zone === 'special') {
      tr.consumed = true;
      this.emit({ k: 'special' }, 'button', tr, null, t);
    } else if (zone === 'shoot') {
      tr.consumed = true;
      this.emit({ k: 'shoot' }, 'button', tr, null, t);
    } else if (zone === 'offence') {
      // KICK held still: this finger's strike becomes a kick
      for (const k of this.tracks.values()) {
        if (k.zone === 'kick' && !k.orphan && !k.consumed && !k.fired && k.maxD <= this.cfg.tapSlop) {
          k.consumed = true;
          tr.kickMod = true;
          return;
        }
      }
      // a second finger right after the first: a two-finger kick
      for (const o of this.tracks.values()) {
        if (o === tr || o.zone !== 'offence' || o.orphan || o.consumed || o.fired || o.kickMod) continue;
        if (o.partner !== -1 || o.down || t - o.t0 > this.cfg.twoFingerMs) continue;
        o.partner = tr.id;
        tr.partner = o.id;
        return;
      }
    }
  }

  /** Track a finger's movement and fire swipes that are long enough. */
  private moveTo(tr: Track, x: number, y: number, t: number): void {
    tr.x = x;
    tr.y = y;
    tr.t = t;
    const s = tr.samples;
    s.push({ x, y, t });
    // keep samples[0] at (or just before) the start of the window: where the finger was when the window began
    while (s.length > 2 && s[1].t <= t - this.cfg.swipeWindowMs) s.shift();
    if (s.length > 24) s.splice(1, s.length - 24);
    const d0 = dist(tr.x0, tr.y0, x, y);
    if (d0 > tr.maxD) tr.maxD = d0;
    if (dist(tr.stillX, tr.stillY, x, y) > this.cfg.tapSlop) {
      tr.stillX = x;
      tr.stillY = y;
      tr.stillT = t;
    }

    if (tr.zone === 'move') {
      // floating pad: measured from where the thumb landed; the origin trails the thumb beyond the knob's reach
      const dx = x - tr.ox;
      if (dx > this.cfg.moveMax) tr.ox = x - this.cfg.moveMax;
      else if (dx < -this.cfg.moveMax) tr.ox = x + this.cfg.moveMax;
      const ddx = x - tr.ox;
      tr.moveX = ddx >= this.cfg.moveDead ? 1 : ddx <= -this.cfg.moveDead ? -1 : 0;
      return;
    }
    if (tr.orphan || tr.consumed) return;

    if (this.mode === 'ground') {
      if (!tr.armed) return;
      const v = this.windowVec(tr);
      if (v.d >= this.cfg.commit) this.fireGround(tr, v.dx, v.dy, t);
      return;
    }
    if (this.mode !== 'stand') return;

    switch (tr.zone) {
      case 'offence':
        this.offenceMove(tr, t);
        break;
      case 'kick': {
        if (!tr.armed || tr.fired) return;
        const v = this.windowVec(tr);
        if (v.d >= this.cfg.commit) this.fireKick(tr, v.dx, v.dy, 'swipe', t);
        break;
      }
      case 'defence': {
        if (!tr.armed) return;
        const v = this.windowVec(tr);
        if (v.d >= this.cfg.flick) this.fireFlick(tr, v.dx, v.dy, t);
        break;
      }
      case 'move':
      case 'shoot':
      case 'special':
      case 'ignore':
        break;
    }
  }

  private offenceMove(tr: Track, t: number): void {
    if (tr.down) {
      // a swipe down in progress: long enough becomes a takedown, otherwise it waits to become a body shot
      const dd = dist(tr.down.x, tr.down.y, tr.x, tr.y);
      if (dd >= this.cfg.takedown) {
        tr.down = null;
        this.fired(tr);
        this.emit({ k: 'shoot' }, 'swipe', tr, 'D', t);
      } else if (dd > tr.down.prog + 1) {
        tr.down.prog = dd;
        tr.down.progT = t;
      }
      return;
    }
    if (!tr.armed) return;
    const pair = tr.partner !== -1 ? this.tracks.get(tr.partner) : undefined;
    const v = this.windowVec(tr);
    if (v.d < this.cfg.commit) return;
    if (pair || tr.kickMod) {
      this.fireKick(tr, v.dx, v.dy, pair ? 'twoFinger' : 'kickMod', t);
      if (pair) this.consumePair(tr, pair);
      return;
    }
    const d = dir8(v.dx, v.dy, this.ctx.forward, this.cfg.straightTan);
    if (!d) return;
    if (isDown(d)) {
      if (this.ctx.sprawl || v.d >= this.cfg.takedown) {
        this.fired(tr);
        this.emit({ k: 'shoot' }, 'swipe', tr, d, t);
      } else {
        const a = tr.samples[0];
        tr.down = { x: a.x, y: a.y, dir: d, prog: v.d, progT: t };
      }
      return;
    }
    this.fired(tr);
    this.emit({ k: 'strike', strike: OFFENCE_SWIPES[d] }, 'swipe', tr, d, t);
  }

  private up(id: number, x: number, y: number, t: number): void {
    const tr = this.tracks.get(id);
    if (!tr) return;
    // the lift point is a sample too: a flick whose last stretch only shows up in pointerup still counts
    if (x !== tr.x || y !== tr.y || t !== tr.t) this.moveTo(tr, x, y, t);
    this.tracks.delete(id);
    if (tr.orphan || tr.consumed) return;
    const pair = tr.partner !== -1 ? this.tracks.get(tr.partner) : undefined;
    const dur = t - tr.t0;
    const isTap = !tr.fired && tr.maxD <= this.cfg.tapSlop && dur <= this.cfg.tapMaxMs;

    if (this.mode === 'ground') {
      if (tr.armed) {
        const v = this.windowVec(tr);
        if (v.d >= this.cfg.swipeMin) {
          this.fireGround(tr, v.dx, v.dy, t);
          return;
        }
      }
      if (isTap) this.emit({ k: 'tap' }, 'tap', tr, null, t);
      return;
    }
    if (this.mode !== 'stand') return;

    switch (tr.zone) {
      case 'offence': {
        if (tr.down) {
          this.fired(tr);
          this.emit({ k: 'strike', strike: 'bodyShot' }, 'swipe', tr, tr.down.dir, t);
          tr.down = null;
          return;
        }
        if (pair) {
          // a two-finger gesture ends when the first finger lifts: the finger that moved more picks the kick
          const v1 = this.windowVec(tr);
          const v2 = this.windowVec(pair);
          const v = v2.d > v1.d ? v2 : v1;
          const quick = dur <= this.cfg.tapMaxMs * 1.5;
          if (v.d >= this.cfg.swipeMin) this.fireKick(tr, v.dx, v.dy, 'twoFinger', t);
          else if (quick && tr.maxD <= this.cfg.tapSlop * 1.5) this.fireKick(tr, 0, 0, 'twoFinger', t);
          this.consumePair(tr, pair);
          return;
        }
        if (tr.armed) {
          const v = this.windowVec(tr);
          if (v.d >= this.cfg.swipeMin) {
            if (tr.kickMod) {
              this.fireKick(tr, v.dx, v.dy, 'kickMod', t);
              return;
            }
            const d = dir8(v.dx, v.dy, this.ctx.forward, this.cfg.straightTan);
            if (d) {
              const shoot = isDown(d) && (this.ctx.sprawl || v.d >= this.cfg.takedown);
              this.emit(shoot ? { k: 'shoot' } : { k: 'strike', strike: OFFENCE_SWIPES[d] }, 'swipe', tr, d, t);
              return;
            }
          }
        }
        if (isTap) {
          if (tr.kickMod) this.fireKick(tr, 0, 0, 'kickMod', t);
          else this.emit({ k: 'strike', strike: 'jab' }, 'tap', tr, null, t);
        }
        return;
      }
      case 'kick': {
        if (tr.fired) return;
        const v = this.windowVec(tr);
        if (v.d >= this.cfg.swipeMin) this.fireKick(tr, v.dx, v.dy, 'swipe', t);
        else if (tr.maxD <= this.cfg.tapSlop * 1.5 && dur <= this.cfg.tapMaxMs * 2) this.fireKick(tr, 0, 0, 'button', t);
        return;
      }
      case 'defence': {
        if (!tr.armed) return;
        const v = this.windowVec(tr);
        if (v.d >= this.cfg.swipeMin) this.fireFlick(tr, v.dx, v.dy, t);
        return;
      }
      case 'move':
      case 'shoot':
      case 'special':
      case 'ignore':
        return;
    }
  }

  private drop(id: number): void {
    const tr = this.tracks.get(id);
    if (!tr) return;
    this.tracks.delete(id);
    const p = tr.partner !== -1 ? this.tracks.get(tr.partner) : undefined;
    if (p) {
      // the partner carries on alone as an ordinary finger
      p.partner = -1;
    }
  }

  private consumePair(a: Track, b: Track): void {
    a.partner = -1;
    b.partner = -1;
    this.fired(a);
    b.consumed = true;
  }

  private fired(tr: Track): void {
    tr.fired = true;
    tr.armed = false;
    tr.stillX = tr.x;
    tr.stillY = tr.y;
    tr.stillT = tr.t;
  }

  private fireKick(tr: Track, dx: number, dy: number, how: GestureKind, t: number): void {
    const d = dx === 0 && dy === 0 ? null : dir8(dx, dy, this.ctx.forward, this.cfg.straightTan);
    this.fired(tr);
    tr.consumed = tr.zone === 'kick'; // the KICK button fires once per press
    this.emit({ k: 'strike', strike: kickFor(d) }, how, tr, d, t);
  }

  private fireFlick(tr: Track, dx: number, dy: number, t: number): void {
    const d = dir8(dx, dy, this.ctx.forward, this.cfg.straightTan);
    if (!d) return;
    this.fired(tr);
    if (this.ctx.sprawl && isDown(d)) {
      this.emit({ k: 'shoot' }, 'flick', tr, d, t);
      return;
    }
    let ev: Evade;
    if (d === 'F') {
      ev = this.nextForwardSlip;
      this.nextForwardSlip = ev === 'left' ? 'right' : 'left';
    } else ev = DEFENCE_FLICKS[d];
    this.emit({ k: 'evade', evade: ev }, 'flick', tr, d, t);
  }

  private fireGround(tr: Track, dx: number, dy: number, t: number): void {
    const g: GroundDir | null = dir4(dx, dy);
    if (!g) return;
    this.fired(tr);
    this.emit({ k: 'ground', dir: g }, 'swipe', tr, dir8(dx, dy, this.ctx.forward, this.cfg.straightTan), t);
  }

  /** Movement over the swipe window: from where the finger was when the window began to where it is now. */
  private windowVec(tr: Track): { dx: number; dy: number; d: number } {
    const a = tr.samples[0];
    const dx = tr.x - a.x;
    const dy = tr.y - a.y;
    return { dx, dy, d: Math.hypot(dx, dy) };
  }

  /** Things that happen because time passed with no events: settled body shots, re-arming after a swipe. */
  private timers(now: number): void {
    for (const tr of this.tracks.values()) {
      if (tr.orphan || tr.consumed) continue;
      if (tr.down && now - tr.down.progT >= this.cfg.downSettleMs) {
        // the swipe down stopped short of a takedown: it was a body shot
        const dir = tr.down.dir;
        tr.down = null;
        this.fired(tr);
        this.emit({ k: 'strike', strike: 'bodyShot' }, 'swipe', tr, dir, now);
        continue;
      }
      if (!tr.armed && !tr.down && (tr.zone === 'offence' || tr.zone === 'defence') && now - tr.stillT >= this.cfg.settleMs) {
        // the finger settled after a swipe: it may swipe again (block, slip, block, slip without lifting)
        tr.armed = true;
        tr.samples.length = 0;
        tr.samples.push({ x: tr.x, y: tr.y, t: now });
      }
    }
  }

  private trackBlocks(tr: Track, now: number): boolean {
    if (this.mode !== 'stand' && this.mode !== 'ground') return false;
    const defZone = tr.zone === 'defence' || (this.mode === 'ground' && tr.zone === 'move' && !this.isOffenceX(tr.x0));
    if (!defZone || tr.consumed) return false;
    // just dodged: the guard comes back when the thumb settles
    if (!tr.armed) return false;
    return now - tr.t0 >= this.cfg.blockDelayMs;
  }

  private isOffenceX(x: number): boolean {
    return x >= this.layout.splitX !== this.layout.mirrored;
  }

  private blocking(now: number): boolean {
    for (const tr of this.tracks.values()) if (this.trackBlocks(tr, now)) return true;
    for (const code of this.keys) {
      if (this.mode === 'stand' && STAND_KEYS[code]?.k === 'block') return true;
      if (this.mode === 'ground' && GROUND_KEYS[code]?.k === 'block') return true;
    }
    return false;
  }

  /** -1/0/+1 toward the opponent. The most recent touch on the pad wins, then the most recent key. */
  private moving(): -1 | 0 | 1 {
    let x: -1 | 0 | 1 = 0;
    for (const tr of this.tracks.values()) if (tr.zone === 'move' && tr.moveX !== 0) x = tr.moveX;
    if (x === 0) {
      for (const code of this.keys) {
        const b = STAND_KEYS[code];
        if (b && b.k === 'move') x = b.x;
      }
    }
    return x === 0 ? 0 : x === this.ctx.forward ? 1 : -1;
  }

  private key(code: string, down: boolean, t: number): void {
    const i = this.keys.indexOf(code);
    if (!down) {
      if (i >= 0) this.keys.splice(i, 1);
      return;
    }
    if (i >= 0) return; // auto-repeat
    this.keys.push(code);
    switch (this.mode) {
      case 'stand': {
        const b = STAND_KEYS[code];
        if (!b) return;
        switch (b.k) {
          case 'strike':
            this.emit({ k: 'strike', strike: b.strike }, 'key', null, null, t);
            break;
          case 'special':
            this.emit({ k: 'special' }, 'key', null, null, t);
            break;
          case 'shoot':
            this.emit({ k: 'shoot' }, 'key', null, null, t);
            break;
          case 'evade':
            this.emit({ k: 'evade', evade: b.evade }, 'key', null, null, t);
            break;
          case 'block':
          case 'move':
            break;
        }
        return;
      }
      case 'ground': {
        const b = GROUND_KEYS[code];
        if (!b) return;
        if (b.k === 'ground') this.emit({ k: 'ground', dir: b.dir }, 'key', null, null, t);
        else if (b.k === 'tap') this.emit({ k: 'tap' }, 'key', null, null, t);
        return;
      }
      case 'sub':
        if (SUB_KEYS.has(code)) this.emit({ k: 'tap' }, 'key', null, null, t);
        return;
      case 'locked':
        return;
    }
  }
}
