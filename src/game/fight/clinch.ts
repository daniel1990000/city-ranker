// The clinch: grabbing at close range, the two holds, knees / elbows / dirty-boxing uppercuts, pushing the other
// fighter onto the cage (control time for the judges), the position contest (break away or reverse, answered with a
// flick like a ground scramble), the trip / body-lock takedown into the ground game and the referee separating a
// stalled clinch. Integer maths only. The strikes themselves are ordinary moves (MOVES in moves.ts) resolved by the
// standing code in sim.ts, so blocks, counters, knockdowns and the referee all work the same in here.

import {
  addSpecial,
  beginClinch,
  CLINCH_GAP,
  clinchHoldPose,
  clinchPinned,
  clearMove,
  costFor,
  emit,
  endClinch,
  type Fight,
  opp,
  placeClinchPair,
  roundStats,
  setAction,
  spend,
  stat,
} from './core';
import { completeTakedown } from './ground';
import { clampi, muldiv, rngInt } from './math';
import { CANCEL_AFTER, CHAIN_MAX, isClinchStrike } from './moves';
import type { ClinchPurpose, ClinchStrike, Evade, FighterPrompt, FighterState, FightInput, GroundDir, MoveId, Side, Strike } from './types';

// ---- tuning -----------------------------------------------------------------------------------------------------

export const CLINCH = {
  /** The grab: startup before it closes (a strike landing first beats it), recovery after a miss. */
  enterStartup: 14,
  enterRecovery: 18,
  /** Centre-to-centre distance the grab reaches at its last startup tick, and the forward travel during startup. */
  enterReach: 900,
  enterLunge: 300,
  enterCost: 500,
  /** A grab pressed from further away than this does nothing (a resting thumb is not a lunge across the cage). */
  grabRange: 1250,
  /** How far the fighter in control walks the other back per tick, toward the cage. */
  push: 12,
  /** Stamina drained per tick from a fighter pinned on the cage. */
  wallDrain: 5,
  /** Position contest (break away / reverse): window to answer, cost, cooldown after losing one. */
  contestWindow: 48,
  contestCost: 350,
  contestCooldown: 80,
  /** The trip: ticks before it resolves (the other fighter can fight it all that time), cost, cooldown. */
  tripTicks: 34,
  tripCost: 900,
  tripCooldown: 150,
  /** A trip needs a set-up: this long in control first (a trip the instant the grab lands is pressed in vain). */
  tripSetup: 36,
  /** The referee separates a clinch with no work for this long, and any clinch after this long. */
  refIdle: 210,
  refMax: 720,
  /** No grabbing again this soon after a clinch ends (ticks). */
  regrab: 60,
  refRegrab: 120,
  /** The held fighter's strikes hit softer (per mille): they have less room and no control. */
  heldDmgPm: 800,
} as const;

/** What a strike pressed in the clinch becomes: taps and downward swipes knee the body, upward kicks knee the head,
 *  straights and hooks are short elbows, the uppercut is a dirty-boxing uppercut. */
export const CLINCH_STRIKE_FOR: Readonly<Record<Strike, ClinchStrike>> = Object.freeze({
  jab: 'clinchKnee',
  cross: 'clinchElbow',
  hookL: 'clinchElbow',
  hookR: 'clinchElbow',
  uppercut: 'clinchUpper',
  bodyShot: 'clinchKnee',
  lowKick: 'clinchKnee',
  bodyKick: 'clinchKnee',
  headKick: 'clinchKneeHead',
});

const NEEDS: readonly Evade[] = ['left', 'right', 'back'];

/** The flick a contest asks for, as a screen arrow for this fighter (slip left = up, slip right = down, back = away). */
export function clinchArrow(need: Evade, facing: 1 | -1): GroundDir {
  if (need === 'left') return 'up';
  if (need === 'right') return 'down';
  return facing > 0 ? 'left' : 'right';
}

// ---- the grab ---------------------------------------------------------------------------------------------------

