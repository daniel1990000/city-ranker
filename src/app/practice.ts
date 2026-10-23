// The Training Room: a practice fight against the dummy (app/dummy.ts) with no rewards, no saved stats and no clock,
// plus short drills whose steps tick off when the right things happen in the fight.
//
// The fight simulation itself is the normal one (src/game/fight is not changed for practice). What the room adds
// happens between ticks, outside the simulation, the same way the QA hooks do (App.qaGround):
//   - a fighter who hasn't been hit for a moment gets their damage back, so practice never runs out;
//   - "special always ready" keeps the player's special meter full;
//   - ground practice puts both fighters back in the chosen position after an escape or a stand-up;
//   - when the dummy has been sitting on top doing nothing, the referee stands them up sooner.
// A practice fight is never scored, saved or used for a replay, so these nudges can't affect anything else.

import type { Fight } from '../game/fight';
import { enterGround, standUp } from '../game/fight/ground';
import type { DivisionId, FightEvent, FighterSpec, FightInput, GroundPos, Side, Strike } from '../game/fight/types';
import { METER_MAX } from '../game/fight/types';
import { isSpecial } from '../game/fight/moves';
import { DummyController, type DummyMode } from './dummy';
import { division } from '../meta/divisions';

/** Practice rules: one very long round (an hour), a short walk-in. */
export const PRACTICE_RULES = { rounds: 1, roundTicks: 60 * 60 * 60, introTicks: 60, breakTicks: 60 } as const;

export interface GroundStart {
  pos: GroundPos;
  /** Who is on top: 0 = the player. */
  top: Side;
}

export type GroundStartId = 'mountTop' | 'mountBottom' | 'guardTop' | 'guardBottom';

export const GROUND_STARTS: Record<GroundStartId, { label: string; start: GroundStart }> = {
  mountTop: { label: 'Mount, you on top', start: { pos: 'mount', top: 0 } },
  mountBottom: { label: 'Mount, you underneath', start: { pos: 'mount', top: 1 } },
  guardTop: { label: 'Guard, you on top', start: { pos: 'guard', top: 0 } },
  guardBottom: { label: 'Guard, you underneath', start: { pos: 'guard', top: 1 } },
};

/** The sparring partner: an average fighter of the player's division, a little tougher to hurt. */
export function practicePartner(div: DivisionId): FighterSpec {
  const sex = division(div).sex;
  return {
    id: `practice-${div}`,
    name: 'Sparring Partner',
    nickname: 'Training Room',
    division: div,
    archetype: 'wrestler',
    rarity: 'common',
    stats: { power: 40, speed: 45, chin: 70, cardio: 80, striking: 45, kicking: 45, wrestling: 45, grappling: 45, submissions: 40, defense: 45 },
    lookSeed: sex === 'f' ? 31337 : 4242,
    lookHints: { sex, build: 'athletic', beard: sex === 'm' },
  };
}

// ---- drills ---------------------------------------------------------------------------------------------------

/** What a drill step can see besides the events. */
export interface DrillContext {
  /** The player pressed sprawl while the dummy's shot was coming in (a stuffed shot only counts then). */
  sprawlPressed: boolean;
}

export interface DrillStep {
  /** "Land 3 jabs" */
  goal: string;
  /** The gesture, in a few words. */
  how: string;
  count: number;
  /** What the dummy does during this step. */
  mode: DummyMode;
  pattern?: readonly Strike[];
  /** Ground steps start here. */
  ground?: GroundStart;
  match(e: FightEvent, ctx: DrillContext): boolean;
}

export interface Drill {
  id: string;
  title: string;
  blurb: string;
  steps: DrillStep[];
}

const POWER = new Set(['cross', 'hookL', 'hookR', 'uppercut', 'bodyShot']);
const landed = (e: FightEvent, move: (m: string) => boolean): boolean => e.type === 'hit' && e.side === 0 && !e.blocked && move(e.move);

