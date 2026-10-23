// Clinch (docs/07): entry contest, dom/sub roles, pair locomotion, cage pin, clinch strikes, pummel/whizzer transitions,
// takedown hand-off, break and the referee's low-action timers. A clinch is a ClinchBout: both fighters share a centre and a
// heading and normal locomotion is replaced by the pair rules below (docs/17 §5).

import { ClinchPosition as P, ClinchRole as R, CLINCH_TAKEDOWNS, Mode, toTicks, DT } from '../core/taxonomy.js';
import { clamp, vAngle, vFromAngle, vDot, vLen, rad } from '../core/math.js';
import { EventType } from '../sim/events.js';
import { skillAdd } from './skills.js';
import { actionStaminaCost } from './stamina.js';
import { applyImpact } from './impact.js';
import { TakedownBout } from './takedown.js';

export const clinchRating = (f) => f.rating('clinchcontrol') + skillAdd(f, 'clinch');

/** Pummel / position-change graph (observed positions, our edges). Every position has an exit and every target exists. */
export const CLINCH_TRANSITIONS = Object.freeze({
  [P.OVER_UNDER]: [P.DOUBLE_UNDER, P.SINGLE_COLLAR],
  [P.DOUBLE_UNDER]: [P.OVER_UNDER, P.BACK_CLINCH],
  [P.SINGLE_COLLAR]: [P.OVER_UNDER, P.THAI],
  [P.THAI]: [P.SINGLE_COLLAR],
  [P.BACK_CLINCH]: [P.DOUBLE_UNDER],
});

/** Positions where only the dominant fighter may strike / attempt takedowns (the sub is controlled). */
const DOM_ONLY = new Set([P.THAI, P.BACK_CLINCH]);
const STRIKES = ['knee', 'elbow', 'uppercut', 'hook', 'shoulder', 'stomp'];

export function getAvailableTakedowns(position, role) { return [...(CLINCH_TAKEDOWNS[position]?.[role] ?? [])]; }

// ---- entry ----------------------------------------------------------------------------------------------------------

export function clinchEntryProbability(att, def, tun, { defenderStriking = false, defenderGuardHigh = false } = {}) {
  const c = tun.clinch;
  const p = c.entryBase + c.entryPerRating * (clinchRating(att) - clinchRating(def))
    - (defenderStriking ? c.entryStrikingPenalty : 0) - (defenderGuardHigh ? c.entryGuardPenalty : 0);
  return clamp(p, c.entryMin, c.entryMax);
}

/** P(attacker ends up dominant) — roles follow the rating spread, not who initiated (docs/07 §3.1). */
export function domProbability(att, def, tun) {
  const c = tun.clinch;
  return clamp(c.domBase + c.domPerRating * (clinchRating(att) - clinchRating(def)), c.domMin, c.domMax);
}

const WRESTLERS = new Set(['freestyle_wrestler', 'greco_roman_wrestler', 'judo', 'jiu_jutsu']);
export function allowedEntryTypes(f) {
  const t = [P.OVER_UNDER, P.SINGLE_COLLAR];
  if (WRESTLERS.has(f.style) || f.tendency === 'bjj_fighter' || f.tendency === 'rounded_clincher') t.push(P.DOUBLE_UNDER);
  if (f.style === 'muay_thai' || f.style === 'kickboxer' || f.tendency === 'thai_clincher') t.push(P.THAI);
  return t;
}
export function chooseClinchType(f, hint) {
  const ok = allowedEntryTypes(f);
  if (hint && ok.includes(hint)) return hint;
  if (f.style === 'muay_thai' || f.tendency === 'thai_clincher') return P.THAI;
  if (WRESTLERS.has(f.style)) return P.DOUBLE_UNDER;
  return P.OVER_UNDER;
}

/** Pure legality check — `reason` is set when not ok. */
export function canAttemptClinch(world, att, def) {
  if (att.mode !== Mode.STANDUP || def.mode !== Mode.STANDUP) return { ok: false, reason: 'mode' };
  if (att.isHelpless() || att.busy() || att.heldLeg || att.trapped > 0) return { ok: false, reason: 'busy' };
  if (att.cooldowns.clinch > 0) return { ok: false, reason: 'cooldown' };
  return { ok: true, reason: null };
}