/** Can `side` start a grab right now (the caller checked the fighter is free and the round is on)? */
export function canGrab(f: Fight, side: Side): boolean {
  const s = f.state;
  const me = s.fighters[side];
  const them = s.fighters[opp(side)];
  if (s.clinch || s.takedown || me.clinchCooldown > 0) return false;
  if (them.action === 'knockdown' || them.action === 'downed' || them.action === 'getUp') return false;
  return Math.abs(them.x - me.x) <= CLINCH.grabRange;
}

export function startGrab(f: Fight, side: Side): void {
  const s = f.state;
  const me = s.fighters[side];
  clearMove(me);
  me.bufMove = null;
  me.bufEvade = null;
  me.bufTicks = 0;
  setAction(me, 'clinchEnter', CLINCH.enterStartup + CLINCH.enterRecovery, CLINCH.enterStartup);
  spend(f, side, costFor(f, side, CLINCH.enterCost));
  emit(f, { type: 'clinchAttempt', tick: s.tick, side });
}

/** One tick of a grab: close the distance, then try to tie them up. */
export function stepGrab(f: Fight, side: Side): void {
  const s = f.state;
  const me = s.fighters[side];
  const other = opp(side);
  const them = s.fighters[other];
  const dist = Math.abs(them.x - me.x);
  if (me.actionTick < CLINCH.enterStartup) {
    const step = muldiv(CLINCH.enterLunge, 1, CLINCH.enterStartup);
    me.x += me.facing * Math.min(step, Math.max(0, dist - CLINCH_GAP));
    return;
  }
  if (me.actionTick !== CLINCH.enterStartup || s.clinch || s.takedown) return;
  const swayed = them.action === 'swayBack' && them.actionTick <= 12;
  const busy = them.action === 'shoot' || them.action === 'knockdown' || them.action === 'downed' || them.action === 'getUp' || them.action === 'clinchEnter';
  if (dist > CLINCH.enterReach || swayed || busy) {
    missGrab(f, side);
    return;
  }
  const grab = (stat(f, side, 'wrestling') + stat(f, side, 'grappling')) >> 1;
  const def = (stat(f, other, 'wrestling') + stat(f, other, 'defense')) >> 1;
  let chance = 6000 + (grab - def) * 45;
  // a high guard does nothing against a grab; a wobbled or exhausted fighter is easy to tie up
  if (them.action === 'block' || them.action === 'blockHit' || them.coverTicks > 0) chance += 1500;
  if (them.stunTicks > 0) chance += 2000;
  if (them.gassed) chance += 800;
  // a fighter who just slipped is moving their head, not their hips: a little harder to catch
  if (them.action === 'slipL' || them.action === 'slipR') chance -= 800;
  chance = clampi(chance, 2000, 9500);
  if (rngInt(s, 10000) < chance) {
    beginClinch(f, side, 'grab');
    addSpecial(f, side, 400);
    return;
  }
  missGrab(f, side);
}

function missGrab(f: Fight, side: Side): void {
  const s = f.state;
  // shrugged off: the grabber is left reaching (the rest of the action's recovery)
  addSpecial(f, opp(side), 400);
  s.fighters[side].clinchCooldown = CLINCH.regrab;
  emit(f, { type: 'clinchMiss', tick: s.tick, side });
}

// ---- one tick in the clinch ----------------------------------------------------------------------------------------

/** Starts a strike for the standing code (sim.ts passes its startMove, which keeps this file free of sim.ts). */
export type StartMove = (f: Fight, side: Side, move: MoveId, chain: number) => void;

/** Everything in the clinch before the strikes resolve: contests, trips, the referee, then each fighter's intent. */
export function stepClinch(f: Fight, inputs: [FightInput, FightInput], startMove: StartMove): void {
  const s = f.state;
  const c = s.clinch;
  if (!c) return;
  c.tick++;
  c.idle++;
  const ctl = c.ctl;
  const held = opp(ctl);
  const wall = clinchPinned(f);
  if (wall && !c.wall) emit(f, { type: 'clinchWall', tick: s.tick, side: ctl });
  c.wall = wall;
  if (wall) {
    // pressed on the cage: control time for the judges, and leaning on someone is tiring for them
    roundStats(f, ctl).controlTicks++;
    spend(f, held, CLINCH.wallDrain);
  }
  if (c.contest) {
    stepContest(f, inputs);
    return;
  }
  if (c.trip) {
    stepTrip(f, inputs);
    if (!s.clinch || s.ground) return;
  }
  if (c.idle >= CLINCH.refIdle || c.tick >= CLINCH.refMax) {
    referee(f);
    return;
  }
  for (const i of [ctl, held] as const) {
    clinchIntent(f, i, inputs[i], startMove);
    if (!s.clinch || s.ground || s.result) return;
  }
}