export const DRILLS: readonly Drill[] = [
  {
    id: 'striking',
    title: 'Striking basics',
    blurb: 'Jab, power punches, a combo',
    steps: [
      { goal: 'Land 3 jabs', how: 'Tap the attack side', count: 3, mode: 'stand', match: e => landed(e, m => m === 'jab') },
      { goal: 'Land 2 power punches', how: 'Swipe the attack side: → cross, ↑ uppercut, ↗ ↖ hooks, ↓ body', count: 2, mode: 'stand', match: e => landed(e, m => POWER.has(m)) },
      { goal: 'Land a 3-hit combo', how: 'Strike again as each one lands: tap, tap, swipe →', count: 1, mode: 'stand', match: e => e.type === 'hit' && e.side === 0 && !e.blocked && e.chain >= 2 },
    ],
  },
  {
    id: 'kicks',
    title: 'Kicks',
    blurb: 'Body, leg and head kicks',
    steps: [
      { goal: 'Land a body kick', how: 'Tap KICK', count: 1, mode: 'stand', match: e => landed(e, m => m === 'bodyKick') },
      { goal: 'Land a leg kick', how: 'Swipe down from KICK', count: 1, mode: 'stand', match: e => landed(e, m => m === 'lowKick') },
      { goal: 'Land a head kick', how: 'Swipe up from KICK', count: 1, mode: 'stand', match: e => landed(e, m => m === 'headKick') },
    ],
  },
  {
    id: 'defence',
    title: 'Defence',
    blurb: 'Block, slip, check a leg kick',
    steps: [
      { goal: 'Block 3 punches', how: 'Hold your thumb on the defence side', count: 3, mode: 'light', pattern: ['jab', 'cross'], match: e => e.type === 'hit' && e.side === 1 && e.blocked && e.zone !== 'legs' },
      { goal: 'Slip 2 punches', how: 'Flick up or down on the defence side as the punch comes', count: 2, mode: 'light', pattern: ['jab', 'cross'], match: e => e.type === 'evade' && e.side === 0 },
      { goal: 'Check a leg kick', how: 'Hold block as the leg kick comes', count: 1, mode: 'light', pattern: ['lowKick'], match: e => e.type === 'check' && e.side === 0 },
    ],
  },
  {
    id: 'wrestling',
    title: 'Takedowns',
    blurb: 'Sprawl, then take them down',
    steps: [
      { goal: 'Sprawl 2 takedowns', how: 'Swipe down (or tap TAKEDOWN) as they shoot', count: 2, mode: 'shoot', match: (e, c) => e.type === 'sprawl' && e.side === 0 && e.success && c.sprawlPressed },
      { goal: 'Land a takedown', how: 'Get close, tap TAKEDOWN', count: 1, mode: 'stand', match: e => e.type === 'takedown' && e.side === 0 },
    ],
  },
  {
    id: 'clinch',
    title: 'Clinch',
    blurb: 'Grab, knees, break free, trip',
    steps: [
      { goal: 'Grab them', how: 'Get close, then hold a finger still on the attack side', count: 1, mode: 'stand', match: e => e.type === 'clinchStart' && e.side === 0 },
      { goal: 'Land 3 knees', how: 'In the clinch: tap (or swipe up from KICK for the head)', count: 3, mode: 'stand', match: e => landed(e, m => m === 'clinchKnee' || m === 'clinchKneeHead') },
      { goal: 'Break free', how: 'When they grab you: flick on the defence side, then flick the arrow', count: 1, mode: 'clinch', match: e => e.type === 'clinchContestEnd' && e.side === 0 && e.success },
      { goal: 'Trip them', how: 'Grab them on the cage, wait a moment, then tap TAKEDOWN', count: 1, mode: 'stand', match: e => e.type === 'clinchTripEnd' && e.side === 0 && e.success },
    ],
  },
  {
    id: 'bottom',
    title: 'Ground escapes',
    blurb: 'Escape mount, get back up',
    steps: [
      { goal: 'Escape mount', how: 'Swipe up, then swipe the arrow shown', count: 1, mode: 'ground', ground: { pos: 'mount', top: 1 }, match: e => e.type === 'scrambleEnd' && e.side === 0 && e.purpose === 'escape' && e.success },
      { goal: 'Get back up', how: 'From guard: swipe up, then swipe the arrow', count: 1, mode: 'ground', ground: { pos: 'guard', top: 1 }, match: e => e.type === 'scrambleEnd' && e.side === 0 && e.purpose === 'standUp' && e.success },
    ],
  },
  {
    id: 'top',
    title: 'Ground attack',
    blurb: 'Ground strikes, pass, submit',
    steps: [
      { goal: 'Land 5 ground strikes', how: 'Tap anywhere', count: 5, mode: 'ground', ground: { pos: 'mount', top: 0 }, match: e => landed(e, m => m === 'pound') },
      { goal: 'Pass to mount', how: 'From guard: swipe up, then swipe the arrow', count: 1, mode: 'ground', ground: { pos: 'guard', top: 0 }, match: e => e.type === 'scrambleEnd' && e.side === 0 && e.purpose === 'advance' && e.success },
      { goal: 'Finish a submission', how: 'Swipe down, then tap fast', count: 1, mode: 'ground', ground: { pos: 'mount', top: 0 }, match: e => e.type === 'tapOut' && e.side === 1 },
    ],
  },
];

