// Shared internals of the fight simulation: the Fight object, stat formulas, meters, actions and events. Integer
// maths only (see math.ts). Everything that changes the state goes through here or through sim.ts / ground.ts.

import { judgeCards, decide } from './judges';
import { clampi, muldiv } from './math';
import { MOVES } from './moves';
import type {
  ActionId,
  FightEvent,
  FighterSpec,
  FighterState,
  FighterStats,
  FightResult,
  FightRules,
  FightState,
  FinishMethod,
  StoppageKind,
  SubKind,
  MoveId,
  RoundStats,
  Side,
  Zone,
} from './types';
import { METER_MAX } from './types';

/** The live fight: the plain JSON state plus what never changes during it and this tick's events. */
export interface Fight {
  state: FightState;
  readonly specs: [FighterSpec, FighterSpec];
  readonly rules: FightRules;
  readonly seed: number;
  /** Events since the last drainEvents(). Not part of the state (a restore does not bring them back). */
  events: FightEvent[];
}

export const SIM_VERSION = 2;

export const DEFAULT_RULES: FightRules = {
  rounds: 3,
  roundTicks: 90 * 60,
  breakTicks: 4 * 60,
  introTicks: 3 * 60,
  title: false,
};

// ---- space ----------------------------------------------------------------------------------------------------

export const WALL = 3600;
export const START_X = 1200;
/** Fighters' centres never get closer than this standing up. */
export const MIN_GAP = 560;

// ---- stat formulas (stats 1..100; every result an integer) ------------------------------------------------------

export function stat(f: Fight, side: Side, k: keyof FighterStats): number {
  return clampi(f.specs[side].stats[k] | 0, 1, 100);
}

/** Walk speed in mm per tick: 22..34, slowed by leg damage and exhaustion. */
export function walkSpeed(f: Fight, side: Side): number {
  const me = f.state.fighters[side];
  let v = 22 + muldiv(stat(f, side, 'speed'), 12, 100);
  v = muldiv(v, METER_MAX - (me.legs >> 1), METER_MAX);
  if (me.gassed) v = muldiv(v, 3, 4);
  if (me.stunTicks > 0) v = v >> 1;
  return Math.max(6, v);
}

/** Damage multiplier per mille for the attacker: power, the move's skill stat, stamina. */
export function attackPm(f: Fight, side: Side, move: MoveId): number {
  const me = f.state.fighters[side];
  const d = MOVES[move];
  const power = stat(f, side, 'power');
  const skill = stat(f, side, d.skill);
  let pm = 360 + power * 4 + skill * 2; // 366..960
  // a tired fighter hits softer: 60 % at empty stamina
  pm = muldiv(pm, 6000 + muldiv(me.stamina, 4000, METER_MAX), 10000);
  return pm;
}

/** How much of a head hit goes through, per mille: a great chin takes 70 %, a glass chin 130 %. */
export function chinPm(f: Fight, side: Side): number {
  return 1300 - stat(f, side, 'chin') * 6;
}

/** Stamina cost of an action for this fighter (cardio 100 = 70 %, cardio 1 = 129 %). */
export function costFor(f: Fight, side: Side, base: number): number {
  return muldiv(base, 1300 - stat(f, side, 'cardio') * 6, 1000);
}

/** Ticks added to a strike's startup for this fighter: slow fighters, tired fighters, wobbly fighters. */
export function startupPenalty(f: Fight, side: Side, move: MoveId): number {
  const me = f.state.fighters[side];
  const d = MOVES[move];
  const quick = muldiv(stat(f, side, 'speed') + stat(f, side, d.skill), 1, 2); // 1..100
  let p = quick >= 85 ? -2 : quick >= 68 ? -1 : quick >= 45 ? 0 : quick >= 20 ? 1 : 2;
  if (me.stamina < 3000) p += me.stamina < 1200 ? 3 : 1;
  if (me.stunTicks > 0) p += 4;
  return p;
}

// ---- actions and events -----------------------------------------------------------------------------------------

export function setAction(me: FighterState, action: ActionId, length: number, impact = -1): void {
  me.action = action;
  me.actionTick = 0;
  me.actionLength = length;
  me.actionImpact = impact;
}

/** Back to the neutral stance (or the stun wobble). Clears the attack in progress. */
export function toNeutral(me: FighterState): void {
  clearMove(me);
  if (me.stunTicks > 0) setAction(me, 'stunned', 0);
  else setAction(me, 'idle', 0);
}

export function clearMove(me: FighterState): void {
  me.move = null;
  me.moveStartup = 0;
  me.moveActive = 0;
  me.moveRecovery = 0;
  me.moveResult = 0;
  me.moveCounter = false;
  me.moveLunge = 0;
}

/** Is the fighter free to start something new (idle, walking, holding block, wobbling)? */
export function isFree(me: FighterState): boolean {
  switch (me.action) {
    case 'idle':
    case 'walkFwd':
    case 'walkBack':
    case 'block':
    case 'stunned':
      return true;
    default:
      return false;
  }
}

export function emit(f: Fight, e: FightEvent): void {
  f.events.push(e);
}

export function opp(side: Side): Side {
  return side === 0 ? 1 : 0;
}

export function roundStats(f: Fight, side: Side): RoundStats {
  const s = f.state;
  return s.stats[s.round - 1][side];
}