/** After the strikes: walk them toward the cage and keep the pair together. */
export function holdClinch(f: Fight): void {
  const s = f.state;
  const c = s.clinch;
  if (!c) return;
  const held = s.fighters[opp(c.ctl)];
  let mid = (s.fighters[0].x + s.fighters[1].x) >> 1;
  if (!c.contest && !c.trip) mid -= held.facing * CLINCH.push;
  placeClinchPair(f, mid);
}

function isHold(me: FighterState): boolean {
  return me.action === 'clinchHold' || me.action === 'clinchHeld';
}

function clinchIntent(f: Fight, side: Side, input: FightInput, startMove: StartMove): void {
  const s = f.state;
  const c = s.clinch;
  if (!c) return;
  const me = s.fighters[side];
  const isCtl = side === c.ctl;

  if (input.strike) {
    me.bufMove = CLINCH_STRIKE_FOR[input.strike];
    me.bufEvade = null;
    me.bufTicks = 8;
  }
  // a flick pressed while a knee or an elbow is still finishing is remembered for a moment, like a dodge standing
  if (input.evade) {
    me.bufEvade = input.evade;
    me.bufMove = null;
    me.bufTicks = 18;
  }
  // combos work in the clinch too (a landed or blocked strike cancels into the next)
  if (me.move && me.bufMove && (me.moveResult === 1 || (me.moveResult === 2 && me.moveChain < 1))) {
    if (me.actionTick >= me.moveStartup + me.moveActive + CANCEL_AFTER && me.moveChain < CHAIN_MAX + 2) {
      startMove(f, side, me.bufMove, me.moveChain + 1);
      return;
    }
  }
  const free = isHold(me) || me.action === 'block' || me.action === 'stunned' || me.action === 'idle';
  if (!free) return;

  if (c.trip) {
    // fighting the trip: any flick, the grab or the takedown input (a swipe down) counts; a strike may stop it too
    if (!isCtl && c.trip.defendAt < 0 && (input.evade || input.shoot || input.clinch)) c.trip.defendAt = c.trip.tick;
    if (!isCtl && me.bufMove) startMove(f, side, me.bufMove, 0);
    return;
  }
  if (isCtl) {
    if (input.move === -1) {
      release(f);
      return;
    }
    if (input.shoot && me.clinchCooldown === 0 && c.tick >= CLINCH.tripSetup) {
      startTrip(f);
      return;
    }
  } else if (me.clinchCooldown === 0) {
    if (input.evade || me.bufEvade || input.move === -1 || input.clinch) {
      me.bufEvade = null;
      startContest(f, side, 'break');
      return;
    }
    if (input.shoot) {
      startContest(f, side, 'reverse');
      return;
    }
  }
  if (me.bufMove && isClinchStrike(me.bufMove)) {
    startMove(f, side, me.bufMove, 0);
    return;
  }
  if (input.block && me.guardBrokenTicks === 0) {
    if (me.action !== 'block') setAction(me, 'block', 0);
    spend(f, side, 3);
    return;
  }
  if (!isHold(me)) clinchHoldPose(f, side);
}

// ---- breaking it up ---------------------------------------------------------------------------------------------------

/** The fighter in control lets go. */
function release(f: Fight): void {
  const s = f.state;
  const c = s.clinch;
  if (!c) return;
  const ctlF = s.fighters[c.ctl];
  ctlF.clinchCooldown = CLINCH.regrab;
  endClinch(f, 'release');
  for (const me of s.fighters) clearMove(me);
  setAction(ctlF, 'clinchBreak', 14);
  setAction(s.fighters[opp(c.ctl)], 'clinchBreak', 14);
}