export function drillById(id: string | null | undefined): Drill | null {
  return DRILLS.find(d => d.id === id) ?? null;
}

/** One go at a drill: which step, how far into it. */
export class DrillRun {
  step: number;
  count = 0;

  constructor(
    readonly drill: Drill,
    step = 0,
  ) {
    this.step = Math.max(0, Math.min(drill.steps.length, Math.floor(step)));
  }

  get current(): DrillStep | null {
    return this.drill.steps[this.step] ?? null;
  }

  get done(): boolean {
    return this.step >= this.drill.steps.length;
  }

  /** Feed one tick's events. Returns what happened: nothing, progress in the step, or the step completed. */
  feed(events: readonly FightEvent[], ctx: DrillContext): 'none' | 'progress' | 'step' {
    let out: 'none' | 'progress' | 'step' = 'none';
    for (const e of events) {
      const st = this.current;
      if (!st) break;
      if (!st.match(e, ctx)) continue;
      this.count++;
      out = 'progress';
      if (this.count >= st.count) {
        this.step++;
        this.count = 0;
        out = 'step';
        // a step moves on at most once a tick (the next step starts from a clean slate)
        break;
      }
    }
    return out;
  }
}

// ---- the room -----------------------------------------------------------------------------------------------------

export interface PracticeOptions {
  /** Free practice: what the dummy does. A drill sets it per step instead. */
  mode: DummyMode;
  /** Free ground practice: where to start. */
  ground: GroundStartId;
  /** A drill to run, or null for free practice. */
  drill: string | null;
  /** Start the drill at this step (going again after a knockout). */
  drillStep?: number;
  /** Keep the player's special meter full. */
  fullSpecial: boolean;
  /** The player's fighter (an owned fighter id); the App falls back to the main pick. */
  fighterId?: string;
}

export const DEFAULT_PRACTICE: PracticeOptions = { mode: 'stand', ground: 'mountTop', drill: null, fullSpecial: false };

/** Ticks without being hit before a fighter's damage comes back. */
export const REFILL_AFTER = 90;
/** Ticks standing before a ground drill puts them back on the mat; ticks in another position before the reset. */
export const GROUND_RESET_STANDING = 45;
export const GROUND_RESET_OTHER = 75;
/** The dummy on top doing nothing this long: the referee stands them up. */
export const DUMMY_TOP_IDLE = 150;

export class PracticeRoom {
  readonly dummy: DummyController;
  readonly run: DrillRun | null;
  /** Called when the drill moves on (progress, a step, done). */
  onChange: ((kind: 'progress' | 'step') => void) | null = null;
  private lastHit: [number, number] = [0, 0];
  private standing = GROUND_RESET_STANDING;
  private elsewhere = 0;
  private sprawlTick = -1000;

