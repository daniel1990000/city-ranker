// Takedowns and the ground game: the shot and the sprawl window, guard and mount, ground-and-pound, direction
// scrambles (advance, escape, stand up) and the submission tug-of-war. Integer maths only.

import {
  addSpecial,
  applyZoneDamage,
  attackPm,
  clearMove,
  costFor,
  emit,
  endFight,
  type Fight,
  MIN_GAP,
  opp,
  roundStats,
  setAction,
  spend,
  stat,
  WALL,
} from './core';
import { clampi, muldiv, rngInt } from './math';
import { MOVES } from './moves';
import type { FightInput, GroundDir, GroundPos, ScramblePurpose, Side, SubKind } from './types';
import { METER_MAX } from './types';

// ---- tuning -----------------------------------------------------------------------------------------------------

export const GROUND = {
  shootStartup: 14,
  shootReach: 1500,
  shootLunge: 600,
  shootCost: 1100,
  sprawlWindow: 30,
  sprawlRecovery: 36,
  stuffedRecovery: 44,
  takedownAnim: 40,
  poundLength: 22,
  poundImpact: 9,
  poundDmg: 520,
  poundCost: 260,
  poundBlockedPm: 250,
  scrambleWindow: 60,
  scrambleCooldown: 90,
  scrambleCost: 450,
  advanceAnim: 30,
  escapeAnim: 30,
  standAnim: 36,
  subStart: 4500,
  subCost: 900,
  subTapCost: 30,
  subTimeLimit: 600,
  /** Ticks without progress before the referee stands them up. */
  refIdle: 480,
  /** Longest stay on the ground before the referee stands them up anyway (20 s): nobody is held down forever. */
  refMax: 1200,
  /** Unanswered ground strikes on a hurt fighter before the referee stops it. */
  groundTko: 7,
  pounceReach: 1500,
} as const;

const DIRS: readonly GroundDir[] = ['up', 'down', 'left', 'right'];

// ---- the shot -----------------------------------------------------------------------------------------------------

/** Start a takedown shot (the caller checked the fighter is free and the round is on). */
export function startShoot(f: Fight, side: Side): void {
  const s = f.state;
  const me = s.fighters[side];
  clearMove(me);
  setAction(me, 'shoot', GROUND.shootStartup + GROUND.sprawlWindow);
  spend(f, side, costFor(f, side, GROUND.shootCost));
  roundStats(f, side).tdAttempts++;
  emit(f, { type: 'shoot', tick: s.tick, side });
}

/** One tick of a shot that has not made contact yet. Returns true while the shot owns the fighter. */
export function stepShoot(f: Fight, side: Side): void {
  const s = f.state;
  const me = s.fighters[side];
  const other = opp(side);
  const them = s.fighters[other];
  const dist = Math.abs(them.x - me.x);
  if (me.actionTick < GROUND.shootStartup) {
    // drive in: lunge toward them, never through them
    const step = muldiv(GROUND.shootLunge, 1, GROUND.shootStartup);
    const room = Math.max(0, dist - MIN_GAP + 120);
    me.x += me.facing * Math.min(step, room);
    return;
  }
  if (me.actionTick !== GROUND.shootStartup || s.takedown) return;
  // contact frame
  // a kick still in the air can be caught (not every time: some fighters pull it back in time)
  const kicking =
    them.move !== null &&
    (MOVES[them.move].kind === 'kick' || MOVES[them.move].kind === 'lowKick') &&
    them.actionTick < them.moveStartup + them.moveActive &&
    rngInt(s, 10000) < 3500 + (stat(f, side, 'wrestling') - stat(f, other, 'kicking')) * 40;
  if (dist > GROUND.shootReach || them.action === 'swayBack' || them.action === 'knockdown' || them.action === 'downed') {
    them.sprawlReady = false;
    // missed: they were out of range or stepped away; the shooter is left on their knees
    setAction(me, 'getUp', GROUND.stuffedRecovery);
    emit(f, { type: 'sprawl', tick: s.tick, side: other, success: true });
    return;
  }
  if (kicking) {
    them.sprawlReady = false;
    // caught a kick: straight to the mat
    completeTakedown(f, side, true);
    return;
  }
  // a sprawl pressed while the shot was still coming in counts as the earliest possible one
  s.takedown = { atk: side, tick: 0, window: GROUND.sprawlWindow, sprawlAt: them.sprawlReady ? 0 : -1, caughtKick: false };
  them.sprawlReady = false;
  them.prompt = { kind: 'sprawl', dir: null, ticksLeft: GROUND.sprawlWindow, window: GROUND.sprawlWindow, attacking: false };
  me.prompt = { kind: 'sprawl', dir: null, ticksLeft: GROUND.sprawlWindow, window: GROUND.sprawlWindow, attacking: true };
  // the defender is stuck reacting: whatever they were doing is cancelled
  clearMove(them);
  if (them.action !== 'stunned') setAction(them, 'idle', 0);
}