export function emptyRoundStats(): RoundStats {
  return {
    thrown: 0,
    landed: 0,
    power: 0,
    defended: 0,
    headDmg: 0,
    bodyDmg: 0,
    legDmg: 0,
    knockdowns: 0,
    takedowns: 0,
    tdAttempts: 0,
    controlTicks: 0,
    subAttempts: 0,
  };
}

/** Spend stamina (never below 0); flags the fighter as gassed when it runs dry. */
export function spend(f: Fight, side: Side, amount: number): void {
  const me = f.state.fighters[side];
  me.stamina = Math.max(0, me.stamina - amount);
  if (me.stamina < 700 && !me.gassed) {
    me.gassed = true;
    emit(f, { type: 'gassed', tick: f.state.tick, side });
  }
}

/** Add to the special meter; announces when it becomes full. */
export function addSpecial(f: Fight, side: Side, amount: number): void {
  const me = f.state.fighters[side];
  if (me.special >= METER_MAX) return;
  me.special = Math.min(METER_MAX, me.special + amount);
  if (me.special >= METER_MAX) emit(f, { type: 'specialReady', tick: f.state.tick, side });
}

/**
 * Put damage on a zone of `side` and the matching side effects (hurt for the head, stamina for the body).
 * Returns the damage actually applied (after the chin for head shots).
 */
export function applyZoneDamage(f: Fight, side: Side, zone: Zone, dmg: number): number {
  const me = f.state.fighters[side];
  if (zone === 'head') {
    const d = muldiv(dmg, chinPm(f, side), 1000);
    // the head meter is the lasting damage (KO risk, swelling); hurt is the short-term wobble
    me.head = Math.min(METER_MAX, me.head + (d >> 2));
    me.hurt = Math.min(METER_MAX, me.hurt + muldiv(d, 15, 10));
    return d;
  }
  if (zone === 'body') {
    me.body = Math.min(METER_MAX, me.body + dmg);
    // body shots take the wind out: stamina now, and the ceiling it can recover to
    spend(f, side, muldiv(dmg, 3, 2));
    me.staminaCap = Math.max(3000, METER_MAX - muldiv(me.body, 4, 10));
    if (me.stamina > me.staminaCap) me.stamina = me.staminaCap;
    return dmg;
  }
  // legs wear down slower than heads: it takes a sustained low-kick game to chop someone down
  const l = muldiv(dmg, 45, 100);
  me.legs = Math.min(METER_MAX, me.legs + l);
  spend(f, side, dmg >> 2);
  return l;
}

export function newFighter(x: number, facing: 1 | -1): FighterState {
  return {
    x,
    facing,
    action: 'idle',
    actionTick: 0,
    actionLength: 0,
    actionImpact: -1,
    move: null,
    moveStartup: 0,
    moveActive: 0,
    moveRecovery: 0,
    moveResult: 0,
    moveCounter: false,
    moveChain: 0,
    moveLunge: 0,
    bufMove: null,
    bufEvade: null,
    bufTicks: 0,
    stamina: METER_MAX,
    staminaCap: METER_MAX,
    head: 0,
    body: 0,
    legs: 0,
    hurt: 0,
    stunTicks: 0,
    guard: METER_MAX,
    special: 0,
    counterTicks: 0,
    guardBrokenTicks: 0,
    downTicks: 0,
    unanswered: 0,
    knockdowns: 0,
    legKnockdowns: 0,
    gassed: false,
    groundCooldown: 0,
    comboHits: 0,
    comboTicks: 0,
    coverTicks: 0,
    sprawlReady: false,
    hurtFlags: 0,
    lastMove: null,
    repeats: 0,
    prompt: null,
  };
}

// ---- the end ------------------------------------------------------------------------------------------------------

/** Ticks after the result before the fighters drop the finishing pose and go to victory / defeat. */
export const AFTERMATH_TICKS = 150;

/**
 * Finish the fight. For a decision pass method 'DEC' and no winner: the judges decide. Every result carries the
 * judges' cards up to now so the stats screen can show them.
 */
export function endFight(
  f: Fight,
  winner: Side | null,
  method: FinishMethod,
  opts: { by?: MoveId | 'pound' | null; stoppage?: StoppageKind | null; sub?: SubKind | null } = {},
): void {
  const s = f.state;
  if (s.result) return;
  const cards = judgeCards(s, method === 'DEC' ? s.stats.length : s.round);
  let decision: FightResult['decision'] = null;
  if (method === 'DEC') {
    const d = decide(cards);
    winner = d.winner;
    decision = d.decision;
  }
  s.result = {
    winner,
    method,
    by: opts.by ?? null,
    stoppage: opts.stoppage ?? null,
    sub: opts.sub ?? null,
    decision,
    round: s.round,
    roundTick: f.rules.roundTicks - s.clock,
    totalTicks: s.tick,
    cards,
  };
  s.phase = 'ended';
  s.phaseTick = 0;
  s.takedown = null;
  for (const me of s.fighters) {
    me.prompt = null;
    me.bufMove = null;
    me.bufEvade = null;
    clearMove(me);
  }
  if (method === 'DEC' || method === 'TKO') {
    // a decision, or the referee jumping in: both stand (a ground TKO stands them in the aftermath)
    if (method === 'DEC') {
      s.ground = null;
      for (let i = 0 as Side; i < 2; i = (i + 1) as Side) {
        const me = s.fighters[i];
        setAction(me, winner === null ? 'idle' : winner === i ? 'victory' : 'defeat', 0);
      }
    }
  }
  emit(f, { type: 'fightEnd', tick: s.tick, result: s.result });
}