/**
 * Try to clinch. Returns {outcome:'success'|'denied'|'missed'|null, bout?}; null = illegal, nothing happened.
 * missed = out of range · denied = defender broke it up · success = ClinchBout created.
 */
export function attemptClinch(world, att, def, { type, defenderStriking, defenderGuardHigh } = {}) {
  const legal = canAttemptClinch(world, att, def);
  if (!legal.ok) return { outcome: null, reason: legal.reason };
  const c = world.tun.clinch;
  att.spendStamina(2);
  att.cooldowns.clinch = c.actionCooldownTicks;
  if (world.gap(att, def) > c.range) {
    world.emit(EventType.CLINCH_ATTEMPT, { attacker: att.id, defender: def.id, outcome: 'missed' });
    return { outcome: 'missed' };
  }
  const striking = defenderStriking ?? (def.busy() && def.action.move.mode !== 'clinch');
  const guardHigh = defenderGuardHigh ?? def.guard.state === 'high';
  const p = def.isHelpless() ? 1 : clinchEntryProbability(att, def, world.tun, { defenderStriking: striking, defenderGuardHigh: guardHigh });
  if (!world.rng('clinch').chance(p)) {
    def.counterWindow = Math.max(def.counterWindow, world.tun.defense.counterWindowTicks);
    att.recoveryExtra = 8;
    world.emit(EventType.CLINCH_ATTEMPT, { attacker: att.id, defender: def.id, outcome: 'denied' });
    return { outcome: 'denied' };
  }
  const attDom = world.rng('clinch').chance(domProbability(att, def, world.tun));
  world.emit(EventType.CLINCH_ATTEMPT, { attacker: att.id, defender: def.id, outcome: 'success' });
  const bout = new ClinchBout(world, attDom ? att : def, attDom ? def : att, chooseClinchType(att, type), { initiator: att });
  return { outcome: 'success', bout };
}

// ---- the bout -------------------------------------------------------------------------------------------------------

export class ClinchBout {
  constructor(world, dom, sub, position, { initiator = dom, silent = false } = {}) {
    this.kind = 'clinch';
    this.world = world;
    this.dom = dom; this.sub = sub;
    this.a = world.fighters[0]; this.b = world.fighters[1];
    this.position = position;
    this.initiator = initiator;
    this.finished = false;
    this.ticks = 0; this.idleTicks = 0; this.warned = false;
    this.pushTicks = 0; this.whizzer = 0;
    this.moveIntent = new Map([[dom.id, { x: 0, y: 0 }], [sub.id, { x: 0, y: 0 }]]);
    this.guardIntent = new Map([[dom.id, 'none'], [sub.id, 'none']]);
    this.distance = (dom.radius + sub.radius) * 0.9;
    const mid = { x: (dom.pos.x + sub.pos.x) / 2, y: (dom.pos.y + sub.pos.y) / 2 };
    this.centre = mid;
    this.axis = vAngle({ x: sub.pos.x - dom.pos.x, y: sub.pos.y - dom.pos.y }); // dom → sub
    for (const f of [dom, sub]) {
      f.mode = Mode.CLINCH; f.bout = this; f.action = null; f.vel = { x: 0, y: 0 };
      f.guard = { state: 'none', timeUp: 0 }; f.parryTicks = 0; f.slipTicks = 0; f.catchTicks = 0;
    }
    dom.groundRole = R.DOM; sub.groundRole = R.SUB;
    this.#place();
    if (!silent) world.emit(EventType.CLINCH_START, { dom: dom.id, sub: sub.id, position, cage: false });
  }

  other(f) { return f === this.dom ? this.sub : this.dom; }
  roleOf(f) { return f === this.dom ? R.DOM : R.SUB; }
  get fighters() { return [this.a, this.b]; }
  get pinned() { return this.dom.fenceDominance; }

