// The practice dummy: a sparring partner for the Training Room. Like the AI it is only a Controller: it reads the
// FightView and returns a FightInput each tick, with no randomness and no clock of its own (timing comes from
// view.tick), so the same fight always gets the same inputs and a practice fight could be replayed like any other.
//
// Modes:
//   stand  walks into range, then stands there and takes it (never attacks, never defends)
//   block  the same, with the guard always up (leg kicks into it are checked)
//   light  keeps a sparring distance and throws one slow, light strike at a time from a pattern
//   shoot  walks in and shoots a takedown every few seconds
//   ground used with a ground start: it holds position, resists a submission a little, never scrambles
// In every mode it gets up from a knockdown quickly and never sprawls, so the player can practise takedowns.

import type { Controller, FightInput, FightView, Side, Strike } from '../game/fight/types';
import { NO_INPUT } from '../game/fight/types';

export type DummyMode = 'stand' | 'block' | 'light' | 'shoot' | 'clinch' | 'ground';

export const DUMMY_MODES: readonly DummyMode[] = ['stand', 'block', 'light', 'shoot', 'clinch', 'ground'];

export const DUMMY_LABEL: Record<DummyMode, string> = {
  stand: 'Stands still',
  block: 'Blocks',
  light: 'Attacks lightly',
  shoot: 'Shoots takedowns',
  clinch: 'Grabs you',
  ground: 'Ground practice',
};

/** What `light` throws by default, in turn: mostly jabs, a leg kick to check, a body shot. */
export const LIGHT_PATTERN: readonly Strike[] = ['jab', 'jab', 'lowKick', 'cross', 'bodyShot'];

export interface DummyOptions {
  mode: DummyMode;
  /** Strikes `light` throws in turn (default LIGHT_PATTERN). */
  pattern?: readonly Strike[];
}

/** Ticks between the dummy's strikes (light) and takedown shots (shoot). */
export const DUMMY_STRIKE_EVERY = 95;
export const DUMMY_SHOOT_EVERY = 170;
/** Ticks between taps when it is caught in a submission (ground): a little resistance, easy to beat. */
export const DUMMY_SUB_TAP_EVERY = 30;

const FREE = new Set(['idle', 'walkFwd', 'walkBack', 'block']);

export class DummyController implements Controller {
  private _mode: DummyMode;
  private pattern: readonly Strike[];
  private n = 0;
  private nextAttack = -1;

  constructor(opts: DummyOptions) {
    this._mode = opts.mode;
    this.pattern = opts.pattern && opts.pattern.length ? opts.pattern : LIGHT_PATTERN;
  }

  get mode(): DummyMode {
    return this._mode;
  }

  /** Change what the dummy does (a drill step moved on). Its timing restarts. */
  setMode(mode: DummyMode, pattern?: readonly Strike[]): void {
    this._mode = mode;
    this.pattern = pattern && pattern.length ? pattern : LIGHT_PATTERN;
    this.n = 0;
    this.nextAttack = -1;
  }

  next(view: FightView, _side: Side): FightInput {
    void _side;
    const out: FightInput = { ...NO_INPUT };
    if (view.phase !== 'fight' || view.result) return out;
    const me = view.me;
    // knocked down: get up as quickly as a person tapping would
    if (me.action === 'downed') {
      out.tap = view.tick % 6 === 0;
      return out;
    }
    const g = view.ground;
    if (g) {
      // caught in a hold: tap now and then (the player still wins it by tapping at a normal pace)
      if (g.sub && !g.sub.mine) out.tap = this._mode === 'ground' && view.tick % DUMMY_SUB_TAP_EVERY === 0;
      // underneath with the guard up when blocking is its job
      else if (!g.meTop && !g.scramble && !g.sub) out.block = this._mode === 'block';
      return out;
    }
    // their takedown: no sprawl (practise your shots); in the clinch it just holds on (practise your knees, trips
    // and break-aways): no contests won, no trips fought
    if (view.takedown || view.clinch) return out;
    if (this.nextAttack < 0) this.nextAttack = view.tick + 40;
    switch (this._mode) {
      case 'stand':
      case 'ground':
        if (view.dist > 1150) out.move = 1;
        return out;
      case 'block':
        if (view.dist > 1150) out.move = 1;
        else out.block = true;
        return out;
      case 'light':
        if (view.dist > 1180) out.move = 1;
        else if (view.dist < 820) out.move = -1;
        if (view.tick >= this.nextAttack && view.dist <= 1250 && FREE.has(me.action) && !me.stunned) {
          out.move = 0;
          out.strike = this.pattern[this.n++ % this.pattern.length];
          this.nextAttack = view.tick + DUMMY_STRIKE_EVERY;
        }
        return out;
      case 'clinch':
        if (view.dist > 900) out.move = 1;
        if (view.tick >= this.nextAttack && view.dist <= 1100 && FREE.has(me.action) && !me.stunned) {
          out.move = 0;
          out.clinch = true;
          this.nextAttack = view.tick + DUMMY_SHOOT_EVERY;
        }
        return out;
      case 'shoot':
        if (view.dist > 1250) out.move = 1;
        if (view.tick >= this.nextAttack && view.dist <= 1400 && FREE.has(me.action) && !me.stunned) {
          out.move = 0;
          out.shoot = true;
          this.nextAttack = view.tick + DUMMY_SHOOT_EVERY;
        }
        return out;
    }
  }
}