/** One tick of the sprawl window. */
export function stepTakedown(f: Fight, inputs: [FightInput, FightInput]): void {
  const s = f.state;
  const td = s.takedown;
  if (!td) return;
  const def = opp(td.atk);
  const defF = s.fighters[def];
  const atkF = s.fighters[td.atk];
  td.tick++;
  if (td.sprawlAt < 0 && inputs[def].shoot) td.sprawlAt = td.tick;
  const left = td.window - td.tick;
  if (defF.prompt) defF.prompt.ticksLeft = Math.max(0, left);
  if (atkF.prompt) atkF.prompt.ticksLeft = Math.max(0, left);
  if (left > 0 && td.sprawlAt < 0) return;
  // resolve: a pressed sprawl is a real contest, an unanswered shot mostly gets in
  const wr = stat(f, def, 'wrestling') - stat(f, td.atk, 'wrestling');
  let chance: number;
  if (td.sprawlAt >= 0) {
    const early = td.window - td.sprawlAt; // ticks to spare
    chance = 5250 + wr * 50 + (stat(f, def, 'defense') - 50) * 20 + muldiv(defF.stamina - atkF.stamina, 1, 6) + early * 35;
    chance = clampi(chance, 900, 9300);
  } else {
    chance = clampi(2600 + wr * 40 + (stat(f, def, 'defense') - 50) * 20, 600, 5000);
  }
  s.takedown = null;
  defF.prompt = null;
  atkF.prompt = null;
  if (rngInt(s, 10000) < chance) {
    // stuffed
    setAction(defF, 'sprawl', GROUND.sprawlRecovery);
    setAction(atkF, 'getUp', GROUND.stuffedRecovery);
    spend(f, td.atk, 600);
    roundStats(f, def).defended++;
    addSpecial(f, def, 900);
    emit(f, { type: 'sprawl', tick: s.tick, side: def, success: true });
    // pushed apart
    const gap = MIN_GAP + 260;
    const mid = (atkF.x + defF.x) >> 1;
    s.fighters[0].x = clampi(mid - (gap >> 1), -WALL, WALL);
    s.fighters[1].x = clampi(mid + (gap >> 1), -WALL, WALL);
    return;
  }
  if (td.sprawlAt >= 0) emit(f, { type: 'sprawl', tick: s.tick, side: def, success: false });
  completeTakedown(f, td.atk, false);
}

function completeTakedown(f: Fight, atk: Side, caughtKick: boolean): void {
  const s = f.state;
  roundStats(f, atk).takedowns++;
  addSpecial(f, atk, 1200);
  emit(f, { type: 'takedown', tick: s.tick, side: atk, caughtKick });
  enterGround(f, atk, 'guard');
  setAction(s.fighters[atk], 'takedownTop', GROUND.takedownAnim);
  setAction(s.fighters[opp(atk)], 'takedownBottom', GROUND.takedownAnim);
  // landing hurts a little
  applyZoneDamage(f, opp(atk), 'body', 350);
}

/** Put both fighters on the ground, `top` on top, at a shared anchor. */
export function enterGround(f: Fight, top: Side, pos: GroundPos): void {
  const s = f.state;
  const a = s.fighters[0];
  const b = s.fighters[1];
  const x = clampi((a.x + b.x) >> 1, -WALL + 700, WALL - 700);
  for (const me of s.fighters) {
    clearMove(me);
    me.x = x;
    me.prompt = null;
    me.bufMove = null;
    me.bufEvade = null;
    me.stunTicks = 0;
    me.downTicks = 0;
  }
  s.takedown = null;
  s.ground = { pos, top, x, dir: s.fighters[top].facing, tick: 0, idle: 0, scramble: null, sub: null };
  holdPose(f);
  emit(f, { type: 'position', tick: s.tick, pos, top });
}

/** Jump on a knocked-down opponent: straight to mount. */
export function pounce(f: Fight, side: Side): void {
  const s = f.state;
  const bottom = s.fighters[opp(side)];
  const unanswered = bottom.unanswered;
  const hurt = bottom.hurt;
  enterGround(f, side, 'mount');
  // still dazed from the knockdown: keep the referee's count running
  bottom.unanswered = unanswered;
  bottom.hurt = Math.max(hurt, 8000);
  emit(f, { type: 'pounce', tick: s.tick, side });
}

