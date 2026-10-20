// The deterministic fight simulation: createFight / stepFight / snapshot / restore / hashState / drainEvents and the
// player's-eye FightView. Standing exchanges live here; takedowns and the ground in ground.ts. Integer maths only:
// the same seed and inputs give the same fight on every device (tests/fight-determinism.test.ts).

import {
  addSpecial,
  AFTERMATH_TICKS,
  applyZoneDamage,
  attackPm,
  clearMove,
  costFor,
  DEFAULT_RULES,
  emit,
  emptyRoundStats,
  endFight,
  type Fight,
  isFree,
  MIN_GAP,
  newFighter,
  opp,
  roundStats,
  setAction,
  SIM_VERSION,
  spend,
  START_X,
  startupPenalty,
  stat,
  toNeutral,
  WALL,
  walkSpeed,
} from './core';
import { enterGround, GROUND, pounce, standUp, startShoot, stepGround, stepShoot, stepTakedown } from './ground';
import { clampi, cloneData, hashValue, muldiv, rngInt, rngRange, seedRng } from './math';
import { CANCEL_AFTER, CHAIN_MAX, CHAIN_SPEEDUP, EVADE, evades, isSpecial, MOVES, SIGNATURE_BY_ARCHETYPE } from './moves';
import type {
  FightEvent,
  FighterSpec,
  FighterState,
  FighterView,
  FightInput,
  FightRules,
  FightSetup,
  FightState,
  FightView,
  HitStrength,
  MoveId,
  Side,
  Special,
} from './types';
import { METER_MAX } from './types';

export type { Fight } from './core';
export { DEFAULT_RULES, SIM_VERSION } from './core';

/** Ticks a buffered strike / evade waits for the fighter to be free. */
const BUFFER_TICKS = 8;
const KNOCKDOWN_ANIM = 42;
const GETUP_ANIM = 40;
const TAUNT_LENGTH = 60;
/** Unanswered strikes on a wobbled fighter before the referee steps in. */
const STANDING_TKO = 8;
/** A string of clean hits ends after this many ticks without one. */
const COMBO_GAP = 45;
/** Hit-stun per mille by the number of clean hits in the current string: long strings stop locking the target. */
const COMBO_STUN_PM = [1000, 1000, 1000, 820, 620, 480, 380];
/** After this many clean hits in a row the target shells up... */
const COVER_AFTER = 4;
/** ...for this long: punches land on the guard while they are not busy doing something else. */
const COVER_TICKS = 36;
/** Doubled over after a heavy body shot. */
const HURT_BODY_TICKS = 54;
/** hurtFlags bits. */
const HURT_BODY = 1;
const HURT_LEGS = 2;
const ROCKED = 4;

// ---- create -----------------------------------------------------------------------------------------------------

export function createFight(setup: FightSetup): Fight {
  const rules: FightRules = { ...DEFAULT_RULES, ...(setup.rules ?? {}) };
  if (setup.rules?.rounds === undefined && rules.title) rules.rounds = 5;
  const rng = { rng: seedRng(setup.seed) };
  const judges = [0, 1, 2].map(() => ({
    striking: rngRange(rng, 850, 1150),
    grappling: rngRange(rng, 850, 1150),
    nudge: rngRange(rng, -1, 1),
  }));
  const state: FightState = {
    v: SIM_VERSION,
    tick: 0,
    phase: rules.introTicks > 0 ? 'intro' : 'fight',
    phaseTick: 0,
    round: 1,
    clock: rules.roundTicks,
    rng: rng.rng,
    fighters: [newFighter(-START_X, 1), newFighter(START_X, -1)],
    ground: null,
    takedown: null,
    stats: [[emptyRoundStats(), emptyRoundStats()]],
    judges,
    result: null,
  };
  const f: Fight = { state, specs: [cloneData(setup.a), cloneData(setup.b)], rules, seed: setup.seed, events: [] };
  if (state.phase === 'intro') {
    setAction(state.fighters[0], 'walkout', 0);
    setAction(state.fighters[1], 'walkout', 0);
  } else {
    emit(f, { type: 'roundStart', tick: 0, round: 1 });
  }
  return f;
}

// ---- snapshot / hash / events ------------------------------------------------------------------------------------

export function snapshot(f: Fight): FightState {
  return cloneData(f.state);
}

