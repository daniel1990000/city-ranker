// Fighter brain (docs/13 §2): perception → aggression → goal draw → plan → intents, with a reaction-delayed defence model.
// A Brain only ever returns an Intent frame (the same currency a human controller produces) and is deterministic: all its
// randomness comes from the world's named stream `ai.<fighterId>`.

import { emptyIntent } from '../input/intent.js';
import { buildSituation } from '../core/situation.js';
import { Mode } from '../core/taxonomy.js';
import { vNorm, vSub, clamp } from '../core/math.js';
import { aggressionLevel, gapTicks } from './aggression.js';
import { tendencyProfile, goalScoreTable, GOALS } from './tendencies.js';
import { difficultyProfile, reactionDelay, defendProbability, sharpness } from './difficulty.js';
import { canStartStrike } from '../combat/strike.js';
import { actionStaminaCost } from '../combat/stamina.js';
import { requiredGuard, canCatch, parryWindow } from '../combat/defense.js';
import { canStartShot } from '../combat/takedown.js';
import { canAttemptClinch } from '../combat/clinch.js';

const SPECIAL_SLOTS = new Set(['sig', 'sig_fwd', 'sig_bwd', 'tech', 'tech_fwd', 'tech_bwd', 'tech_sig']);
const perp = (v) => ({ x: -v.y, y: v.x });
const mix = (a, b, t) => ({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t });

export class Brain {
  constructor(world, fighter, opts = {}) {
    this.world = world; this.f = fighter;
    this.rng = world.rng(`ai.${fighter.id}`);
    this.diff = opts.difficulty ?? fighter.spec.difficulty ?? 'pro';
    this.profile = difficultyProfile(this.diff, world.tun);
    this.tend = tendencyProfile(fighter.tendency);
    this.A = 0.5;
    this.plan = null; this.nextDecision = 0;
    this.seen = null; this.response = null;
    this.guardHold = 'none';
    this.forcedGoal = null; this.plannerBias = 0; this.lastGoal = null;
    this.circle = this.rng.chance(0.5) ? 1 : -1;
    this.tdSeen = null; this.sprawlOk = false;
    this.coverUntil = 0; this.groundSeen = null;
    this.nextGuardRoll = 0;
    this.boutSeen = null; this.boutStart = 0; this.boutBudget = 0;
  }