/** Both fighters back on their feet, fighter 0 on the left. */
export function standUp(f: Fight, reason: 'ref' | 'scramble' | 'subEscape' | 'round'): void {
  const s = f.state;
  const g = s.ground;
  const x = g ? g.x : (s.fighters[0].x + s.fighters[1].x) >> 1;
  s.ground = null;
  const half = (MIN_GAP >> 1) + 260;
  s.fighters[0].x = clampi(x - half, -WALL, WALL - MIN_GAP);
  s.fighters[1].x = clampi(x + half, -WALL + MIN_GAP, WALL);
  for (const me of s.fighters) {
    clearMove(me);
    me.prompt = null;
    me.unanswered = 0;
    me.groundCooldown = 0;
    if (reason === 'round') setAction(me, 'idle', 0);
    else setAction(me, 'gndStandUp', GROUND.standAnim);
  }
  emit(f, { type: 'standUp', tick: s.tick, reason });
}

/** The hold animation for the current position. */
function holdPose(f: Fight): void {
  const s = f.state;
  const g = s.ground;
  if (!g) return;
  const top = s.fighters[g.top];
  const bottom = s.fighters[opp(g.top)];
  setAction(top, g.pos === 'mount' ? 'gndMountTop' : 'gndGuardTop', 0);
  setAction(bottom, g.pos === 'mount' ? 'gndMountBottom' : 'gndGuardBottom', 0);
}

function isHold(f: Fight, side: Side): boolean {
  const a = f.state.fighters[side].action;
  return a === 'gndGuardTop' || a === 'gndGuardBottom' || a === 'gndMountTop' || a === 'gndMountBottom' || a === 'gndBlock';
}

// ---- one tick on the ground ----------------------------------------------------------------------------------

export function stepGround(f: Fight, inputs: [FightInput, FightInput]): void {
  const s = f.state;
  const g = s.ground;
  if (!g) return;
  g.tick++;
  g.idle++;
  roundStats(f, g.top).controlTicks++;
  const topSide = g.top;
  const botSide = opp(g.top);
  const top = s.fighters[topSide];
  const bot = s.fighters[botSide];

  // finished transition animations fall back to the hold pose
  for (const side of [topSide, botSide] as const) {
    const me = s.fighters[side];
    if (me.actionLength > 0 && me.actionTick >= me.actionLength) {
      if (me.action === 'gndStandUp') continue;
      if (me.action === 'gndAdvance') {
        g.pos = 'mount';
        emit(f, { type: 'position', tick: s.tick, pos: 'mount', top: topSide });
      }
      if (me.action === 'gndEscape') {
        g.pos = 'guard';
        emit(f, { type: 'position', tick: s.tick, pos: 'guard', top: topSide });
      }
      holdPose(f);
    }
  }

  if (g.sub) {
    stepSub(f, inputs);
    return;
  }
  if (g.scramble) {
    stepScramble(f, inputs);
    return;
  }

  // ground-and-pound landing
  if (top.action === 'gndPound' && top.actionTick === GROUND.poundImpact) landPound(f, topSide);

  // bottom: block, escape / stand up, submission from guard
  const bin = inputs[botSide];
  if (isHold(f, botSide)) {
    if (bin.ground === 'up' && bot.groundCooldown === 0) {
      startScramble(f, botSide, g.pos === 'mount' ? 'escape' : 'standUp');
      return;
    }
    if (bin.ground === 'down' && g.pos === 'guard' && bot.groundCooldown === 0) {
      startSub(f, botSide, 'armbar');
      return;
    }
    if (bin.block) {
      if (bot.action !== 'gndBlock') setAction(bot, 'gndBlock', 0);
    } else if (bot.action === 'gndBlock') holdPose(f);
  }
  if (bot.action === 'gndBlock') spend(f, botSide, 4);

  // top: pound, pass to mount, submission
  const tin = inputs[topSide];
  if (isHold(f, topSide)) {
    if (tin.ground === 'up' && g.pos === 'guard' && top.groundCooldown === 0) {
      startScramble(f, topSide, 'advance');
      return;
    }
    if (tin.ground === 'down' && top.groundCooldown === 0) {
      startSub(f, topSide, g.pos === 'mount' ? 'armbar' : 'choke');
      return;
    }
    if (tin.tap || tin.strike) {
      setAction(top, 'gndPound', GROUND.poundLength, GROUND.poundImpact);
      spend(f, topSide, costFor(f, topSide, GROUND.poundCost));
      roundStats(f, topSide).thrown++;
      emit(f, { type: 'strike', tick: s.tick, side: topSide, move: 'pound', chain: 0 });
    }
  }

  if (g.idle >= GROUND.refIdle || g.tick >= GROUND.refMax) standUp(f, 'ref');
}