export function restore(f: Fight, snap: FightState): void {
  f.state = cloneData(snap);
  f.events = [];
}

export function hashState(s: FightState): number {
  return hashValue(0x811c9dc5, s);
}

export function drainEvents(f: Fight): FightEvent[] {
  const e = f.events;
  f.events = [];
  return e;
}

/** The special this fighter throws when the meter is full. */
export function signatureOf(spec: FighterSpec): Special {
  return spec.signature ?? SIGNATURE_BY_ARCHETYPE[spec.archetype];
}

// ---- step ---------------------------------------------------------------------------------------------------------

export function stepFight(f: Fight, inputs: [FightInput, FightInput]): void {
  const s = f.state;
  s.tick++;
  s.phaseTick++;
  for (const me of s.fighters) me.actionTick++;

  switch (s.phase) {
    case 'intro':
      if (s.phaseTick >= f.rules.introTicks) startRound(f, false);
      return;
    case 'break':
      if (s.phaseTick >= f.rules.breakTicks) startRound(f, true);
      return;
    case 'ended':
      stepAftermath(f);
      return;
    case 'fight':
      break;
  }

  decay(f);
  if (s.ground) stepGround(f, inputs);
  else stepStanding(f, inputs);
  if (s.result) return;

  s.clock--;
  if (s.clock <= 0) endRound(f);
}

function startRound(f: Fight, next: boolean): void {
  const s = f.state;
  if (next) {
    s.round++;
    s.stats.push([emptyRoundStats(), emptyRoundStats()]);
  }
  s.phase = 'fight';
  s.phaseTick = 0;
  s.clock = f.rules.roundTicks;
  for (const me of s.fighters) toNeutral(me);
  emit(f, { type: 'roundStart', tick: s.tick, round: s.round });
}

function endRound(f: Fight): void {
  const s = f.state;
  emit(f, { type: 'roundEnd', tick: s.tick, round: s.round });
  if (s.ground) standUp(f, 'round');
  s.takedown = null;
  if (s.round >= f.rules.rounds) {
    endFight(f, null, 'DEC');
    return;
  }
  s.phase = 'break';
  s.phaseTick = 0;
  // back to the corners, and the corner work: partial recovery
  s.fighters[0].x = -START_X;
  s.fighters[1].x = START_X;
  for (const me of s.fighters) {
    toNeutral(me);
    me.prompt = null;
    me.stunTicks = 0;
    me.hurt = 0;
    me.downTicks = 0;
    me.unanswered = 0;
    me.counterTicks = 0;
    me.guardBrokenTicks = 0;
    me.comboHits = 0;
    me.comboTicks = 0;
    me.coverTicks = 0;
    me.sprawlReady = false;
    me.hurtFlags = 0;
    me.guard = METER_MAX;
    me.head = Math.max(0, me.head - 900);
    me.body = Math.max(0, me.body - 700);
    me.legs = Math.max(0, me.legs - 1100);
    me.staminaCap = Math.max(3000, METER_MAX - muldiv(me.body, 4, 10));
    me.stamina = Math.min(me.staminaCap, me.stamina + muldiv(me.staminaCap - me.stamina, 6, 10));
    if (me.stamina > 2500) me.gassed = false;
    me.bufMove = null;
    me.bufEvade = null;
    setAction(me, 'idle', 0);
  }
}

function stepAftermath(f: Fight): void {
  const s = f.state;
  const r = s.result;
  if (!r || s.phaseTick !== AFTERMATH_TICKS) return;
  // the finishing pose is over: everybody up, winner celebrates
  if (s.ground) {
    s.ground = null;
    const x = (s.fighters[0].x + s.fighters[1].x) >> 1;
    s.fighters[0].x = clampi(x - 500, -WALL, WALL);
    s.fighters[1].x = clampi(x + 500, -WALL, WALL);
  }
  for (const i of [0, 1] as const) {
    const me = s.fighters[i];
    me.prompt = null;
    if (r.method === 'KO' && r.winner !== i) {
      setAction(me, 'downed', 0);
      continue;
    }
    setAction(me, r.winner === null ? 'idle' : r.winner === i ? 'victory' : 'defeat', 0);
  }
}