/** The referee separates a clinch nobody is working in. */
function referee(f: Fight): void {
  const s = f.state;
  endClinch(f, 'ref');
  for (const me of s.fighters) {
    clearMove(me);
    me.clinchCooldown = CLINCH.refRegrab;
    setAction(me, 'clinchBreak', 16);
  }
}

// ---- the position contest -----------------------------------------------------------------------------------------

function startContest(f: Fight, side: Side, purpose: ClinchPurpose): void {
  const s = f.state;
  const c = s.clinch;
  if (!c) return;
  const need = NEEDS[rngInt(s, 3)];
  c.contest = { initiator: side, purpose, need, tick: 0, window: CLINCH.contestWindow, arrive: [-1, -1], locked: [false, false] };
  c.idle = 0;
  spend(f, side, costFor(f, side, CLINCH.contestCost));
  for (const i of [0, 1] as const) {
    const me = s.fighters[i];
    clearMove(me);
    me.bufMove = null;
    me.bufTicks = 0;
    setAction(me, 'clinchPummel', 0);
    me.prompt = contestPrompt(need, me.facing, CLINCH.contestWindow, i === side);
  }
  emit(f, { type: 'clinchContest', tick: s.tick, side, purpose });
}

function contestPrompt(need: Evade, facing: 1 | -1, left: number, attacking: boolean): FighterPrompt {
  return { kind: 'clinch', dir: clinchArrow(need, facing), ticksLeft: left, window: CLINCH.contestWindow, attacking };
}

/** Ticks of handicap in a clinch contest: wrestlers and grapplers answer sooner, tired fighters later (~ -3 .. +10). */
function contestHandicap(f: Fight, side: Side): number {
  const h = muldiv(150 - stat(f, side, 'wrestling') - (stat(f, side, 'grappling') >> 1), 1, 14) - 3;
  return h + (f.state.fighters[side].stamina < 2500 ? 3 : 0);
}

function stepContest(f: Fight, inputs: [FightInput, FightInput]): void {
  const s = f.state;
  const c = s.clinch;
  const k = c?.contest;
  if (!c || !k) return;
  k.tick++;
  for (const i of [0, 1] as const) {
    const ev = inputs[i].evade;
    if (k.locked[i] || k.arrive[i] >= 0 || !ev) continue;
    if (ev === k.need) k.arrive[i] = Math.max(1, k.tick + contestHandicap(f, i));
    else k.locked[i] = true;
  }
  const left = k.window - k.tick;
  for (const me of s.fighters) if (me.prompt) me.prompt.ticksLeft = Math.max(0, left);
  const ini = k.initiator;
  const def = opp(ini);
  const doneI = k.locked[ini] || k.arrive[ini] >= 0;
  const doneD = k.locked[def] || k.arrive[def] >= 0;
  const iniWon = k.arrive[ini] >= 0 && !doneD && k.tick + 1 + contestHandicap(f, def) > k.arrive[ini];
  const defWon = k.arrive[def] >= 0 && !doneI && k.tick + 1 + contestHandicap(f, ini) >= k.arrive[def];
  if (left > 0 && !(doneI && doneD) && !iniWon && !defWon) return;

  const a = k.arrive[ini];
  const d = k.arrive[def];
  const success = a >= 0 && (d < 0 || a <= d);
  c.contest = null;
  for (const me of s.fighters) me.prompt = null;
  emit(f, { type: 'clinchContestEnd', tick: s.tick, side: ini, purpose: k.purpose, success });
  if (!success) {
    s.fighters[ini].clinchCooldown = CLINCH.contestCooldown;
    spend(f, ini, 400);
    addSpecial(f, def, 600);
    clinchHoldPose(f, 0);
    clinchHoldPose(f, 1);
    return;
  }
  if (k.purpose === 'reverse') {
    c.ctl = ini;
    c.idle = 0;
    c.wall = clinchPinned(f);
    addSpecial(f, ini, 600);
    clinchHoldPose(f, 0);
    clinchHoldPose(f, 1);
    emit(f, { type: 'clinchStart', tick: s.tick, side: ini, wall: c.wall, from: 'grab' });
    return;
  }
  // broke free: the escaper is ready a moment before the other
  const ctlSide = c.ctl;
  endClinch(f, 'escape');
  addSpecial(f, ini, 500);
  s.fighters[ctlSide].clinchCooldown = CLINCH.regrab;
  setAction(s.fighters[ini], 'clinchBreak', 12);
  setAction(s.fighters[ctlSide], 'clinchBreak', 20);
}