function landPound(f: Fight, side: Side): void {
  const s = f.state;
  const g = s.ground;
  if (!g) return;
  const other = opp(side);
  const bot = s.fighters[other];
  const blocked = bot.action === 'gndBlock' && bot.stamina > 600;
  let dmg = muldiv(GROUND.poundDmg, attackPm(f, side, 'cross'), 1000);
  if (g.pos === 'mount') dmg = muldiv(dmg, 13, 10);
  if (blocked) dmg = muldiv(dmg, GROUND.poundBlockedPm, 1000);
  const applied = applyZoneDamage(f, other, 'head', dmg);
  const rs = roundStats(f, side);
  if (!blocked) {
    rs.landed++;
    rs.power++;
    g.idle = 0;
    setAction(bot, 'gndPoundHit', 14);
  } else {
    roundStats(f, other).defended++;
    spend(f, other, 220);
  }
  rs.headDmg += applied;
  addSpecial(f, side, muldiv(applied, 6, 10));
  emit(f, {
    type: 'hit',
    tick: s.tick,
    side,
    move: 'pound',
    zone: 'head',
    dmg: applied,
    strength: applied >= 900 ? 'heavy' : applied >= 450 ? 'medium' : 'light',
    counter: false,
    blocked,
    chain: 0,
  });
  // the referee counts unanswered shots on a hurt fighter
  if (!blocked && bot.hurt >= 7000) {
    bot.unanswered++;
    if (bot.unanswered >= GROUND.groundTko) {
      endFight(f, side, 'TKO', { by: 'pound', stoppage: 'ground' });
    }
  } else if (blocked) {
    bot.unanswered = Math.max(0, bot.unanswered - 1);
  }
}

// ---- scrambles ----------------------------------------------------------------------------------------------------

function startScramble(f: Fight, side: Side, purpose: ScramblePurpose): void {
  const s = f.state;
  const g = s.ground;
  if (!g) return;
  const dir = DIRS[rngInt(s, 4)];
  g.scramble = { initiator: side, purpose, dir, tick: 0, window: GROUND.scrambleWindow, arrive: [-1, -1], locked: [false, false] };
  spend(f, side, costFor(f, side, GROUND.scrambleCost));
  for (const i of [0, 1] as const) {
    s.fighters[i].prompt = { kind: 'scramble', dir, ticksLeft: GROUND.scrambleWindow, window: GROUND.scrambleWindow, attacking: i === side };
  }
  g.idle = Math.max(0, g.idle - 120);
  emit(f, { type: 'scramble', tick: s.tick, side, purpose, dir });
}

/** Ticks of handicap for this side in a scramble: better grapplers answer sooner. */
function scrambleHandicap(f: Fight, side: Side): number {
  const g = stat(f, side, 'grappling');
  const w = stat(f, side, 'wrestling');
  return muldiv(130 - g - (w >> 1), 1, 16) - 2; // ~ -5 .. +6
}