  /** each new clinch / ground bout gets a time budget; afterwards the AI works to end it (clinchers stay longer) */
  #boutClock() {
    const { world, f } = this;
    if (this.boutSeen !== f.bout) {
      this.boutSeen = f.bout; this.boutStart = world.tick;
      const clincher = f.tendency === 'thai_clincher' || f.tendency === 'rounded_clincher' || f.tendency === 'dirty_boxer' ? 1.6 : 1;
      const sprawl = f.bout?.kind === 'ground' && f.bout.position === 'sprawl';
      this.boutBudget = sprawl ? 60 + this.rng.int(90) : f.bout?.kind === 'ground' ? 1200 + this.rng.int(1200) : Math.round((150 + this.rng.int(450)) * clincher);
    }
    return world.tick - this.boutStart > this.boutBudget;
  }

  // ---------------------------------------------------------------------------------------------------------------
  think(ctx = {}) {
    const { f } = this;
    const sit = buildSituation(this.world, f, ctx);
    this.A = aggressionLevel(sit, f.tendency, this.world.tun, this.plannerBias);
    const i = emptyIntent();
    switch (f.mode) {
      case Mode.STANDUP: this.#standup(sit, i); break;
      case Mode.TAKEDOWN: this.#takedownMode(i); break;
      case Mode.CLINCH: this.#clinch(sit, i); break;
      case Mode.GROUND: this.#ground(sit, i); break;
      case Mode.DOWN: i.prompt = { mash: this.profile.defend }; break;
      default: break;                                          // submission minigames resolve by rule for AI sides
    }
    if (ctx.abilityBar) this.#abilities(ctx.abilityBar, i);
    return i;
  }

  /** Press a ready ability that fits the current phase now and then (result quality follows difficulty). */
  #abilities(bar, i) {
    const phase = { [Mode.STANDUP]: 'standup', [Mode.TAKEDOWN]: 'takedown', [Mode.SUBMISSION]: 'submission' }[this.f.mode];
    if (!phase || !this.rng.chance(0.01)) return;
    const slot = bar.slots.findIndex((s, k) => s.def.phase === phase && bar.ready(k));
    if (slot < 0) return;
    const r = this.rng.next(), p = this.diff === 'champion' ? 0.25 : this.diff === 'pro' ? 0.12 : 0.05;
    i.ability = { slot, result: r < p ? 'perfect' : r > 0.9 ? 'fail' : 'success' };
  }

  /** The goal table for a stand-up situation (exposed so tests can inspect the weighting). */
  goalScores(sit, { noise = true } = {}) {
    const { world, f } = this;
    const o = world.opp(f);
    const cands = this.#candidates(sit, false), special = this.#candidates(sit, true);
    const strikeFit = cands.length ? (o.action || o.status.ticks > 0 ? 1.6 : 1) * (f.counterWindow > 0 ? 1.4 : 1) : 0.35;
    const shot = canStartShot(world, f, o);
    const energy = 0.5 + 0.5 * sit.stamina;                      // tired fighters conserve energy: fewer attacks, more footwork
    const fit = {
      strike: strikeFit * energy,
      special_strike: (special.length ? strikeFit * 0.9 : 0.05) * energy,
      loco: sit.cage.backAgainstCage ? 1.8 : sit.range > 1.5 ? 1.2 : 1,
      takedown: (shot.ok ? 1.3 - 0.5 * sit.opponentStrikeActivity + (sit.opponentCage.backAgainstCage ? 0.3 : 0) : f.stamina < 20 ? 0 : sit.range < 2 ? 0.4 : 0.1) * energy,
      clinch: (sit.range <= world.tun.clinch.range ? 1 : sit.range < 1 ? 0.5 : 0.1) * energy,
      transition: 0, submission: 0,
    };
    const interest = {
      takedown: clamp((f.rating('takedown') - o.rating('takedowndefense')) / 50, -1, 1),
      clinch: clamp((f.rating('clinchcontrol') - o.rating('clinchcontrol')) / 50, -1, 1),
    };
    return goalScoreTable({ base: this.tend.goals, fit, interest, A: this.A, noise: noise ? () => 0.9 + 0.2 * this.rng.next() : () => 1 });
  }

  drawGoal(scores) {
    const idx = this.rng.weightedIndex(GOALS.map((g) => scores[g]));
    return GOALS[idx];
  }

  // ---- stand-up --------------------------------------------------------------------------------------------------
  #standup(sit, i) {
    const { world, f } = this;
    const tick = world.tick, tun = world.tun;
    if (f.bout && f.bout.kind === 'takedown') this.#sprawlDecision(f.bout, i);
    if (f.isHelpless()) { this.plan = null; return; }
    this.#perceive(sit);
    this.#applyResponse(i);

    if (this.plan && this.#planDone()) {
      const [lo, hi] = tun.ai.rePlanTicks;
      this.nextDecision = tick + (this.plan.type === 'loco' ? lo + this.rng.int(hi - lo + 1) : Math.round(gapTicks(this.A, tun) * (0.7 + 0.6 * this.rng.next())));
      this.plan = null;
    }
    if (!this.plan && tick >= this.nextDecision && !f.busy() && !this.response) this.plan = this.#makePlan(sit);
    if (this.plan) this.#runPlan(sit, i);
    else if (!f.busy() && !this.response) this.#holdRange(sit, i);

    // keep the hands up between actions (p = read quality), unless attacking
    if (i.guard === 'none' && !f.busy() && !this.response && this.guardHold !== 'none') i.guard = this.guardHold;
    if (tick >= this.nextGuardRoll) this.#rollGuard();
  }

  #rollGuard() {
    const p = defendProbability(this.profile, this.f);
    this.guardHold = this.rng.chance(p) ? (this.rng.chance(0.2) ? 'low' : 'high') : 'none';
    this.nextGuardRoll = this.world.tick + 20 + this.rng.int(25);
  }

  /** Between plans keep moving: hold the preferred distance, drifting sideways instead of standing in front of the opponent. */
  #holdRange(sit, i) {
    const { world, f } = this;
    const o = world.opp(f), toward = vNorm(vSub(o.pos, f.pos)), side = perp(toward), g = this.tend.range;
    if (sit.cage.backAgainstCage) { const c = vNorm({ x: -f.pos.x, y: -f.pos.y }); i.move = mix(c, { x: side.x * this.circle, y: side.y * this.circle }, 0.4); return; }
    if (sit.range > g + 0.25) i.move = mix(toward, { x: side.x * this.circle, y: side.y * this.circle }, 0.25);
    else if (sit.range < g - 0.25) i.move = mix({ x: -toward.x, y: -toward.y }, { x: side.x * this.circle, y: side.y * this.circle }, 0.4);
    else i.move = { x: side.x * this.circle * 0.6, y: side.y * this.circle * 0.6 };
    if (world.tick % 90 === 0 && this.rng.chance(0.4)) this.circle = -this.circle;
  }

  #perceive(sit) {
    const { world, f } = this;
    const o = world.opp(f), a = o.action;
    if (!a || o.mode !== Mode.STANDUP || a.move.mode === 'clinch' || a.move.id === 'shot_miss') { this.seen = null; return; }
    if (!this.seen || this.seen.action !== a) {
      const m = a.move;
      const inRange = sit.centreDistance - (m.advance ?? 0) <= m.reach * o.reachFactor * 1.15;
      this.seen = inRange ? { action: a, decideAt: world.tick + reactionDelay(this.rng, this.profile), decided: false } : { action: a, decided: true };
    }
    const s = this.seen;
    if (s.decided || world.tick < s.decideAt) return;
    s.decided = true;
    const remaining = a.frames.startup - a.tick;
    if (remaining <= 0) return;                                  // too late to do anything about it
    if (!this.rng.chance(defendProbability(this.profile, f))) return;
    this.#planResponse(a.move, remaining);
  }

  #planResponse(move, remaining) {
    const { world, f } = this, tick = world.tick, tun = world.tun;
    const r = this.rng.next();
    const chess = f.tendency === 'chess_master' ? 1.5 : 1;
    const punchLike = move.limb === 'punch' || move.tags.includes('teep');
    let res;
    if (move.target === 'leg') res = r < 0.2 * chess ? { kind: 'step' } : { kind: 'guard', height: 'low' };
    else if (punchLike && r < 0.28 * chess) res = { kind: 'parry', at: tick + Math.max(0, remaining - (parryWindow(f, tun) - 2)) };
    else if (move.limb === 'punch' && move.target === 'head' && r < 0.5 * chess && f.rating('movement') >= 50) res = { kind: 'slip', at: tick + Math.max(0, remaining - 4) };
    else if (move.limb === 'kick' && move.target !== 'leg' && canCatch(f) && r < 0.3) res = { kind: 'catch', at: tick + Math.max(0, remaining - 4) };
    else if (r > 1 - 0.18 * chess) res = { kind: 'step' };
    else res = { kind: 'guard', height: requiredGuard(move) };
    this.response = { ...res, until: tick + remaining + 6, from: vNorm(vSub(f.pos, this.world.opp(f).pos)) };
  }

  #applyResponse(i) {
    const r = this.response;
    if (!r) return;
    const tick = this.world.tick;
    if (tick > r.until) { this.response = null; return; }
    if (r.kind === 'guard') i.guard = r.height;
    else if (r.kind === 'step') i.move = { x: r.from.x, y: r.from.y };
    else if (tick >= r.at) { i[r.kind === 'parry' ? 'parry' : r.kind === 'slip' ? 'slip' : 'catch'] = true; if (r.kind === 'slip') i.move = mix(r.from, perp(r.from), 0.5); this.response = { ...r, kind: 'guard', height: 'high' }; }
    else i.guard = 'high';
  }

  // ---- planning ---------------------------------------------------------------------------------------------------
  #makePlan(sit) {
    const goal = this.forcedGoal ?? this.drawGoal(this.goalScores(sit));
    this.forcedGoal = null; this.lastGoal = goal;
    const tick = this.world.tick;
    switch (goal) {
      case 'strike': case 'special_strike': return this.#strikePlan(sit, goal === 'special_strike');
      case 'takedown': return { type: 'takedown', dir: this.rng.chance(0.5) ? 'fwd' : 'bwd', size: this.rng.chance(0.6) ? 'major' : 'minor', until: tick + 70 };
      case 'clinch': return { type: 'clinch', until: tick + 60 };
      default: return this.#locoPlan(sit);
    }
  }

  #locoPlan(sit) {
    const gStar = this.tend.range, tick = this.world.tick;
    let mode;
    if (sit.cage.backAgainstCage || sit.cage.pinned) mode = 'escape';
    else if (sit.range > gStar + 0.3) mode = 'approach';
    else if (sit.range < gStar - 0.3) mode = 'retreat';
    else mode = 'circle';
    if (this.rng.chance(0.2)) this.circle = -this.circle;
    return { type: 'loco', mode, until: tick + 12 + this.rng.int(18), side: this.circle };
  }

  #strikePlan(sit, special) {
    const first = this.#pickStrike(sit, { special });
    if (!first) return { type: 'loco', mode: 'approach', until: this.world.tick + 14, side: this.circle };
    const moves = [first];
    const maxLen = Math.max(1, Math.min(this.profile.maxCombo, 1 + Math.floor(this.A * this.profile.maxCombo)));
    while (moves.length < maxLen) {
      const next = this.#pickStrike(sit, { prev: moves[moves.length - 1] });
      if (!next) break;
      moves.push(next);
    }
    return { type: 'strike', moves, idx: 0, until: this.world.tick + 100 };
  }

  #feasible(sit, move) {
    const { f } = this;
    const d = sit.centreDistance - (move.advance ?? 0);
    return d <= move.reach * f.reachFactor * 0.98 && d >= (move.minReach ?? 0) && f.stamina >= actionStaminaCost(f, move.stamina);
  }

  #candidates(sit, special, prev = null) {
    const { world } = this;
    const pool = prev ? world.moveBook.chainable(prev, 'standup') : world.moveBook.all().filter((m) => (m.mode ?? 'standup') === 'standup');
    return pool.filter((m) => (SPECIAL_SLOTS.has(m.slot) === special || (prev && !special)) && this.#feasible(sit, m));
  }

  #pickStrike(sit, { special = false, prev = null } = {}) {
    let cands = this.#candidates(sit, special, prev);
    if (prev && !cands.length) cands = [];
    if (!cands.length) return null;
    const k = sharpness(this.profile), { f } = this;
    const weights = cands.map((m) => {
      const dmg = (m.damage.base + m.damage.range / 2) * (0.6 + 0.8 * f.limbPower(m.limb, m.side) / 100);
      const speed = 1 / (m.frames.startup + 0.5 * m.frames.recovery);
      const prefs = this.tend.prefs;
      const pref = (prefs.limb[m.limb] ?? 1) * m.tags.reduce((p, t) => p * (prefs.tags[t] ?? 1), 1) * (m.target === 'body' ? (prefs.tags.body ?? 1) : 1);
      return Math.pow(Math.pow(dmg, 0.8) * Math.pow(speed, 0.5) * pref * (0.9 + 0.2 * this.rng.next()), k);
    });
    return cands[this.rng.weightedIndex(weights)];
  }

  #planDone() {
    const { world, f } = this, p = this.plan, tick = world.tick;
    if (tick > p.until) return true;
    switch (p.type) {
      case 'strike': return p.idx >= p.moves.length && !f.busy();
      case 'loco': return false;
      case 'takedown': case 'clinch': return !!p.done || f.mode !== Mode.STANDUP;
      default: return true;
    }
  }

  #runPlan(sit, i) {
    const { world, f } = this, p = this.plan, o = world.opp(f);
    const toward = vNorm(vSub(o.pos, f.pos));
    switch (p.type) {
      case 'strike': {
        const move = p.moves[p.idx];
        if (!move) return;
        if (f.action && f.action.move === move) { p.idx += 1; return; }        // the sim accepted it
        if (!canStartStrike(f, move, world.tick)) return;                       // wait for the cancel window
        if (!this.#feasible(sit, move)) { if (p.idx === 0) p.until = 0; else p.idx = p.moves.length; return; }
        i.strike = { moveId: move.id, limb: move.limb, side: move.side, slot: move.slot, target: move.target, power: move.power };
        break;
      }
      case 'loco': {
        const side = perp(toward);
        if (p.mode === 'approach') i.move = toward;
        else if (p.mode === 'retreat') i.move = { x: -toward.x, y: -toward.y };
        else if (p.mode === 'circle') i.move = mix(toward, { x: side.x * p.side, y: side.y * p.side }, 0.8);
        else {                                                                    // escape the fence: head for the centre, bending around the opponent
          const centre = vNorm({ x: -f.pos.x, y: -f.pos.y });
          i.move = mix(centre, { x: side.x * p.side, y: side.y * p.side }, 0.35);
        }
        break;
      }
      case 'takedown': {
        const c = canStartShot(world, f, o);
        if (c.ok) { i.takedown = { dir: p.dir, size: p.size }; p.done = true; }
        else if (c.reason === 'range') i.move = toward;
        else p.until = 0;
        break;
      }
      case 'clinch': {
        const c = canAttemptClinch(world, f, o);
        if (!c.ok) { p.until = 0; break; }
        if (world.gap(f, o) <= world.tun.clinch.range) { i.clinch = {}; p.done = true; } else i.move = toward;
        break;
      }
      default: break;
    }
  }

  // ---- paired states -----------------------------------------------------------------------------------------------
  #sprawlDecision(bout, i) {
    if (bout.defender !== this.f || bout.phase !== 1) return;
    if (this.tdSeen !== bout) { this.tdSeen = bout; this.sprawlOk = this.rng.chance(defendProbability(this.profile, this.f) * 0.7); }
    if (this.sprawlOk) i.grapple = { kind: 'sprawl' };
  }

  #takedownMode(i) {
    const bout = this.f.bout;
    if (bout && bout.kind === 'takedown') this.#sprawlDecision(bout, i);
  }

  #weighted(options, weightOf) {
    const w = options.map(weightOf);
    if (w.every((x) => x <= 0)) return null;
    return options[this.rng.weightedIndex(w)];
  }

  #clinch(sit, i) {
    const { world, f } = this, bout = f.bout, tick = world.tick, o = world.opp(f);
    if (!bout || bout.kind !== 'clinch') return;
    if (bout.dom === f && this.rng.chance(0.02)) this.circle = -this.circle;
    if (bout.dom === f) { const wall = world.cage.nearestWall(bout.centre); i.move = this.tend.range < 0.5 && this.circle > 0 ? { x: wall.normalOut.x, y: wall.normalOut.y } : { x: 0, y: 0 }; }
    // block an incoming strike with probability = read quality
    if (o.action && o.action.tick < o.action.frames.startup && tick - (this.groundSeen ?? -99) > 10) {
      this.groundSeen = tick;
      this.coverUntil = this.rng.chance(defendProbability(this.profile, f)) ? tick + 18 : 0;
    }
    if (tick < this.coverUntil) i.guard = 'high';
    if (tick < this.nextDecision) return;
    const legal = bout.legalActions(f);
    if (!legal.length) return;
    const overstayed = this.#boutClock();
    const prefs = this.tend.prefs;
    const choice = this.#weighted(legal, (a) => {
      switch (a.kind) {
        case 'strike': return (0.6 + this.A) * (prefs.tags[a.strike] ?? 1) * (a.target === 'head' ? 1.1 : 1);
        case 'pummel': return bout.sub === f ? 0.8 : 0.25;
        case 'whizzer': return 0.1;
        case 'takedown': return 0.45 * (1 + clamp((f.rating('takedown') - o.rating('takedowndefense')) / 50, -1, 1)) * (this.tend.goals.takedown * 4 + 0.3);
        case 'break': return 0.12 + (f.staminaFraction() < 0.25 ? 0.6 : 0) + (bout.sub === f ? 0.3 : 0) + (overstayed ? 12 : 0);
        default: return 0;
      }
    });
    if (!choice) return;
    const { kind, ...rest } = choice;
    i.grapple = { kind, ...(kind === 'strike' ? { strike: rest.strike, target: rest.target } : kind === 'pummel' ? { to: rest.to } : kind === 'takedown' ? { move: rest.move } : {}) };
    this.nextDecision = tick + Math.round(gapTicks(this.A, world.tun) * 0.6 * (0.7 + 0.6 * this.rng.next()));
  }

  #ground(sit, i) {
    const { world, f } = this, bout = f.bout, tick = world.tick, o = world.opp(f);
    if (!bout || bout.kind !== 'ground') return;
    const isTop = bout.top === f;
    if (!isTop) {                                                            // covering up against ground-and-pound (read-dependent)
      const a = o.action;
      if (a && a.tick < a.frames.startup && tick - (this.groundSeen ?? -99) > 10) {
        this.groundSeen = tick;
        this.coverUntil = this.rng.chance(defendProbability(this.profile, f)) ? tick + 24 : 0;
      }
      if (tick < this.coverUntil) i.guard = 'high';
    }
    if (tick < this.nextDecision) return;
    const legal = bout.legalActions(f);
    if (!legal.length) return;
    const overstayed = this.#boutClock();
    const tp = this.tend, hold = bout.hold;
    const subBias = (tp.goals.submission * 5 + 0.25) * (isTop ? 1 : tp.bottomGame ?? 1);
    const choice = this.#weighted(legal, (a) => {
      switch (a.kind) {
        case 'strike': return isTop ? (0.4 + this.A) * (0.7 + hold * 2) * (a.target === 'head' ? 1.2 : 0.7) : 0;
        case 'transition': return a.edge === 'pass' ? 0.9 * (0.4 + tp.goals.transition * 4) : (0.7 + 0.6 * f.rating('movement') / 100) * (tp.bottomGame ?? 1);
        case 'getup': return (1.5 + f.rating('movement') / 50) * (tp.bottomGame ? 0.6 : 1);
        case 'submission': return subBias * 0.5;
        case 'posture': return tp.goals.submission * 2 + 0.2;
        case 'turtle': return 0.04;
        case 'cover': return 0;
        case 'release': return overstayed ? 14 : 0;                        // lets go only after its time budget (long for real control, short for a stuffed shot)
        default: return 0;
      }
    });
    if (!choice) return;
    const g = { kind: choice.kind };
    if (choice.kind === 'strike') { g.strike = choice.strike; g.target = choice.target; }
    if (choice.kind === 'transition') g.to = choice.to;
    if (choice.kind === 'submission') g.name = choice.name;
    i.grapple = g;
    this.nextDecision = tick + Math.round(gapTicks(this.A, world.tun) * 0.9 * (0.7 + 0.6 * this.rng.next()));
  }
}

/**
 * Scripted opponent for tutorials (docs/13 §2.7). Steps run in order, once each:
 *   { at?: tick, when?: (sit) => bool, ticks: n, intent: partial Intent }
 * A step starts at its `at` tick, when its `when` holds, or (neither given) right after the previous step ended.
 */
export class ScriptedBrain {
  constructor(world, fighter, steps) {
    this.world = world; this.f = fighter;
    this.steps = steps.map((s) => ({ ...s, started: -1 }));
    this.idx = 0; this.ran = 0;
  }
  get finished() { return this.idx >= this.steps.length; }
  think(ctx = {}) {
    const i = emptyIntent();
    const tick = this.world.tick;
    while (this.idx < this.steps.length) {
      const s = this.steps[this.idx];
      if (s.started < 0) {
        const ready = s.at !== undefined ? tick >= s.at : s.when ? s.when(buildSituation(this.world, this.f, ctx)) : true;
        if (!ready) break;
        s.started = tick;
      }
      if (tick - s.started >= s.ticks) { this.idx += 1; this.ran += 1; continue; }
      Object.assign(i, s.intent, { move: s.intent.move ? { ...s.intent.move } : i.move });
      break;
    }
    return i;
  }
}

