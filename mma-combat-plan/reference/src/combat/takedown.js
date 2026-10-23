// Takedowns (docs/08): stand-up shots and clinch throws as a three-phase TakedownBout.
//   Phase I   entry / shot     – attacker committed; a landed counter-strike, a retreat (miss) or a sprawl can stop it
//   Phase II  contest / grapple – resolved by ratings ('auto') or the SnakeMeter timing duel ('meter')
//   Phase III resolution       – land (major = dominant, minor = scramble) or a denial type, then the next bout
// Invariant (tested): attempted == landed + denied(stuffed) + missed.

import { Mode, STANDUP_TAKEDOWNS, TakedownDenial, GroundPosition as G, DT } from '../core/taxonomy.js';
import { clamp, vAngle, vNorm, vSub, vFromAngle } from '../core/math.js';
import { EventType } from '../sim/events.js';
import { skillAdd } from './skills.js';
import { SnakeMeter } from './minigames.js';
import { evaluateLadder } from './health-events.js';
import { GroundBout } from './ground.js';
import { ClinchBout } from './clinch.js';

/** Family of a takedown move name → base-chance key in tun.clinch.takedownBase and landing table key. */
export function moveFamily(name) {
  if (/^hip_throw/.test(name)) return 'hip_throw';
  if (/^judo_throw/.test(name)) return 'judo_throw';
  if (/^bodylock_throw/.test(name)) return 'bodylock_throw';
  if (/^suplex/.test(name)) return 'suplex';
  if (/trip/.test(name)) return 'trip';
  if (/^(doubleleg|singleleg)/.test(name)) return 'leg';
  if (/^leg_grab/.test(name)) return 'leg_grab';
  return 'throw';
}
/** `_low` variants are the minor (partial / scramble) size; everything else is major. */
const inferSize = (name) => (/_low$/.test(name) ? 'minor' : 'major');
const SLAMS = new Set(['hip_throw', 'judo_throw', 'bodylock_throw', 'suplex', 'throw']);

/** Ground position of the attacker-on-top outcome by family and size (docs/08 §3.3). */
export const LANDING = Object.freeze({
  hip_throw: { major: G.SIDE_CONTROL, minor: G.HALF_GUARD },
  judo_throw: { major: G.SIDE_CONTROL, minor: G.HALF_GUARD },
  bodylock_throw: { major: G.SIDE_CONTROL, minor: G.HALF_GUARD },
  suplex: { major: G.SIDE_CONTROL, minor: G.HALF_GUARD },
  throw: { major: G.SIDE_CONTROL, minor: G.HALF_GUARD },
  trip: { major: G.HALF_GUARD, minor: G.GUARD },
  leg: { major: G.HALF_GUARD, minor: G.GUARD },
  leg_grab: { major: G.HALF_GUARD, minor: G.GUARD },
});
export const landingFor = (type, size) => LANDING[moveFamily(type)][size];

export function chooseShotType(att, dir = 'fwd', size = 'major') {
  const t = STANDUP_TAKEDOWNS[dir][size];
  if (dir === 'fwd' && size === 'major' && (att.style === 'freestyle_wrestler' || att.style === 'greco_roman_wrestler')) return 'doubleleg_high';
  return t;
}

/** Probability the takedown lands (docs/08 §3.2 `auto`; clinch variant per docs/07 §3.3). Pure and bounded. */
export function takedownProbability(att, def, tun, { origin = 'standup', type = 'singleleg_high', size = 'major', cage = false, sprawling = false, role = 'dom', whizzer = false } = {}) {
  const t = tun.takedown;
  const A = att.rating('takedown') + skillAdd(att, 'takedown'), D = def.rating('takedowndefense');
  let p;
  if (origin === 'clinch') {
    const c = tun.clinch;
    p = c.takedownBase[moveFamily(type)] + c.takedownPerRating * (A - D) + c.takedownThrowsPerRating * (att.rating('clinchthrows') - def.rating('clinchthrows'));
    if (role === 'sub') p -= c.subTakedownPenalty;
    if (cage) p += c.cageTakedownBonus;
    if (whizzer) p -= c.whizzerPenalty;
  } else {
    p = t.base + t.perRating * (A - D) + (cage ? t.cageBonus : 0) - (sprawling ? t.sprawlInputPenalty : 0) + (size === 'minor' ? t.minorBonus : 0);
  }
  p += t.staminaDiffWeight * (att.staminaFraction() - def.staminaFraction()) + (t.styleBonus[att.style] ?? 0) - (t.styleBonus[def.style] ?? 0) + (att.mods?.takedown ?? 0);
  return clamp(p, t.pMin, t.pMax);
}