function stepScramble(f: Fight, inputs: [FightInput, FightInput]): void {
  const s = f.state;
  const g = s.ground;
  const sc = g?.scramble;
  if (!g || !sc) return;
  sc.tick++;
  for (const i of [0, 1] as const) {
    const inp = inputs[i].ground;
    if (sc.locked[i] || sc.arrive[i] >= 0 || !inp) continue;
    if (inp === sc.dir) sc.arrive[i] = Math.max(1, sc.tick + scrambleHandicap(f, i));
    else sc.locked[i] = true;
  }
  const left = sc.window - sc.tick;
  for (const me of s.fighters) if (me.prompt) me.prompt.ticksLeft = Math.max(0, left);
  const ini = sc.initiator;
  const def = opp(ini);
  // decided as soon as the side still answering could no longer arrive first (it answers next tick at the earliest)
  const doneI = sc.locked[ini] || sc.arrive[ini] >= 0;
  const doneD = sc.locked[def] || sc.arrive[def] >= 0;
  const iniWon = sc.arrive[ini] >= 0 && !doneD && sc.tick + 1 + scrambleHandicap(f, def) > sc.arrive[ini];
  const defWon = sc.arrive[def] >= 0 && !doneI && sc.tick + 1 + scrambleHandicap(f, ini) >= sc.arrive[def];
  if (left > 0 && !(doneI && doneD) && !iniWon && !defWon) return;

  const a = sc.arrive[ini];
  const d = sc.arrive[def];
  const success = a >= 0 && (d < 0 || a <= d);
  g.scramble = null;
  for (const me of s.fighters) me.prompt = null;
  emit(f, { type: 'scrambleEnd', tick: s.tick, side: ini, purpose: sc.purpose, success });
  if (!success) {
    s.fighters[ini].groundCooldown = GROUND.scrambleCooldown;
    spend(f, ini, 400);
    return;
  }
  g.idle = 0;
  switch (sc.purpose) {
    case 'advance':
      setAction(s.fighters[ini], 'gndAdvance', GROUND.advanceAnim);
      setAction(s.fighters[def], g.pos === 'mount' ? 'gndMountBottom' : 'gndGuardBottom', 0);
      break;
    case 'escape':
      setAction(s.fighters[ini], 'gndEscape', GROUND.escapeAnim);
      break;
    case 'standUp':
      standUp(f, 'scramble');
      break;
  }
}

// ---- submissions ----------------------------------------------------------------------------------------------------

function startSub(f: Fight, side: Side, kind: SubKind): void {
  const s = f.state;
  const g = s.ground;
  if (!g) return;
  g.sub = { atk: side, kind, progress: GROUND.subStart, tick: 0 };
  spend(f, side, costFor(f, side, GROUND.subCost));
  roundStats(f, side).subAttempts++;
  g.idle = 0;
  const def = opp(side);
  setAction(s.fighters[side], kind === 'armbar' ? 'subArmbarAtk' : 'subChokeAtk', 0);
  setAction(s.fighters[def], kind === 'armbar' ? 'subArmbarDef' : 'subChokeDef', 0);
  for (const i of [0, 1] as const) {
    s.fighters[i].prompt = { kind: 'mash', dir: null, ticksLeft: GROUND.subTimeLimit, window: GROUND.subTimeLimit, attacking: i === side };
  }
  emit(f, { type: 'subStart', tick: s.tick, side, sub: kind });
}

/** Force of one tap for this side (attacker uses submissions, defender grappling), scaled by stamina. */
function tapForce(f: Fight, side: Side, attacking: boolean): number {
  const me = f.state.fighters[side];
  const skill = attacking ? stat(f, side, 'submissions') : stat(f, side, 'grappling');
  return muldiv(380 + skill, 5000 + (me.stamina >> 1), 10000);
}

function stepSub(f: Fight, inputs: [FightInput, FightInput]): void {
  const s = f.state;
  const g = s.ground;
  const sub = g?.sub;
  if (!g || !sub) return;
  sub.tick++;
  const atk = sub.atk;
  const def = opp(atk);
  // a small drift toward the better submission artist
  let delta = muldiv(stat(f, atk, 'submissions') - stat(f, def, 'grappling'), 1, 16) + 1;
  if (inputs[atk].tap) {
    delta += tapForce(f, atk, true);
    spend(f, atk, GROUND.subTapCost);
  }
  if (inputs[def].tap) {
    delta -= tapForce(f, def, false);
    spend(f, def, GROUND.subTapCost);
  }
  sub.progress = clampi(sub.progress + delta, 0, METER_MAX);
  const left = GROUND.subTimeLimit - sub.tick;
  for (const me of s.fighters) if (me.prompt) me.prompt.ticksLeft = Math.max(0, left);
  if (sub.progress >= METER_MAX) {
    g.sub = null;
    for (const me of s.fighters) me.prompt = null;
    setAction(s.fighters[def], 'tapOut', 0);
    emit(f, { type: 'tapOut', tick: s.tick, side: def, sub: sub.kind });
    endFight(f, atk, 'SUB', { sub: sub.kind });
    return;
  }
  if (sub.progress <= 0 || left <= 0) {
    g.sub = null;
    for (const me of s.fighters) me.prompt = null;
    s.fighters[atk].groundCooldown = GROUND.scrambleCooldown;
    addSpecial(f, def, 1000);
    emit(f, { type: 'subEscape', tick: s.tick, side: def, sub: sub.kind });
    standUp(f, 'subEscape');
  }
}

/** Live numbers the AI and HUD use. */
export function subProgress(f: Fight): number {
  return f.state.ground?.sub?.progress ?? 0;
}