/** Per-tick meters: stamina back, hurt fades, guard rebuilds, timers run down. */
function decay(f: Fight): void {
  const s = f.state;
  for (const i of [0, 1] as const) {
    const me = s.fighters[i];
    if (me.counterTicks > 0) me.counterTicks--;
    if (me.guardBrokenTicks > 0) me.guardBrokenTicks--;
    if (me.groundCooldown > 0) me.groundCooldown--;
    if (me.bufTicks > 0 && --me.bufTicks === 0) {
      me.bufMove = null;
      me.bufEvade = null;
    }
    if (me.comboTicks > 0 && --me.comboTicks === 0) me.comboHits = 0;
    if (me.coverTicks > 0) me.coverTicks--;
    if (me.stunTicks > 0) {
      me.stunTicks--;
      if (me.stunTicks === 0 && me.action === 'stunned') setAction(me, 'idle', 0);
      // came through being rocked on their feet
      if (me.stunTicks === 0 && me.hurtFlags & ROCKED) {
        me.hurtFlags &= ~ROCKED;
        if (!s.result) emit(f, { type: 'recover', tick: s.tick, side: i });
      }
    }
    me.hurt = Math.max(0, me.hurt - (me.stunTicks > 0 ? 6 : 14));
    if (me.action !== 'block' && me.action !== 'blockHit') me.guard = Math.min(METER_MAX, me.guard + 22);
    // stamina regeneration by what the fighter is doing
    let regen = 0;
    switch (me.action) {
      case 'idle':
      case 'stunned':
      case 'gndGuardTop':
      case 'gndMountTop':
        regen = 26;
        break;
      case 'walkFwd':
      case 'walkBack':
        regen = 18;
        break;
      case 'block':
      case 'gndGuardBottom':
      case 'gndMountBottom':
        regen = 10;
        break;
      default:
        regen = 0;
    }
    if (regen > 0) {
      regen += stat(f, i, 'cardio') >> 3;
      me.stamina = Math.min(me.staminaCap, me.stamina + regen);
    }
    if (me.gassed && me.stamina > 2500) me.gassed = false;
  }
}

// ---- standing ---------------------------------------------------------------------------------------------------

function stepStanding(f: Fight, inputs: [FightInput, FightInput]): void {
  const s = f.state;

  if (s.takedown) {
    stepTakedown(f, inputs);
    if (s.ground || s.result) return;
  }

  for (const i of [0, 1] as const) stepFighterIntent(f, i, inputs[i]);
  if (s.ground || s.result) return;

  for (const i of [0, 1] as const) {
    if (s.fighters[i].action === 'shoot' && !s.takedown) stepShoot(f, i);
    if (s.ground || s.result) return;
  }

  // attacks: lunge, then resolve both sides against the same moment (trades are possible)
  for (const i of [0, 1] as const) lunge(f, i);
  // both checks see the same moment; then both apply, so a trade hurts both fighters
  const pending: { side: Side; outcome: Outcome; move: MoveId; chain: number }[] = [];
  for (const i of [0, 1] as const) {
    const o = checkAttack(f, i);
    const me = s.fighters[i];
    if (o && me.move) pending.push({ side: i, outcome: o, move: me.move, chain: me.moveChain });
  }
  for (const p of pending) applyOutcome(f, p.side, p.outcome, p.move, p.chain);
  if (s.result || s.ground) return;

  for (const i of [0, 1] as const) endActions(f, i);
  separate(f);
}