/** Meter difficulty from the rating delta (docs/08 §3.2). */
export const meterDifficulty = (att, def) => clamp(0.5 + (def.rating('takedowndefense') - att.rating('takedown')) / 200, 0.1, 0.9);

const SHOT_MISS = Object.freeze({ id: 'shot_miss', mode: 'standup', tags: [], cancel: { out: [], into: [] } });

export function canStartShot(world, att, def) {
  const t = world.tun.takedown;
  if (att.mode !== Mode.STANDUP || def.mode !== Mode.STANDUP) return { ok: false, reason: 'mode' };
  if (att.isHelpless() || att.busy() || att.heldLeg || att.trapped > 0) return { ok: false, reason: 'busy' };
  if (att.cooldowns.takedown > 0) return { ok: false, reason: 'cooldown' };
  if (att.stamina < t.minStamina) return { ok: false, reason: 'stamina' };
  if (world.gap(att, def) > t.shotRange) return { ok: false, reason: 'range' };
  return { ok: true, reason: null };
}

export function startShot(world, att, def, { dir = 'fwd', size = 'major' } = {}) {
  const legal = canStartShot(world, att, def);
  if (!legal.ok) return { ok: false, reason: legal.reason };
  return { ok: true, bout: new TakedownBout(world, att, def, { type: chooseShotType(att, dir, size), origin: 'standup', dir, size }) };
}

export class TakedownBout {
  /**
   * @param o {type, origin:'standup'|'clinch', dir, size, position, role, cage, whizzer}
   */
  constructor(world, att, def, o = {}) {
    this.kind = 'takedown';
    this.world = world;
    this.attacker = att; this.defender = def;
    this.a = world.fighters[0]; this.b = world.fighters[1];
    this.origin = o.origin ?? 'standup';
    this.type = o.type; this.dir = o.dir ?? 'fwd'; this.size = o.size ?? inferSize(o.type);
    this.role = o.role ?? 'dom'; this.cage = !!o.cage; this.whizzer = !!o.whizzer; this.position = o.position ?? null;
    this.phase = 1; this.ticks = 0; this.finished = false; this.result = null;
    this.sprawlInput = false; this.pressed = new Map();
    const t = world.tun.takedown;
    this.startup = t.startup;
    att.spendStamina(t.staminaEntry * (this.size === 'minor' ? t.minorStaminaMult : 1));
    att.cooldowns.takedown = t.cooldownTicks;
    att.mode = Mode.TAKEDOWN; att.bout = this; att.action = null; att.vel = { x: 0, y: 0 };
    att.guard = { state: 'none', timeUp: 0 };
    const toDef = vSub(def.pos, att.pos);
    att.facing = vAngle(toDef);
    world.emit(EventType.TAKEDOWN, { attacker: att.id, defender: def.id, phase: 'start', move: this.type, size: this.size, direction: this.dir, origin: this.origin });
    if (this.origin === 'clinch') {                         // the throw/trip attempt starts already locked up
      def.mode = Mode.TAKEDOWN; def.bout = this; def.action = null;
      this.#enterContest(world.tun.clinch.contestTicks);
    } else {
      def.bout = this;                                      // def stays STANDUP during Phase I: it can strike, retreat or sprawl
      this.closing = (t.shotRange + t.closeExtra) / this.startup;
    }
  }

  get fighters() { return [this.a, this.b]; }
  other(f) { return f === this.attacker ? this.defender : this.attacker; }
  get committed() { return this.phase === 1; }

  applyIntent(f, intent) {
    this.pressed.set(f.id, !!intent.prompt?.end);
    if (f === this.defender && intent.grapple?.kind === 'sprawl') this.sprawlInput = true;
    return true;
  }
  resolveAction() { return null; }
  legalActions(f) { return f === this.defender && this.phase <= 2 ? [{ kind: 'sprawl' }] : []; }