  #place() {
    const u = vFromAngle(this.axis), h = this.distance / 2;
    this.dom.pos = { x: this.centre.x - u.x * h, y: this.centre.y - u.y * h };
    this.sub.pos = { x: this.centre.x + u.x * h, y: this.centre.y + u.y * h };
    this.dom.facing = this.axis; this.sub.facing = this.axis + Math.PI;
  }

  // ---- intents ----
  applyIntent(f, intent) {
    this.moveIntent.set(f.id, f.isHelpless() ? { x: 0, y: 0 } : intent.move);
    this.guardIntent.set(f.id, f.isHelpless() ? 'none' : intent.guard);
    const g = intent.grapple;
    if (!g || f.isHelpless() || f.busy() || f.cooldowns.clinch > 0) return false;
    switch (g.kind) {
      case 'strike': return this.strike(f, g.strike, g.target);
      case 'pummel': return this.pummel(f, g.to);
      case 'whizzer': return this.whizzerUp(f);
      case 'takedown': return this.takedown(f, g.move);
      case 'break': return this.tryBreak(f);
      default: return false;
    }
  }

  clinchMoves() { return this.world.moveBook.all().filter((m) => m.mode === 'clinch'); }
  #strikeMove(name, target) {
    return this.clinchMoves().find((m) => m.tags.includes(name) && (!target || m.target === target))
      ?? this.clinchMoves().find((m) => m.tags.includes(name)) ?? null;
  }
  canStrike(f) { return !DOM_ONLY.has(this.position) || f === this.dom; }

  /** Everything this fighter may legally do right now (AI and UI use this; the sim re-validates anyway). */
  legalActions(f) {
    if (this.finished || f.isHelpless() || f.busy() || f.cooldowns.clinch > 0) return [];
    const out = [];
    const role = this.roleOf(f);
    if (this.canStrike(f)) {
      for (const name of STRIKES) {
        for (const m of this.clinchMoves().filter((x) => x.tags.includes(name))) {
          if (f.stamina >= actionStaminaCost(f, m.stamina)) out.push({ kind: 'strike', strike: name, target: m.target, moveId: m.id });
        }
      }
    }
    for (const to of CLINCH_TRANSITIONS[this.position]) out.push({ kind: 'pummel', to });
    if (role === R.SUB && this.position !== P.THAI) out.push({ kind: 'whizzer' });
    if (this.canStrike(f)) for (const move of getAvailableTakedowns(this.position, role)) if (f.stamina >= this.world.tun.takedown.minStamina) out.push({ kind: 'takedown', move });
    out.push({ kind: 'break' });
    return out;
  }

  // ---- actions ----
  strike(f, name, target) {
    if (!this.canStrike(f)) return false;
    const move = this.#strikeMove(name, target);
    if (!move) return false;
    const { world } = this;
    f.action = { move, tick: 0, startTick: world.tick, frames: f.scaledFrames(move), extraRecovery: 0, resolved: false, chargeFrac: 0, hitStop: 0, fromCancel: false };
    f.spendStamina(actionStaminaCost(f, move.stamina));
    f.logStrike(world.tick);
    f.cooldowns.clinch = 0;
    return true;
  }

  /** Called by the sim when a clinch strike reaches its active phase. */
  resolveAction(f) {
    const a = f.action;
    if (!a || a.resolved) return null;
    a.resolved = true;
    const { world } = this, c = world.tun.clinch;
    const target = this.other(f);
    const move = a.move;
    let mult = c.positionStrikeMult[this.position] ?? 1;
    if (f === this.sub) mult *= c.subStrikeMult;
    const plumKnee = this.position === P.THAI && move.target === 'head' && move.tags.includes('knee');
    if (plumKnee) mult *= c.plumHeadKneeMult;
    let defense = { outcome: 'hit', mitigation: 0, strong: false };
    if (this.guardIntent.get(target.id) !== 'none' && !target.isHelpless()) {
      const m = c.subBlockStrength * (0.8 + 0.4 * target.rating('blocking') / 100);
      defense = { outcome: 'blocked', mitigation: clamp(m, 0, 0.9), strong: false };
    }
    const r = applyImpact(world, f, target, move, defense, { mode: 'clinch', ctx: { damageMult: mult }, bonusByEvent: plumKnee ? { stun: c.plumStunBonus } : null });
    if (r.ev.significant) { this.idleTicks = 0; this.warned = false; }                 // only meaningful strikes count as action for the referee
    return r;
  }

  pummel(f, to) {
    const { world } = this, c = world.tun.clinch;
    const other = this.other(f);
    f.cooldowns.clinch = c.actionCooldownTicks;
    f.spendStamina(1.5);
    const score = (x) => clinchRating(x) + 0.5 * x.rating('movement');
    const p = clamp(c.pummelBase + c.pummelPerRating * (score(f) - score(other)), 0.1, 0.9);
    this.idleTicks = 0; this.warned = false;
    if (!world.rng('clinch').chance(p)) return false;
    const from = this.position;
    if (f === this.sub) {
      this.dom = f; this.sub = other; f.groundRole = R.DOM; other.groundRole = R.SUB;       // underhooks won: roles swap
      this.axis = vAngle({ x: other.pos.x - f.pos.x, y: other.pos.y - f.pos.y });
      this.#place();
      world.emit(EventType.CLINCH_TRANSITION, { actor: f.id, from: R.SUB, to: R.DOM, style: 'pummel' });
    } else {
      const options = CLINCH_TRANSITIONS[from];
      const next = options.includes(to) ? to : options[world.rng('clinch').int(options.length)];
      this.position = next;
      world.emit(EventType.CLINCH_TRANSITION, { actor: f.id, from, to: next, style: 'pummel' });
    }
    return true;
  }

  whizzerUp(f) {
    if (f !== this.sub || this.position === P.THAI) return false;
    f.cooldowns.clinch = this.world.tun.clinch.actionCooldownTicks;
    f.spendStamina(1.5);
    this.whizzer = 90;
    this.world.emit(EventType.CLINCH_TRANSITION, { actor: f.id, from: this.position, to: this.position, style: 'whizzer' });
    return true;
  }

  takedown(f, move) {
    const { world } = this;
    const role = this.roleOf(f);
    if (!getAvailableTakedowns(this.position, role).includes(move) || !this.canStrike(f)) return false;
    if (f.stamina < world.tun.takedown.minStamina) return false;
    f.cooldowns.clinch = world.tun.clinch.actionCooldownTicks;
    const info = { position: this.position, role, cage: this.pinned && role === R.DOM, whizzer: this.whizzer > 0, from: 'clinch' };
    this.release({ restore: false });
    new TakedownBout(world, f, this.other(f), { type: move, origin: 'clinch', ...info });
    return true;
  }

  tryBreak(f) {
    const { world } = this, c = world.tun.clinch;
    const other = this.other(f);
    f.cooldowns.clinch = c.actionCooldownTicks;
    let p = f === this.dom ? 1 : clamp(c.breakBase + c.breakPerRating * (clinchRating(f) - clinchRating(other)), 0.05, 0.95);
    if (f === this.sub && this.pinned) p -= c.cageEscapePenalty;
    if (!world.rng('clinch').chance(clamp(p, 0.05, 1))) return false;
    this.end(f === this.dom ? 'released' : 'escaped');
    return true;
  }

  // ---- per tick ----
  update() {
    if (this.finished) return { ended: true };
    const { world } = this, c = world.tun.clinch, tun = world.tun;
    this.ticks += 1; this.idleTicks += 1;
    for (const f of this.fighters) if (f.cooldowns.clinch > 0) f.cooldowns.clinch -= 1;
    if (this.whizzer > 0) this.whizzer -= 1;

    // stamina: the dom works, the sub resists (plum costs more)
    const domCost = this.position === P.THAI ? c.staminaPerSecPlum : c.staminaPerSecDom;
    this.dom.spendStamina(domCost * DT); this.sub.spendStamina(c.staminaPerSecSub * DT);

    // pair locomotion: dom drives, sub may resist when it is nearly as good a clincher
    const mv = (x) => this.moveIntent.get(x.id) ?? { x: 0, y: 0 };
    const k = clinchRating(this.sub) >= clinchRating(this.dom) - 10 ? c.resistK : 0;
    const v = { x: mv(this.dom).x * (1 - k) + mv(this.sub).x * k, y: mv(this.dom).y * (1 - k) + mv(this.sub).y * k };
    const speed = tun.fighter.baseSpeed * c.pairSpeedMult * this.dom.moveSpeedMult();
    const mag = Math.min(1, vLen(v));
    if (mag > 1e-3) {
      const step = { x: (v.x / vLen(v)) * speed * mag * DT, y: (v.y / vLen(v)) * speed * mag * DT };
      this.centre = { x: this.centre.x + step.x, y: this.centre.y + step.y };
      const lateral = -v.x * Math.sin(this.axis) + v.y * Math.cos(this.axis);        // component across the pair axis
      this.axis += clamp(lateral, -1, 1) * rad(1.2);                                  // circling in the clinch
    }
    const wall = world.cage.nearestWall(this.centre);
    const pushing = mv(this.dom).x * wall.normalOut.x + mv(this.dom).y * wall.normalOut.y > 0.3;
    this.pushTicks = pushing ? Math.min(this.pushTicks + 1, 60) : Math.max(0, this.pushTicks - 1);
    const clamped = world.cage.clamp(this.centre, this.distance / 2 + this.dom.radius);
    this.centre = clamped.pos;
    const pin = wall.gap < c.cagePinDistance && this.pushTicks > 10;
    if (pin && !this.dom.fenceDominance) {
      this.axis = vAngle(wall.normalOut);                                             // sub's back to the fence
      world.emit(EventType.CLINCH_TRANSITION, { actor: this.dom.id, from: 'open', to: 'cage', style: 'pin' });
    }
    if (!pin && wall.gap > c.cagePinDistance * 1.4) { this.dom.fenceDominance = false; this.sub.backAgainstCage = false; }
    if (pin) { this.dom.fenceDominance = true; this.sub.backAgainstCage = true; }
    this.#place();

    // referee timers (docs/07 §3.4): no damaging action → warning, then break
    if (!this.warned && this.idleTicks >= toTicks(c.lowActionWarnSeconds)) {
      this.warned = true;
      world.emit(EventType.REFEREE, { kind: 'low_action', mode: 'clinch' });
    }
    if (this.idleTicks >= toTicks(c.breakSeconds)) {
      world.emit(EventType.REFEREE, { kind: 'break', mode: 'clinch' });
      this.end('referee_break');
      return { ended: true, reason: 'referee_break' };
    }
    return null;
  }

  /** Take the fighters out of the bout. restore=false is a hand-off to another bout (it sets modes itself). */
  release({ restore = true, gap } = {}) {
    if (this.finished) return;
    this.finished = true;
    for (const f of this.fighters) {
      if (f.bout === this) f.bout = null;
      f.groundRole = null; f.fenceDominance = false; f.backAgainstCage = false;
    }
    if (!restore) return;
    const { world } = this;
    const dist = this.dom.radius + this.sub.radius + (gap ?? world.tun.clinch.breakGap);
    const u = vFromAngle(this.axis), h = dist / 2;
    const place = (f, sgn) => {
      const p = world.cage.clamp({ x: this.centre.x + u.x * h * sgn, y: this.centre.y + u.y * h * sgn }, f.radius).pos;
      f.pos = p;
    };
    place(this.dom, -1); place(this.sub, 1);
    for (const f of this.fighters) {
      if (f.mode === Mode.CLINCH) f.mode = Mode.STANDUP;
      f.action = null;
    }
    this.dom.facing = vAngle({ x: this.sub.pos.x - this.dom.pos.x, y: this.sub.pos.y - this.dom.pos.y });
    this.sub.facing = this.dom.facing + Math.PI;
    for (const f of this.fighters) f.cooldowns.clinch = Math.max(f.cooldowns.clinch, world.tun.clinch.actionCooldownTicks);
  }

  end(reason, opts) {
    if (this.finished) return;
    this.release(opts);
    this.world.emit(EventType.CLINCH_BREAK, { dom: this.dom.id, sub: this.sub.id, reason });
  }

  /** stat buckets this fighter's time is booked to (the FightSim books exactly one bucket set per tick) */
  timeKeys(f) { return [f === this.dom ? 'time.clinch.dom' : 'time.clinch.sub']; }

  hashNumbers() {
    return [1, Object.values(P).indexOf(this.position), this.ticks, this.idleTicks, this.dom.index, this.centre.x, this.centre.y, this.axis, this.whizzer];
  }
}