/** Read the input: buffer it, then start whatever the fighter is free to start. */
function stepFighterIntent(f: Fight, side: Side, input: FightInput): void {
  const s = f.state;
  const me = s.fighters[side];
  const them = s.fighters[opp(side)];
  const spec = f.specs[side];

  // knocked down: tap to get up sooner
  if (me.action === 'downed') {
    if (input.tap || input.strike) me.downTicks = Math.max(0, me.downTicks - 5);
    if (me.prompt) me.prompt.ticksLeft = me.downTicks;
    if (--me.downTicks <= 0) {
      me.prompt = null;
      setAction(me, 'getUp', GETUP_ANIM);
      emit(f, { type: 'getUp', tick: s.tick, side });
    }
    return;
  }
  if (s.takedown) return;

  // finish a downed opponent: jump on them
  if (them.action === 'downed' || (them.action === 'knockdown' && them.actionTick > 20)) {
    if ((input.shoot || input.strike || input.tap) && Math.abs(them.x - me.x) <= GROUND.pounceReach && (isFree(me) || me.action === 'victory')) {
      pounce(f, side);
      return;
    }
  }

  // buffer the press
  if (input.evade) {
    me.bufEvade = input.evade;
    me.bufMove = null;
    me.bufTicks = BUFFER_TICKS;
  } else if (input.special && me.special >= METER_MAX) {
    me.bufMove = signatureOf(spec);
    me.bufEvade = null;
    me.bufTicks = BUFFER_TICKS;
  } else if (input.strike) {
    me.bufMove = input.strike;
    me.bufEvade = null;
    me.bufTicks = BUFFER_TICKS;
  }

  // cancel a landed or blocked strike's recovery into the next strike of the combo
  // a blocked strike can be followed up once; after that the full recovery has to be paid (the defender's turn)
  if (me.move && me.bufMove && !isSpecial(me.bufMove) && (me.moveResult === 1 || (me.moveResult === 2 && me.moveChain < 1))) {
    const recStart = me.moveStartup + me.moveActive;
    if (me.actionTick >= recStart + CANCEL_AFTER && me.moveChain < CHAIN_MAX + 2) {
      const next = me.bufMove;
      startMove(f, side, next, me.moveChain + 1);
      return;
    }
  }

  if (!isFree(me)) return;

  if (me.bufEvade) {
    startEvade(f, side, me.bufEvade);
    return;
  }
  if (me.bufMove) {
    startMove(f, side, me.bufMove, 0);
    return;
  }
  if (input.shoot && s.phase === 'fight') {
    // their shot is already coming: this is a sprawl, not a shot of our own
    if (them.action === 'shoot' && them.actionTick < GROUND.shootStartup) {
      me.sprawlReady = true;
      return;
    }
    startShoot(f, side);
    return;
  }
  if (input.taunt) {
    clearMove(me);
    setAction(me, 'taunt', TAUNT_LENGTH);
    emit(f, { type: 'taunt', tick: s.tick, side });
    return;
  }
  if (input.block && me.guardBrokenTicks === 0) {
    if (me.action !== 'block') setAction(me, 'block', 0);
    spend(f, side, 3);
    return;
  }
  if (input.move !== 0) {
    walk(f, side, input.move);
    return;
  }
  const rest = me.stunTicks > 0 ? 'stunned' : 'idle';
  if (me.action !== rest) setAction(me, rest, 0);
}

function walk(f: Fight, side: Side, dir: -1 | 1): void {
  const s = f.state;
  const me = s.fighters[side];
  const action = dir > 0 ? 'walkFwd' : 'walkBack';
  if (me.action !== action) setAction(me, action, 0);
  const v = walkSpeed(f, side) - (dir < 0 ? 3 : 0);
  me.x = clampi(me.x + me.facing * dir * v, -WALL, WALL);
}

function startEvade(f: Fight, side: Side, evade: 'left' | 'right' | 'back'): void {
  const me = f.state.fighters[side];
  me.bufEvade = null;
  me.bufMove = null;
  me.bufTicks = 0;
  clearMove(me);
  if (evade === 'back') setAction(me, 'swayBack', EVADE.swayLength);
  else setAction(me, evade === 'left' ? 'slipL' : 'slipR', EVADE.slipLength);
  spend(f, side, costFor(f, side, EVADE.cost));
}

function startMove(f: Fight, side: Side, move: MoveId, chain: number): void {
  const s = f.state;
  const me = s.fighters[side];
  const d = MOVES[move];
  me.bufMove = null;
  me.bufEvade = null;
  me.bufTicks = 0;
  const counterWindow = me.counterTicks > 0;
  clearMove(me);
  if (isSpecial(move)) {
    me.special = 0;
    emit(f, { type: 'special', tick: s.tick, side, move });
  }
  const speedup = Math.min(chain, CHAIN_MAX) * CHAIN_SPEEDUP;
  const startup = Math.max(4, d.startup + startupPenalty(f, side, move) - speedup);
  me.move = move;
  me.moveStartup = startup;
  me.moveActive = d.active;
  me.moveRecovery = d.recovery + (me.gassed ? 4 : 0);
  me.moveResult = 0;
  me.moveCounter = counterWindow;
  me.moveChain = chain;
  me.moveLunge = d.lunge;
  if (counterWindow) me.counterTicks = 0;
  setAction(me, move, startup + d.active + me.moveRecovery, startup);
  spend(f, side, costFor(f, side, d.cost));
  roundStats(f, side).thrown++;
  emit(f, { type: 'strike', tick: s.tick, side, move, chain });
}