  #enterContest(ticks) {
    this.phase = 2; this.phaseTicks = 0; this.contestTicks = ticks;
    const { world, attacker: a, defender: d } = this;
    const t = world.tun.takedown;
    d.mode = Mode.TAKEDOWN; d.bout = this; d.action = null; d.vel = { x: 0, y: 0 };
    d.guard = { state: 'none', timeUp: 0 }; d.parryTicks = d.slipTicks = d.catchTicks = 0;
    // lock the pair together, keeping the axis
    const mid = { x: (a.pos.x + d.pos.x) / 2, y: (a.pos.y + d.pos.y) / 2 };
    const axis = vAngle(vSub(d.pos, a.pos)), h = (a.radius + d.radius) * 0.45;
    const u = vFromAngle(axis);
    a.pos = { x: mid.x - u.x * h, y: mid.y - u.y * h }; d.pos = { x: mid.x + u.x * h, y: mid.y + u.y * h };
    a.facing = axis; d.facing = axis + Math.PI;
    this.sprawling = this.sprawlInput || world.rng('takedown').chance(clamp(t.sprawlChance + t.sprawlPerDefense * d.rating('takedowndefense'), 0, 0.95));
    this.useMeter = t.resolver === 'meter' && (a.human || d.human);
    if (this.useMeter) {
      const m = t.meter;
      this.meter = new SnakeMeter({ ...m, difficulty: meterDifficulty(a, d), random: world.rng('minigame').next(), domPlaying: a.human, subPlaying: d.human }).start();
    }
  }

  /** The sim calls this when a stand-up strike lands on the shooter during Phase I (docs/08 §3.1). */
  onStruck(striker, move, tier) {
    if (this.finished || this.phase !== 1 || striker !== this.defender) return false;
    const denial = move.tags?.includes('knee') || move.kind === 'knee' ? TakedownDenial.COUNTER_KNEE : move.limb === 'kick' ? TakedownDenial.COUNTER_KICK : TakedownDenial.COUNTER_PUNCH;
    const heavy = tier === this.world.tun.takedown.counterStaggerTier;
    this.#finish('denied', denial);
    if (heavy && this.attacker.status.event === 'none') this.world.healthEvent(this.attacker, striker, 'wobbled_shot', 'head');
    return true;
  }

  update() {
    if (this.finished) return { ended: true };
    const { world, attacker: a, defender: d } = this, t = world.tun.takedown;
    this.ticks += 1;
    if (this.phase === 1) {
      const step = Math.min(this.closing, world.gap(a, d));          // the shooter closes at a fixed speed; a retreating defender can out-run it
      const n = vNorm(vSub(d.pos, a.pos));
      a.pos = { x: a.pos.x + n.x * step, y: a.pos.y + n.y * step };
      a.facing = vAngle(vSub(d.pos, a.pos));
      if (this.ticks >= this.startup) {
        if (world.gap(a, d) > t.contactGap) { this.#finish('missed', TakedownDenial.MISSED); return { ended: true }; }
        this.#enterContest(t.contestTicks);
      }
      return null;
    }
    // phase II
    this.phaseTicks += 1;
    a.spendStamina(t.staminaPerSecContest * DT); d.spendStamina(t.staminaPerSecContest * DT);
    if (this.useMeter) {
      const out = this.meter.tick(DT, { domEnd: !!this.pressed.get(a.id), subEnd: !!this.pressed.get(d.id) });
      if (out.finished) { this.#resolve(out.domWon); return { ended: true }; }
      return null;
    }
    if (this.phaseTicks >= this.contestTicks) {
      const p = takedownProbability(a, d, world.tun, { origin: this.origin, type: this.type, size: this.size, cage: this.cage || d.backAgainstCage || this.#wallBehind(d), sprawling: this.sprawling, role: this.role, whizzer: this.whizzer });
      this.p = p;
      this.#resolve(world.rng('takedown').chance(p));
      return { ended: true };
    }
    return null;
  }

  #wallBehind(d) { return this.world.cage.sense(d.pos, vAngle(vSub(this.attacker.pos, d.pos)), d.radius).backAgainstCage; }

  #resolve(landed) {
    if (this.attacker.mods) this.attacker.mods.takedown = 0;                       // a one-shot ability bonus is spent
    if (landed) return this.#finish('success', null);
    const { defender: d } = this;
    if (this.origin === 'clinch') return this.#finish('denied', TakedownDenial.SPRAWL);
    this.#finish('denied', this.#wallBehind(d) || d.backAgainstCage ? TakedownDenial.SPRAWL_CAGE : TakedownDenial.SPRAWL);
  }

  /** Phase III. */
  #finish(result, denial) {
    if (this.finished) return;
    this.finished = true; this.phase = 3; this.result = result; this.denial = denial;
    const { world, attacker: a, defender: d } = this, t = world.tun;
    for (const f of this.fighters) { if (f.bout === this) f.bout = null; }
    let position = null;
    if (result === 'success') {
      const scramble = this.size === 'minor';
      let top = a, bottom = d;
      if (scramble) {
        const pa = clamp(0.5 + (a.rating('groundcontrol') - d.rating('groundcontrol')) / 200 + t.takedown.scrambleInitiative, 0.2, 0.85);
        if (!world.rng('takedown').chance(pa)) { top = d; bottom = a; }
      }
      position = landingFor(this.type, scramble ? 'minor' : 'major');
      world.emit(EventType.TAKEDOWN, { attacker: a.id, defender: d.id, phase: 'result', move: this.type, size: this.size, direction: this.dir, result: 'success', denial: null, position, slam: SLAMS.has(moveFamily(this.type)) });
      new GroundBout(world, top, bottom, position, { reason: 'takedown' });
      if (SLAMS.has(moveFamily(this.type))) applySlam(world, a, bottom, this.type);
      return;
    }
    if (result === 'missed') {
      world.emit(EventType.TAKEDOWN, { attacker: a.id, defender: d.id, phase: 'result', move: this.type, size: this.size, direction: this.dir, result: 'missed', denial, position: null });
      this.#backToStandup();
      a.action = { move: SHOT_MISS, tick: 0, startTick: world.tick, frames: { startup: 0, active: 0, recovery: t.takedown.recoveryMiss }, extraRecovery: 0, resolved: true, chargeFrac: 0, hitStop: 0, fromCancel: false };
      return;
    }
    // denied
    position = denial === TakedownDenial.SPRAWL ? G.SPRAWL : null;
    world.emit(EventType.TAKEDOWN, { attacker: a.id, defender: d.id, phase: 'result', move: this.type, size: this.size, direction: this.dir, result: 'denied', denial, position });
    if (denial === TakedownDenial.SPRAWL && this.origin === 'standup') {
      new GroundBout(world, d, a, G.SPRAWL, { reason: 'sprawl' });                         // defender on top of the failed shooter
    } else if (denial === TakedownDenial.SPRAWL_CAGE) {
      const bout = new ClinchBout(world, a, d, 'double_under', { initiator: a });         // cage battle: shooter keeps the lock-up, defender pinned
      a.fenceDominance = true; d.backAgainstCage = true;
      bout.pushTicks = 30;
    } else if (this.origin === 'clinch') {                                                // stuffed throw: back to the same clinch
      new ClinchBout(world, this.role === 'dom' ? a : d, this.role === 'dom' ? d : a, this.position ?? 'over_under', { initiator: a, silent: true });
      a.cooldowns.clinch = t.clinch.actionCooldownTicks;
    } else {
      this.#backToStandup();                                                              // countered strike: back to stand-up
    }
  }

  #backToStandup() {
    const { attacker: a, defender: d } = this;
    for (const f of this.fighters) { f.mode = Mode.STANDUP; f.bout = null; f.action = null; f.vel = { x: 0, y: 0 }; }
    const { world } = this;
    // separate to a neutral gap so nobody starts overlapped
    const dist = a.radius + d.radius + 0.35, mid = { x: (a.pos.x + d.pos.x) / 2, y: (a.pos.y + d.pos.y) / 2 };
    const axis = vAngle(vSub(d.pos, a.pos)), u = vFromAngle(axis);
    a.pos = world.cage.clamp({ x: mid.x - u.x * dist / 2, y: mid.y - u.y * dist / 2 }, a.radius).pos;
    d.pos = world.cage.clamp({ x: mid.x + u.x * dist / 2, y: mid.y + u.y * dist / 2 }, d.radius).pos;
    a.facing = axis; d.facing = axis + Math.PI;
  }

  /** Abort from outside (e.g. a fighter was knocked out mid-shot). Keeps attempted == landed + denied + missed. */
  end() {
    if (this.finished) return;
    this.finished = true; this.phase = 3; this.result = 'denied'; this.denial = TakedownDenial.UNKNOWN;
    this.world.emit(EventType.TAKEDOWN, { attacker: this.attacker.id, defender: this.defender.id, phase: 'result', move: this.type, size: this.size, direction: this.dir, result: 'denied', denial: TakedownDenial.UNKNOWN, position: null });
    this.#backToStandup();
  }

  timeKeys() { return ['time.takedown']; }

  hashNumbers() { return [2, this.phase, this.ticks, this.attacker.index, this.sprawling ? 1 : 0]; }
}

/** Slam / suplex impact: body damage 2–5 % of the pool and a small stun/liver chance (docs/08 §3.3). */
export function applySlam(world, att, def, type) {
  const [lo, hi] = world.tun.takedown.slamDamageFraction;
  const taken = def.pools.body.max * world.rng('hit').range(lo, hi);
  def.damagePool('body', taken);
  def.logDamage(world.tick, taken);
  const r = evaluateLadder({
    attacker: att, defender: def, region: 'body', move: { power: 'heavy', eventMult: 0.8 }, taken, poolCurAfter: def.pools.body.cur,
    seed: world.rng('event').nextInt32(), tun: world.tun, strikesReceivedRound: world.stats.strikesReceivedThisRound(def.id),
  });
  if (r.event !== 'none') world.healthEvent(def, att, r.event, 'body');
  return { taken, event: r.event };
}