  constructor(readonly options: PracticeOptions) {
    const d = drillById(options.drill);
    this.run = d ? new DrillRun(d, options.drillStep ?? 0) : null;
    const st = this.run?.current;
    this.dummy = new DummyController({ mode: st ? st.mode : options.mode, pattern: st?.pattern });
  }

  /** The dummy's job right now (the drill step's, or the free choice). */
  get mode(): DummyMode {
    return this.dummy.mode;
  }

  /** Where ground practice starts right now, or null when practising standing up. */
  get groundStart(): GroundStart | null {
    if (this.run) return this.run.current?.ground ?? null;
    return this.options.mode === 'ground' ? GROUND_STARTS[this.options.ground].start : null;
  }

  /**
   * After each simulation tick, with that tick's events and inputs: tick the drill, then the practice nudges
   * (see the top of this file). Never called for a real fight.
   */
  afterTick(f: Fight, events: readonly FightEvent[], inputs: readonly [FightInput, FightInput]): void {
    const s = f.state;
    const t = s.tick;
    // the player's sprawl while the dummy's shot is on its way
    if (inputs[0].shoot && (s.takedown?.atk === 1 || s.fighters[1].action === 'shoot')) this.sprawlTick = t;
    for (const e of events) {
      if (e.type === 'hit' && !e.blocked && e.dmg > 0) this.lastHit[e.side === 0 ? 1 : 0] = t;
      else if (e.type === 'knockdown') this.lastHit[e.side] = t;
    }
    if (this.run && !this.run.done) {
      const r = this.run.feed(events, { sprawlPressed: t - this.sprawlTick <= 60 });
      if (r === 'step') {
        const st = this.run.current;
        if (st) this.dummy.setMode(st.mode, st.pattern);
        // a new ground step starts in its position at once
        this.standing = GROUND_RESET_STANDING;
        this.elsewhere = GROUND_RESET_OTHER;
      }
      if (r !== 'none') this.onChange?.(r);
    }
    if (s.phase !== 'fight' || s.result) return;

    // damage comes back after a quiet moment
    for (const i of [0, 1] as const) {
      const me = s.fighters[i];
      if (t - this.lastHit[i] < REFILL_AFTER || me.stunTicks > 0) continue;
      if (me.action === 'knockdown' || me.action === 'downed' || me.action === 'getUp' || s.ground?.sub) continue;
      me.head = 0;
      me.body = 0;
      me.legs = 0;
      me.hurt = 0;
      me.hurtFlags = 0;
      me.knockdowns = 0;
      me.legKnockdowns = 0;
      me.unanswered = 0;
      me.staminaCap = METER_MAX;
    }
    if (this.options.fullSpecial) {
      const me = s.fighters[0];
      if (!(me.move && isSpecial(me.move))) me.special = METER_MAX;
    }

    const start = this.groundStart;
    const g = s.ground;
    if (start) {
      if (!g) {
        if (s.takedown || s.fighters.some(x => x.action === 'knockdown' || x.action === 'shoot')) return;
        if (++this.standing >= GROUND_RESET_STANDING) this.reset(f, start);
        return;
      }
      this.standing = 0;
      const same = g.pos === start.pos && g.top === start.top;
      const busy = g.scramble || g.sub || s.fighters.some(x => x.action === 'gndAdvance' || x.action === 'gndEscape' || x.action === 'gndStandUp');
      if (same || busy) {
        this.elsewhere = 0;
        return;
      }
      if (++this.elsewhere >= GROUND_RESET_OTHER) this.reset(f, start);
      return;
    }
    // standing practice: the dummy doesn't hold anyone down for long
    if (g && g.top === 1 && !g.scramble && !g.sub && g.idle >= DUMMY_TOP_IDLE) standUp(f, 'ref');
  }

  private reset(f: Fight, start: GroundStart): void {
    enterGround(f, start.top, start.pos);
    this.standing = 0;
    this.elsewhere = 0;
  }
}