/** Travel forward during an attack's startup, never into the other fighter. */
function lunge(f: Fight, side: Side): void {
  const s = f.state;
  const me = s.fighters[side];
  if (!me.move || me.actionTick >= me.moveStartup || me.moveLunge <= 0) return;
  const them = s.fighters[opp(side)];
  const left = me.moveStartup - me.actionTick;
  const step = Math.max(1, muldiv(me.moveLunge, 1, Math.max(1, left)));
  const room = Math.max(0, Math.abs(them.x - me.x) - MIN_GAP);
  const d = Math.min(step, room, me.moveLunge);
  me.x = clampi(me.x + me.facing * d, -WALL, WALL);
  me.moveLunge -= step;
}

type Outcome =
  | { kind: 'hit'; counter: boolean; window: boolean }
  | { kind: 'block' }
  | { kind: 'evade'; perfect: boolean }
  | { kind: 'whiff' };

/** Does this side's attack connect this tick? Only during active frames, once. */
function checkAttack(f: Fight, side: Side): Outcome | null {
  const s = f.state;
  const me = s.fighters[side];
  if (!me.move || me.moveResult !== 0) return null;
  const t = me.actionTick;
  const activeStart = me.moveStartup;
  const activeEnd = me.moveStartup + me.moveActive - 1;
  if (t < activeStart) return null;
  const d = MOVES[me.move];
  const them = s.fighters[opp(side)];
  const dist = Math.abs(them.x - me.x);
  const downedish = them.action === 'knockdown' || them.action === 'downed' || them.action === 'getUp' || them.action === 'shoot';
  if (dist > d.reach || (downedish && them.action !== 'shoot')) {
    return t >= activeEnd ? { kind: 'whiff' } : null;
  }
  // evasions
  if (them.action === 'slipL' || them.action === 'slipR' || them.action === 'swayBack') {
    const ev = them.action === 'slipL' ? 'left' : them.action === 'slipR' ? 'right' : 'back';
    if (them.actionTick >= EVADE.from && them.actionTick <= EVADE.to && evades(ev, me.move)) {
      return { kind: 'evade', perfect: them.actionTick <= EVADE.perfectTo };
    }
  }
  // blocks
  // shelled up after a long string: the guard is there unless they are busy attacking, dodging or wobbling
  const covered = them.coverTicks > 0 && them.stunTicks === 0 && them.move === null && them.action !== 'slipL' && them.action !== 'slipR' && them.action !== 'swayBack' && them.action !== 'hurtBody';
  const guarding = (them.action === 'block' || them.action === 'blockHit' || covered) && them.guardBrokenTicks === 0;
  if (guarding && d.blockable) return { kind: 'block' };
  // caught: they were winding up their own attack, walking into it, or showboating
  const caught = (them.move !== null && them.actionTick < them.moveStartup) || them.action === 'walkFwd' || them.action === 'taunt';
  return { kind: 'hit', counter: me.moveCounter || caught, window: me.moveCounter };
}

function strengthOf(dmg: number): HitStrength {
  return dmg >= 1000 ? 'heavy' : dmg >= 500 ? 'medium' : 'light';
}

