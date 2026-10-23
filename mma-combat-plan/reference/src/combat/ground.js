// Ground game (docs/09): position graph, transition contests, ground-and-pound, cover/posture/turtle defence, get-ups,
// submission hand-off and the referee's stand-up timers. A ground fight is a GroundBout with a `top` (dom) and a `bottom` (sub).

import { GroundPosition as G, Mode, ClinchRole as R, toTicks, DT } from '../core/taxonomy.js';
import { clamp, vAngle, vFromAngle, vSub } from '../core/math.js';
import { EventType } from '../sim/events.js';
import { skillAdd } from './skills.js';
import { actionStaminaCost } from './stamina.js';
import { applyImpact } from './impact.js';
import { beginSubmission, availableSubmissions } from './submission.js';

const E = (to, kind, extra = {}) => ({ to, kind, ...extra });

/**
 * Transition graph (docs/09 §2). `top` edges improve the top fighter's position (passes); `bottom` edges are escapes,
 * recoveries, sweeps and reversals (`swap: true` swaps the roles). `flag` = optional per-fighter enable flag,
 * `needs: 'turtle'` = only while the bottom fighter has turned to his stomach.
 */
export const GROUND_GRAPH = Object.freeze({
  [G.DOWNED]: { top: [E(G.SIDE_CONTROL, 'pass'), E(G.FULL_MOUNT, 'pass')], bottom: [E(G.GUARD, 'recover')] },
  [G.SPRAWL]: { top: [E(G.SIDE_CONTROL, 'pass'), E(G.BACK_MOUNT, 'pass', { needs: 'turtle' })], bottom: [E(G.GUARD, 'recover'), E(G.HALF_GUARD, 'recover')] },
  [G.GUARD]: { top: [E(G.HALF_GUARD, 'pass'), E(G.STACKED_GUARD, 'pass', { flag: 'stack' })], bottom: [E(G.HALF_GUARD, 'sweep', { swap: true }), E(G.RUBBER_GUARD, 'control', { flag: 'rubber' })] },
  [G.HALF_GUARD]: { top: [E(G.SIDE_CONTROL, 'pass'), E(G.FULL_MOUNT, 'pass')], bottom: [E(G.GUARD, 'recover'), E(G.HALF_GUARD, 'sweep', { swap: true })] },
  [G.STACKED_GUARD]: { top: [E(G.SIDE_CONTROL, 'pass')], bottom: [E(G.GUARD, 'escape')] },
  [G.RUBBER_GUARD]: { top: [E(G.GUARD, 'escape')], bottom: [E(G.GUARD, 'release'), E(G.HALF_GUARD, 'sweep', { swap: true })] },
  [G.SIDE_CONTROL]: {
    top: [E(G.FULL_MOUNT, 'pass'), E(G.NORTH_SOUTH, 'pass'), E(G.BACK_MOUNT, 'pass', { needs: 'turtle' }), E(G.CRUCIFIX, 'pass', { flag: 'crucifix' }), E(G.SIDE_SADDLE, 'pass', { flag: 'sidesaddle' })],
    bottom: [E(G.HALF_GUARD, 'escape'), E(G.GUARD, 'escape'), E(G.SIDE_CONTROL, 'reverse', { swap: true })],
  },
  [G.SIDE_SADDLE]: { top: [E(G.FULL_MOUNT, 'pass'), E(G.SIDE_CONTROL, 'pass')], bottom: [E(G.HALF_GUARD, 'escape'), E(G.GUARD, 'escape')] },
  [G.NORTH_SOUTH]: { top: [E(G.SIDE_CONTROL, 'pass')], bottom: [E(G.HALF_GUARD, 'escape'), E(G.NORTH_SOUTH, 'reverse', { swap: true })] },
  [G.FULL_MOUNT]: { top: [E(G.BACK_MOUNT, 'pass')], bottom: [E(G.HALF_GUARD, 'escape'), E(G.GUARD, 'escape')] },
  [G.CRUCIFIX]: { top: [E(G.BACK_MOUNT, 'pass'), E(G.FULL_MOUNT, 'pass')], bottom: [E(G.HALF_GUARD, 'escape')] },
  [G.BACK_MOUNT]: { top: [E(G.FULL_MOUNT, 'pass')], bottom: [E(G.HALF_GUARD, 'escape')] },
  [G.BACK_SIDEMOUNT]: { top: [E(G.BACK_MOUNT, 'pass'), E(G.SIDE_CONTROL, 'pass')], bottom: [E(G.HALF_GUARD, 'escape')] },
});