// ---- the trip -------------------------------------------------------------------------------------------------------

function startTrip(f: Fight): void {
  const s = f.state;
  const c = s.clinch;
  if (!c) return;
  const atk = c.ctl;
  const def = opp(atk);
  c.trip = { tick: 0, defendAt: -1 };
  c.idle = 0;
  const me = s.fighters[atk];
  clearMove(me);
  me.bufMove = null;
  setAction(me, 'clinchTrip', CLINCH.tripTicks + 2, CLINCH.tripTicks);
  spend(f, atk, costFor(f, atk, CLINCH.tripCost));
  roundStats(f, atk).tdAttempts++;
  me.prompt = { kind: 'sprawl', dir: null, ticksLeft: CLINCH.tripTicks, window: CLINCH.tripTicks, attacking: true };
  s.fighters[def].prompt = { kind: 'sprawl', dir: null, ticksLeft: CLINCH.tripTicks, window: CLINCH.tripTicks, attacking: false };
  emit(f, { type: 'clinchTrip', tick: s.tick, side: atk });
}

function stepTrip(f: Fight, inputs: [FightInput, FightInput]): void {
  void inputs;
  const s = f.state;
  const c = s.clinch;
  const tr = c?.trip;
  if (!c || !tr) return;
  const atk = c.ctl;
  const def = opp(atk);
  const atkF = s.fighters[atk];
  const defF = s.fighters[def];
  tr.tick++;
  const left = CLINCH.tripTicks - tr.tick;
  for (const me of s.fighters) if (me.prompt) me.prompt.ticksLeft = Math.max(0, left);
  // a strike landed on the tripper (their action changed): the trip is off, the clinch goes on
  if (atkF.action !== 'clinchTrip') {
    c.trip = null;
    atkF.prompt = null;
    defF.prompt = null;
    atkF.clinchCooldown = CLINCH.tripCooldown;
    emit(f, { type: 'clinchTripEnd', tick: s.tick, side: atk, success: false });
    return;
  }
  if (left > 0) return;
  // the cage is where trips work: pinned, there is nowhere to step to; in open space a trip is a gamble
  let chance =
    3600 +
    (stat(f, atk, 'wrestling') - stat(f, def, 'wrestling')) * 55 +
    (stat(f, atk, 'grappling') - stat(f, def, 'grappling')) * 15 +
    muldiv(atkF.stamina - defF.stamina, 1, 6) +
    (c.wall ? 2200 : 0) +
    (defF.stunTicks > 0 ? 1500 : 0);
  // fought it: the sooner the better (fought in time, a trip mostly fails)
  if (tr.defendAt >= 0) chance -= 4200 + (CLINCH.tripTicks - tr.defendAt) * 60;
  chance = clampi(chance, 700, 9000);
  c.trip = null;
  atkF.prompt = null;
  defF.prompt = null;
  if (rngInt(s, 10000) < chance) {
    emit(f, { type: 'clinchTripEnd', tick: s.tick, side: atk, success: true });
    endClinch(f, 'trip', false);
    completeTakedown(f, atk, false);
    return;
  }
  // stuffed: they come apart, the tripper off balance
  emit(f, { type: 'clinchTripEnd', tick: s.tick, side: atk, success: false });
  endClinch(f, 'trip');
  spend(f, atk, 500);
  addSpecial(f, def, 900);
  roundStats(f, def).defended++;
  atkF.clinchCooldown = CLINCH.regrab * 2;
  clearMove(atkF);
  clearMove(defF);
  setAction(atkF, 'clinchBreak', 30);
  setAction(defF, 'sprawl', 16);
}