function applyOutcome(f: Fight, side: Side, o: Outcome, move: MoveId, chain: number): void {
  const s = f.state;
  const me = s.fighters[side];
  const d = MOVES[move];
  const other = opp(side);
  const them = s.fighters[other];

  switch (o.kind) {
    case 'whiff':
      me.moveResult = 4;
      me.moveRecovery += 4;
      me.actionLength += 4;
      emit(f, { type: 'miss', tick: s.tick, side, move });
      return;
    case 'evade':
      me.moveResult = 3;
      me.moveRecovery += 6;
      me.actionLength += 6;
      roundStats(f, other).defended++;
      if (o.perfect) {
        them.counterTicks = EVADE.counterWindow;
        addSpecial(f, other, 700);
      }
      emit(f, { type: 'evade', tick: s.tick, side: other, move, perfect: o.perfect });
      return;
    case 'block': {
      me.moveResult = 2;
      // a blocked strike leaves the attacker a little late: the defender gets the next move
      me.moveRecovery += 3;
      me.actionLength += 3;
      let dmg = muldiv(d.dmg, attackPm(f, side, move), 1000);
      const chip = muldiv(dmg, them.stunTicks > 0 ? d.chip * 2 : d.chip, 1000);
      them.guard -= muldiv(dmg, them.stunTicks > 0 ? 22 : 11, 10);
      spend(f, other, dmg >> 2);
      const applied = chip > 0 ? applyZoneDamage(f, other, d.zone, chip) : 0;
      dmg = applied;
      roundStats(f, other).defended++;
      addSpecial(f, side, muldiv(d.dmg, 3, 10));
      addSpecial(f, other, muldiv(d.dmg, 2, 10));
      clearMove(them);
      setAction(them, 'blockHit', d.blockstun);
      pushBack(f, other, 40);
      emit(f, { type: 'hit', tick: s.tick, side, move, zone: d.zone, dmg, strength: strengthOf(applied), counter: false, blocked: true, chain });
      if (them.guard <= 0) {
        them.guard = 0;
        them.guardBrokenTicks = 90;
        setAction(them, 'stunned', 0);
        them.stunTicks = Math.max(them.stunTicks, 40);
        emit(f, { type: 'guardBreak', tick: s.tick, side: other });
      }
      return;
    }
    case 'hit':
      landHit(f, side, move, o.counter, o.window, chain);
      return;
  }
}