export const GROUND_POSITIONS = Object.freeze(Object.keys(GROUND_GRAPH));
/** Closed legs make a pass harder (docs/09 §3.1 `hooks`). */
export const hooksInFor = (position) => position === G.GUARD || position === G.RUBBER_GUARD;
/** A fighter's optional-transition flags: explicit list on the spec, else good ground fighters have them all. */
export const flagEnabled = (f, flag) => (f.spec.groundFlags ? f.spec.groundFlags.includes(flag) : f.rating('groundcontrol') >= 60);
const STRIKE_TAGS = ['hammer', 'straight', 'hook', 'elbow', 'knee'];

// ---- probabilities (docs/09 §3.1, §3.3) --------------------------------------------------------------------------------

export function topImproveProbability(top, bottom, tun, { position, activeDefence = false } = {}) {
  const g = tun.ground;
  const staminaDeficit = Math.max(0, (bottom.staminaFraction() - top.staminaFraction()) * 100);
  const p = g.topBase + g.topPerRating * (top.rating('groundpassing') - bottom.rating('groundcontrol'))
    + (hooksInFor(position) ? 0 : g.noHooksBonus) - (activeDefence ? g.activeDefencePenalty : 0) - g.staminaDeficitWeight * staminaDeficit + skillAdd(top, 'ground');
  return clamp(p, g.pTopMin, g.pTopMax);
}

export function bottomEscapeProbability(bottom, top, tun, { position } = {}) {
  const g = tun.ground;
  const p = g.bottomBase + g.bottomPerRating * (bottom.rating('groundcontrol') - top.rating('groundcontrol'))
    + g.movementWeight * bottom.rating('movement') - (g.hold[position] ?? 0) + skillAdd(bottom, 'ground');
  return clamp(p, g.pBottomMin, g.pBottomMax);
}

export function getUpProbability(bottom, top, tun, { broken = false, cage = false, position = null } = {}) {
  const g = tun.ground;
  return clamp(g.getUpBase + g.getUpPerRating * (bottom.rating('movement') - top.rating('groundcontrol')) + (broken ? g.getUpBrokenBonus : 0) + (cage ? g.getUpCageBonus : 0) + (position === G.SPRAWL ? g.sprawlGetUpBonus : 0), 0.05, 0.9);
}

// ---- the bout --------------------------------------------------------------------------------------------------------

export class GroundBout {
  constructor(world, top, bottom, position, { reason = 'takedown', silent = false } = {}) {
    this.kind = 'ground';
    this.world = world;
    this.top = top; this.bottom = bottom;
    this.a = world.fighters[0]; this.b = world.fighters[1];
    this.position = position;
    this.finished = false;
    this.ticks = 0; this.positionTicks = 0; this.idleTicks = 0; this.warned = false;
    this.topPosture = 'upright'; this.brokenTicks = 0; this.turtled = 0;
    this.guard = new Map([[top.id, 'none'], [bottom.id, 'none']]);
    this.centre = { x: (top.pos.x + bottom.pos.x) / 2, y: (top.pos.y + bottom.pos.y) / 2 };
    this.axis = vAngle(vSub(bottom.pos, top.pos));
    this.getUpFails = new Map([[top.id, 0], [bottom.id, 0]]);
    for (const f of [top, bottom]) {
      f.mode = Mode.GROUND; f.bout = this; f.action = null; f.vel = { x: 0, y: 0 };
      f.guard = { state: 'none', timeUp: 0 }; f.parryTicks = f.slipTicks = f.catchTicks = 0; f.heldLeg = null; f.trapped = 0; f.cover = 0;
      f.cooldowns.ground = Math.max(f.cooldowns.ground, 30);
      f.fenceDominance = f.backAgainstCage = false;
    }
    top.groundRole = R.DOM; bottom.groundRole = R.SUB;
    bottom.floorPosture = position === G.SPRAWL ? 'face' : 'back';
    this.#place();
    if (!silent) world.emit(EventType.GROUND_POSITION, { top: top.id, bottom: bottom.id, from: null, to: position, reason });
  }

  get fighters() { return [this.a, this.b]; }
  other(f) { return f === this.top ? this.bottom : this.top; }
  roleOf(f) { return f === this.top ? R.DOM : R.SUB; }
  get hold() { return this.world.tun.ground.hold[this.position] ?? 0; }
  get dominant() { return this.hold >= 0.15; }

  #place() {
    const d = (this.top.radius + this.bottom.radius) * 0.7, u = vFromAngle(this.axis), c = this.world.cage.clamp(this.centre, d).pos;
    this.centre = c;
    this.top.pos = { x: c.x - u.x * d / 2, y: c.y - u.y * d / 2 };
    this.bottom.pos = { x: c.x + u.x * d / 2, y: c.y + u.y * d / 2 };
    this.top.facing = this.axis; this.bottom.facing = this.axis + Math.PI;
  }

  // ---- intents ----
  applyIntent(f, intent) {
    const covering = f === this.bottom && intent.guard !== 'none' && !f.isHelpless();
    this.guard.set(f.id, covering ? intent.guard : 'none');
    if (covering) f.cover = 3;
    const g = intent.grapple;
    if (!g || f.isHelpless() || f.busy()) return false;
    switch (g.kind) {
      case 'strike': return this.strike(f, g.strike, g.target);
      case 'transition': return this.transition(f, g.to);
      case 'getup': return this.getUp(f);
      case 'submission': return this.startSubmission(f, g.name);
      case 'posture': return this.postureControl(f);
      case 'turtle': return this.turtleUp(f);
      case 'cover': f.cover = 20; this.#defended(f); return true;
      case 'release': return f === this.top ? (this.end('released'), true) : false;
      default: return false;
    }
  }

  groundMoves() { return this.world.moveBook.all().filter((m) => m.mode === 'ground'); }
  #pick(name, target) {
    return this.groundMoves().find((m) => m.tags.includes(name) && (!target || m.target === target)) ?? this.groundMoves().find((m) => m.tags.includes(name)) ?? null;
  }
  #defended(f) { f.activeDefenceTick = this.world.tick; }
  #ready(f) { return f.cooldowns.ground <= 0 && f.stamina >= this.world.tun.ground.staminaPerAttempt; }

  /** Everything this fighter may legally do now; AI and UI build on it. */
  legalActions(f) {
    if (this.finished || f.isHelpless() || f.busy()) return [];
    const out = [];
    const isTop = f === this.top;
    const tun = this.world.tun;
    if (isTop) {
      for (const m of this.groundMoves()) if (f.stamina >= actionStaminaCost(f, m.stamina)) out.push({ kind: 'strike', strike: STRIKE_TAGS.find((t) => m.tags.includes(t)), target: m.target, moveId: m.id });
    } else {
      out.push({ kind: 'cover' }, { kind: 'posture' }, { kind: 'turtle' });
    }
    if (this.#ready(f)) {
      for (const e of this.edgesFor(f)) out.push({ kind: 'transition', to: e.to, edge: e.kind });
      if (!isTop) out.push({ kind: 'getup' });
    }
    for (const name of availableSubmissions(this.position, this.roleOf(f))) {
      if (f.cooldowns.submission <= 0 && f.stamina >= tun.ground.staminaPerAttempt) out.push({ kind: 'submission', name });
    }
    if (isTop) out.push({ kind: 'release' });
    return out;
  }

  /** Transition edges this fighter can currently try (flags and turtle requirements applied). */
  edgesFor(f) {
    const list = GROUND_GRAPH[this.position][f === this.top ? 'top' : 'bottom'];
    return list.filter((e) => (!e.flag || flagEnabled(f, e.flag)) && (e.needs !== 'turtle' || this.turtled > 0));
  }

  // ---- actions ----
  strike(f, name, target) {
    if (f !== this.top) return false;
    const move = this.#pick(name, target);
    if (!move) return false;
    const { world } = this;
    f.action = { move, tick: 0, startTick: world.tick, frames: f.scaledFrames(move), extraRecovery: 0, resolved: false, chargeFrac: 0, hitStop: 0, fromCancel: false };
    f.spendStamina(actionStaminaCost(f, move.stamina) + world.tun.ground.gnpStamina * 0.2);
    f.logStrike(world.tick);
    return true;
  }

  /** Called by the sim when a ground strike reaches its active phase. */
  resolveAction(f) {
    const a = f.action;
    if (!a || a.resolved) return null;
    a.resolved = true;
    const { world } = this, g = world.tun.ground;
    const target = this.other(f);
    let mult = g.gnpMult[this.position] ?? 1;
    if (this.topPosture === 'broken') mult *= g.brokenPostureMult;
    let defense = { outcome: 'hit', mitigation: 0, strong: false };
    if (target.cover > 0 && !target.isHelpless()) defense = { outcome: 'blocked', mitigation: g.coverMitigation, strong: false };
    const r = applyImpact(world, f, target, a.move, defense, { mode: 'ground', ctx: { damageMult: mult } });
    if (r.ev.significant) { this.idleTicks = 0; this.warned = false; }
    return r;
  }

  transition(f, to) {
    const edge = this.edgesFor(f).find((e) => e.to === to);
    if (!edge || !this.#ready(f)) return false;
    const { world } = this, g = world.tun.ground, other = this.other(f);
    f.spendStamina(g.staminaPerAttempt);
    f.cooldowns.ground = g.transitionCooldownTicks;
    this.idleTicks = 0; this.warned = false;
    const isTop = f === this.top;
    let p = isTop
      ? topImproveProbability(f, other, world.tun, { position: this.position, activeDefence: world.tick - other.activeDefenceTick < g.activeDefenceTicks })
      : bottomEscapeProbability(f, other, world.tun, { position: this.position }) + (this.turtled > 0 ? 0.08 : 0);
    if (edge.needs === 'turtle') p += 0.25;                                         // an exposed back is easy to take
    if (edge.swap) p *= g.sweepShare;
    const ok = world.rng('ground').chance(clamp(p, 0, 1));
    if (isTop) world.emit(EventType.PASS, { actor: f.id, success: ok, against: other.id, from: this.position, to: to });
    if (!ok) { other.cooldowns.ground = 0; return false; }                         // a failed attempt gives the opponent a free action
    if (edge.swap) world.emit(EventType.SWEEP, { actor: f.id, from: this.position, to });
    this.moveTo(edge, isTop ? 'pass' : edge.kind);
    return true;
  }

  moveTo(edge, reason) {
    const { world } = this;
    const from = this.position;
    if (edge.swap) {
      [this.top, this.bottom] = [this.bottom, this.top];
      this.top.groundRole = R.DOM; this.bottom.groundRole = R.SUB;
      this.axis = vAngle(vSub(this.bottom.pos, this.top.pos));
      this.#place();
    }
    this.position = edge.to;
    this.positionTicks = 0; this.brokenTicks = 0; this.topPosture = 'upright'; this.turtled = 0;
    this.bottom.floorPosture = 'back';
    world.emit(EventType.GROUND_POSITION, { top: this.top.id, bottom: this.bottom.id, from, to: edge.to, reason });
  }

  /** Bottom fighter pulls the top fighter down: breaks his posture for a while (contest of groundcontrol). */
  postureControl(f) {
    if (f !== this.bottom || f.cooldowns.ground > 0) return false;
    const { world } = this, g = world.tun.ground, top = this.top;
    f.spendStamina(3);
    f.cooldowns.ground = Math.round(g.transitionCooldownTicks / 2);
    this.#defended(f);
    if (world.rng('ground').chance(clamp(0.4 + 0.004 * (f.rating('groundcontrol') - top.rating('groundcontrol')), 0.1, 0.8))) {
      this.topPosture = 'broken'; this.brokenTicks = g.postureBreakTicks;
      return true;
    }
    return false;
  }

  /** Turn to the stomach: opens a scramble to the feet but exposes the back. */
  turtleUp(f) {
    if (f !== this.bottom || this.turtled > 0) return false;
    f.floorPosture = 'turtle';
    this.turtled = 90;
    this.#defended(f);
    return true;
  }

  getUp(f) {
    if (f !== this.bottom || !this.#ready(f)) return false;
    const { world } = this, g = world.tun.ground;
    f.spendStamina(g.staminaPerAttempt);
    f.cooldowns.ground = g.transitionCooldownTicks;
    this.idleTicks = 0; this.warned = false;
    const cage = world.cage.nearestWall(f.pos).gap < f.radius + 0.25;
    const ok = world.rng('ground').chance(getUpProbability(f, this.top, world.tun, { broken: this.topPosture === 'broken', cage, position: this.position }));
    world.emit(EventType.GET_UP, { actor: f.id, success: ok });
    if (!ok) { f.failedGetups += 1; this.top.cooldowns.ground = 0; return false; }
    f.failedGetups = 0;
    this.end('getup', { gap: g.getUpGap });
    return true;
  }

  startSubmission(f, name) {
    const role = this.roleOf(f);
    if (!availableSubmissions(this.position, role).includes(name) || f.cooldowns.submission > 0) return false;
    const { world } = this;
    f.cooldowns.submission = world.tun.submission.attemptCooldownTicks;
    f.spendStamina(world.tun.ground.staminaPerAttempt);
    this.idleTicks = 0; this.warned = false;
    beginSubmission(world, { attacker: f, defender: this.other(f), name, position: this.position, role, ground: this });
    return true;
  }

  // ---- per tick ----
  update() {
    if (this.finished) return { ended: true };
    const { world } = this, g = world.tun.ground, r = world.tun.referee;
    this.ticks += 1; this.positionTicks += 1; this.idleTicks += 1;
    for (const f of this.fighters) {
      if (f.cooldowns.ground > 0) f.cooldowns.ground -= 1;
      if (f.cooldowns.submission > 0) f.cooldowns.submission -= 1;
      if (f.cover > 0) f.cover -= 1;
    }
    if (this.brokenTicks > 0 && --this.brokenTicks === 0) this.topPosture = 'upright';
    if (this.turtled > 0 && --this.turtled === 0 && this.bottom.floorPosture === 'turtle') this.bottom.floorPosture = 'back';
    this.top.spendStamina(g.staminaPerSecTop * DT); this.bottom.spendStamina(g.staminaPerSecBottom * DT);
    world.stats.tickTime(this.top.id, 'time.ground.top'); world.stats.tickTime(this.bottom.id, 'time.ground.bottom');
    if (this.dominant) world.stats.tickTime(this.top.id, 'time.ground.dominant');
    if (!this.warned && this.idleTicks >= toTicks(r.lowActionWarnSeconds)) {
      this.warned = true;
      world.emit(EventType.REFEREE, { kind: 'low_action', mode: 'ground' });
    }
    if (this.idleTicks >= toTicks(r.groundIdleSeconds)) {
      world.emit(EventType.REFEREE, { kind: 'stand_up', mode: 'ground' });
      this.end('referee_standup', { gap: g.standUpGap, middle: true });
      return { ended: true, reason: 'referee_standup' };
    }
    return null;
  }

  /** Release both fighters. restore=false hands them to another bout (which sets modes itself). */
  release({ restore = true, gap, middle = false } = {}) {
    if (this.finished) return;
    this.finished = true;
    for (const f of this.fighters) { if (f.bout === this) f.bout = null; f.groundRole = null; f.cover = 0; }
    if (!restore) return;
    const { world } = this;
    for (const f of this.fighters) { f.mode = Mode.STANDUP; f.action = null; f.floorPosture = null; f.cooldowns.ground = Math.max(f.cooldowns.ground, 30); }
    if (middle) { world.resetToMiddle(gap ?? world.tun.ground.standUpGap); return; }
    const dist = this.top.radius + this.bottom.radius + (gap ?? world.tun.ground.getUpGap), u = vFromAngle(this.axis);
    const place = (f, s) => { f.pos = world.cage.clamp({ x: this.centre.x + u.x * dist / 2 * s, y: this.centre.y + u.y * dist / 2 * s }, f.radius).pos; };
    place(this.top, -1); place(this.bottom, 1);
    this.top.facing = vAngle(vSub(this.bottom.pos, this.top.pos)); this.bottom.facing = this.top.facing + Math.PI;
  }

  end(reason, opts) {
    if (this.finished) return;
    this.release(opts);
    this.world.emit(EventType.GROUND_POSITION, { top: this.top.id, bottom: this.bottom.id, from: this.position, to: G.NONE, reason });
  }

  hashNumbers() {
    return [3, Object.values(G).indexOf(this.position), this.ticks, this.positionTicks, this.top.index, this.brokenTicks, this.turtled, this.idleTicks];
  }
}