function landHit(f: Fight, side: Side, move: MoveId, counter: boolean, window: boolean, chain: number): void {
  const s = f.state;
  const me = s.fighters[side];
  const other = opp(side);
  const them = s.fighters[other];
  const d = MOVES[move];
  me.moveResult = 1;

  let dmg = muldiv(d.dmg, attackPm(f, side, move), 1000);
  if (counter) dmg = muldiv(dmg, window ? 16 : 14, 10);
  dmg = muldiv(dmg, 100 + Math.min(chain, CHAIN_MAX) * 5, 100);
  // defense: a sharp defender rolls with shots (half damage), a wobbled one cannot
  if (them.stunTicks === 0 && !counter) {
    const glance = clampi(900 + stat(f, other, 'defense') * 38 - stat(f, side, d.skill) * 22, 300, 4200);
    if (rngInt(s, 10000) < glance) dmg = dmg >> 1;
  }
  const strength = strengthOf(dmg);
  const applied = applyZoneDamage(f, other, d.zone, dmg);

  const rs = roundStats(f, side);
  rs.landed++;
  if (move !== 'jab') rs.power++;
  if (d.zone === 'head') rs.headDmg += applied;
  else if (d.zone === 'body') rs.bodyDmg += applied;
  else rs.legDmg += applied;
  addSpecial(f, side, muldiv(applied, 9, 10));
  addSpecial(f, other, muldiv(applied, 3, 10));
  me.unanswered = 0;
  if (counter) emit(f, { type: 'counter', tick: s.tick, side, move });
  emit(f, { type: 'hit', tick: s.tick, side, move, zone: d.zone, dmg: applied, strength, counter, blocked: false, chain });

  // the target's reaction
  const wasStunned = them.stunTicks > 0;
  clearMove(them);
  // a string of clean hits: the first few lock the target in place, after that the hit reactions get shorter
  them.comboHits = them.comboTicks > 0 ? them.comboHits + 1 : 1;
  them.comboTicks = COMBO_GAP;
  let stun = d.hitstun + (strength === 'heavy' ? 8 : 0);
  stun = muldiv(stun, COMBO_STUN_PM[Math.min(them.comboHits, COMBO_STUN_PM.length - 1)], 1000);
  // an exhausted fighter's punches have nothing behind them
  if (me.gassed) stun = muldiv(stun, 6, 10);
  stun = Math.max(6, stun);
  if (d.zone === 'head') {
    const heavy = strength === 'heavy' || isSpecial(move);
    setAction(them, heavy ? 'hitHeadHeavy' : move === 'hookL' || move === 'jab' ? 'hitHeadR' : 'hitHeadL', stun);
  } else if (d.zone === 'body') setAction(them, 'hitBody', stun);
  else setAction(them, 'hitLeg', stun);
  pushBack(f, other, strength === 'heavy' ? 150 : strength === 'medium' ? 90 : 50);
  if (wasStunned) them.unanswered++;
  // shell up after a long string (not while rocked: that is when a fighter can be finished)
  if (them.comboHits === COVER_AFTER && !wasStunned) {
    them.coverTicks = COVER_TICKS;
    emit(f, { type: 'cover', tick: s.tick, side: other });
  }

  // what the hit does beyond damage: rocked, hurt, knockdown, the referee
  if (d.zone === 'head') {
    if (wasStunned && (strength === 'heavy' || them.hurt >= METER_MAX)) {
      knockdown(f, other, move, counter);
      return;
    }
    // a huge clean shot can drop anyone
    if (applied >= 1200) {
      const chance = muldiv(applied - 1100, 3, 1) + muldiv(them.head, 1, 6) + (counter ? 900 : 0) - 600;
      if (rngInt(s, 10000) < chance) {
        knockdown(f, other, move, counter);
        return;
      }
    }
    if (!wasStunned) {
      // rocked: built-up damage (hurt) or one clean heavy shot on the button
      let rock = them.hurt >= METER_MAX;
      if (!rock && applied >= 600 && (strength === 'heavy' || counter)) {
        const chance = clampi((applied - 500) * 3 + muldiv(them.head, 1, 5) + (counter ? 1200 : 0) - (stat(f, other, 'chin') - 50) * 40, 0, 6500);
        rock = rngInt(s, 10000) < chance;
      }
      if (rock) {
        them.stunTicks = 120 + muldiv(them.head, 1, 100);
        them.hurt = 6000;
        them.hurtFlags |= ROCKED;
        them.coverTicks = 0;
        // the hit reaction plays out, then the wobble (toNeutral)
        emit(f, { type: 'stun', tick: s.tick, side: other });
      }
    }
  } else if (d.zone === 'legs') {
    if (them.legs >= METER_MAX) {
      // the first time the leg gives out they go down; the second time the referee has seen enough
      if (them.legKnockdowns >= 1) {
        endFight(f, side, 'TKO', { by: move, stoppage: 'legs' });
        return;
      }
      them.legKnockdowns++;
      them.legs = 6500;
      knockdown(f, other, move, false, true);
      return;
    }
    // the leg is going: they limp (slower) from here on
    if (them.legs >= 6000 && !(them.hurtFlags & HURT_LEGS)) {
      them.hurtFlags |= HURT_LEGS;
      emit(f, { type: 'hurt', tick: s.tick, side: other, zone: 'legs' });
    }
  } else if (d.zone === 'body') {
    if (them.body >= 9000 && strength === 'heavy') {
      knockdown(f, other, move, counter);
      return;
    }
    // a heavy shot to a worn body: doubled over, wide open, the air gone
    if (them.body >= 5500 && (applied >= 650 || counter) && !(them.hurtFlags & HURT_BODY)) {
      them.hurtFlags |= HURT_BODY;
      them.coverTicks = 0;
      setAction(them, 'hurtBody', HURT_BODY_TICKS);
      spend(f, other, 1500);
      emit(f, { type: 'hurt', tick: s.tick, side: other, zone: 'body' });
    }
  }

  if (them.unanswered >= STANDING_TKO) endFight(f, side, 'TKO', { by: move, stoppage: d.zone === 'body' ? 'body' : 'strikes' });
}

function knockdown(f: Fight, side: Side, by: MoveId, counter: boolean, legs = false): void {
  const s = f.state;
  const me = s.fighters[side];
  const attacker = opp(side);
  me.knockdowns++;
  roundStats(f, attacker).knockdowns++;
  const severity = muldiv(me.head, 1, 100) + me.knockdowns * 16 + (counter ? 15 : 0) + rngInt(s, 25);
  clearMove(me);
  me.stunTicks = 0;
  me.prompt = null;
  emit(f, { type: 'knockdown', tick: s.tick, side, by, severity });
  setAction(me, 'knockdown', KNOCKDOWN_ANIM);
  // a leg giving out is never a knockout: they go down, and get up hurt
  if (severity >= 100 && !legs) {
    endFight(f, attacker, 'KO', { by });
    return;
  }
  if (me.knockdowns >= 3) {
    endFight(f, attacker, 'TKO', { by, stoppage: 'strikes' });
    return;
  }
  me.hurt = 7500;
  me.downTicks = 70 + severity * 2;
  me.unanswered = 0;
  addSpecial(f, attacker, 2000);
}

function pushBack(f: Fight, side: Side, mm: number): void {
  const me = f.state.fighters[side];
  me.x = clampi(me.x - me.facing * mm, -WALL, WALL);
}

/** Actions that ran their length go back to neutral (or on to the next stage). */
function endActions(f: Fight, side: Side): void {
  const s = f.state;
  const me = s.fighters[side];
  if (me.actionLength === 0 || me.actionTick < me.actionLength) return;
  switch (me.action) {
    case 'knockdown':
      if (s.result) return;
      setAction(me, 'downed', 0);
      me.prompt = { kind: 'getUp', dir: null, ticksLeft: me.downTicks, window: me.downTicks, attacking: false };
      return;
    case 'getUp':
      me.stunTicks = Math.max(me.stunTicks, 60);
      toNeutral(me);
      return;
    case 'taunt':
      addSpecial(f, side, 1800);
      toNeutral(me);
      return;
    case 'shoot':
      if (s.takedown) return;
      toNeutral(me);
      return;
    default:
      if (me.action === 'downed') return;
      toNeutral(me);
  }
}

/** Keep the fighters apart (fighter 0 always on the left) and inside the cage. */
function separate(f: Fight): void {
  const [a, b] = f.state.fighters;
  if (b.x - a.x < MIN_GAP) {
    const push = MIN_GAP - (b.x - a.x);
    a.x -= push >> 1;
    b.x += push - (push >> 1);
    if (a.x < -WALL) {
      b.x += -WALL - a.x;
      a.x = -WALL;
    }
    if (b.x > WALL) {
      a.x -= b.x - WALL;
      b.x = WALL;
    }
  }
  a.x = clampi(a.x, -WALL, WALL);
  b.x = clampi(b.x, -WALL, WALL);
}

// ---- what a player sees -----------------------------------------------------------------------------------------

function fighterView(me: FighterState): FighterView {
  return {
    x: me.x,
    action: me.action,
    actionTick: me.actionTick,
    actionLength: me.actionLength,
    actionImpact: me.actionImpact,
    stamina: me.stamina,
    staminaCap: me.staminaCap,
    head: me.head,
    body: me.body,
    legs: me.legs,
    hurt: me.hurt,
    stunned: me.stunTicks > 0,
    guard: me.guard,
    guardBroken: me.guardBrokenTicks > 0,
    special: me.special,
    gassed: me.gassed,
    downed: me.action === 'downed' || me.action === 'knockdown',
    counter: me.counterTicks > 0,
    prompt: me.prompt,
  };
}

export function viewFor(f: Fight, side: Side): FightView {
  const s = f.state;
  const me = s.fighters[side];
  const them = s.fighters[opp(side)];
  const g = s.ground;
  return {
    tick: s.tick,
    phase: s.phase,
    round: s.round,
    rounds: f.rules.rounds,
    clock: s.clock,
    side,
    me: fighterView(me),
    opp: fighterView(them),
    mySpec: f.specs[side],
    oppSpec: f.specs[opp(side)],
    dist: Math.abs(them.x - me.x),
    myRoom: WALL - me.x * me.facing,
    oppRoom: WALL - them.x * them.facing,
    ground: g
      ? {
          pos: g.pos,
          meTop: g.top === side,
          scramble: g.scramble
            ? { purpose: g.scramble.purpose, dir: g.scramble.dir, mine: g.scramble.initiator === side, ticksLeft: g.scramble.window - g.scramble.tick }
            : null,
          sub: g.sub ? { kind: g.sub.kind, mine: g.sub.atk === side, progress: g.sub.progress } : null,
        }
      : null,
    takedown: s.takedown ? { mine: s.takedown.atk === side, ticksLeft: s.takedown.window - s.takedown.tick } : null,
    result: s.result,
  };
}

// test hooks (not for game code)
export const __test = { enterGround, knockdown };
