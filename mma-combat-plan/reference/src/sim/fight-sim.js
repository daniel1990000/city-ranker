// FightSim: the 60 Hz deterministic step that ties every system together (docs/17 §3).
//
//  1 collect intents (brains / humans / replay)      7 damage, pools, injuries, stamina
//  2 apply intents (buffering, guard, strikes …)     8 health-event ladder (inside applyImpact)
//  3 locomotion + cage                               9 bouts update, status timers, knockdown → floor, get-ups
//  4 action step (startup/active/recovery)          10 referee: KO / TKO / submission / idle
//  5 hit detection → contacts (symmetric)           11 stats, clock, state hash every 30 ticks
//  6 defence resolution (guard/parry/slip/catch)
//
// Everything random comes from named streams of the World; nothing reads wall-clock time. Per-fighter loops run in id order, except
// intent application, which alternates the order every tick so simultaneous attempts (clinch, shot) are not biased toward fighter 0.

import { World } from './world.js';
import { Match } from './match.js';
import { EventType } from './events.js';
import { ReplayRecorder } from './replay.js';
import { Referee } from '../combat/referee.js';
import { Mode, GroundPosition as G, FightResultType, MatchState, TICK_HZ } from '../core/taxonomy.js';
import { clamp, vFromAngle } from '../core/math.js';
import { emptyIntent, quantizeIntent } from '../input/intent.js';
import { InputBuffer, STRIKE_BUFFER_TICKS, DEFENSE_BUFFER_TICKS } from '../input/buffer.js';
import { stepLocomotion, separate } from './locomotion.js';
import { startStrike, tryFeint, hitTest, applyAimAssist, canStartStrike, actionPhase, Phase } from '../combat/strike.js';
import { setGuard, pressParry, pressSlip, pressCatch, resolveDefense, onDefenseSuccess, tickDefenseTimers } from '../combat/defense.js';
import { applyImpact, emitAvoided } from '../combat/impact.js';
import { tickStatus } from '../combat/health-events.js';
import { regenStamina, recoverBetweenRounds } from '../combat/stamina.js';
import { cutmanTreat } from '../combat/injuries.js';
import { attemptClinch } from '../combat/clinch.js';
import { startShot } from '../combat/takedown.js';
import { GroundBout } from '../combat/ground.js';
import { makeJudges, scoreFight, scoreDifferential } from '../combat/scoring.js';
import { AbilityBar, forceGoal } from '../combat/abilities.js';
import { Brain } from '../ai/brain.js';
import { checkIntent, resolveStrikeMove } from '../ai/legality.js';
import { DEFAULT_FIGHTERS } from '../data/default-fighters.js';

export class FightSim {
  /**
   * @param o {seed, fighters:[specA, specB], tunables, moves, rounds, roundSeconds, restSeconds, fastRest,
   *   controllers:{[id]: {think(ctx)} | false}, record (event log), replay (record intents), debug (check AI legality)}
   */
  constructor(o = {}) {
    this.opts = o;
    const { seed = 1, fighters = [DEFAULT_FIGHTERS[0], DEFAULT_FIGHTERS[1]], tunables, moves, record = false } = o;
    this.world = new World({ seed, tunables, fighters, moves, record });
    const w = this.world;
    this.referee = new Referee(w);
    this.rounds = o.rounds ?? 3;
    this.roundTicks = Math.round((o.roundSeconds ?? w.tun.referee.roundSeconds) * TICK_HZ);
    this.restTicks = Math.round((o.restSeconds ?? w.tun.referee.restSeconds) * TICK_HZ);
    this.fastRest = o.fastRest ?? true;
    this.buffers = new Map(w.fighters.map((f) => [f.id, new InputBuffer()]));
    this.controllers = new Map(w.fighters.map((f) => {
      const c = o.controllers?.[f.id];
      return [f.id, c === undefined ? new Brain(w, f, { difficulty: f.spec.difficulty }) : c || null];
    }));
    this.abilityBars = new Map(w.fighters.filter((f) => f.spec.abilities?.length).map((f) => [f.id, new AbilityBar(f.spec.abilities)]));
    this.judges = makeJudges(w.rng('judges'), w.tun);
    this.recorder = o.replay ? new ReplayRecorder(this) : null;
    this.debug = !!o.debug; this.violations = [];
    this.hashes = [];
    this.result = null; this.over = false;
    this.scoreCache = new Map();
    this.match = new Match({
      rounds: this.rounds, roundTicks: this.roundTicks, restTicks: this.restTicks,
      hooks: { onRoundStart: (r) => this.#roundStart(r), onRoundEnd: (r) => this.#roundEnd(r), onBetweenRounds: (r) => this.#betweenRounds(r), onFightOver: (p) => this.#fightOver(p) },
    });
    this.match.start();
  }

  get state() { return this.match.state; }
  get tick() { return this.world.tick; }

  /** Run until the fight is over (or `maxTicks` of fight time pass). */
  run(maxTicks = 5 * 5 * 60 * TICK_HZ + 100000) {
    let n = 0;
    while (!this.over && n++ < maxTicks) this.step();
    return this.result;
  }

  /** One simulation step. `external` = {fighterId: Intent} overrides the controllers (replays, netplay, tests). */
  step(external = null) {
    if (this.over) return false;
    const state = this.match.state;
    if (state === MatchState.BETWEEN_ROUNDS) { this.match.tickRest(); if (this.fastRest && this.match.state === MatchState.BETWEEN_ROUNDS) this.match.send('next'); return !this.over; }
    if (state === MatchState.POST_FIGHT) return false;
    if (!this.match.simRuns) return false;
    const w = this.world;
    w.tick += 1;
    const intents = this.#collectIntents(external);
    this.#applyIntents(intents);
    this.#locomotion(intents);
    this.#actions();
    this.#modes();
    this.#referee();
    this.#bookkeeping();
    return !this.over;
  }

  // ---- 1 · intents -----------------------------------------------------------------------------------------------
  #ctx(f) {
    const w = this.world;
    const cached = this.scoreCache.get(f.id);
    let diff = cached?.v ?? 0;
    if (!cached || w.tick - cached.tick >= TICK_HZ) {
      const rounds = Array.from({ length: this.match.round }, (_, i) => i + 1);
      diff = scoreDifferential(w.stats, f, w.opp(f), rounds, w.tun);
      this.scoreCache.set(f.id, { tick: w.tick, v: diff });
    }
    return { elapsedTicks: this.match.elapsed, roundTicks: this.roundTicks, round: this.match.round, rounds: this.rounds, scoreDifferential: diff, abilityBar: this.abilityBars.get(f.id) ?? null };
  }

  #collectIntents(external) {
    const w = this.world, out = new Map();
    for (const f of w.fighters) {
      let intent = external?.[f.id];
      if (intent) intent = { ...emptyIntent(), ...intent };
      else {
        const c = this.controllers.get(f.id);
        intent = c ? c.think(this.#ctx(f)) : emptyIntent();
        if (this.debug) for (const v of checkIntent(w, f, intent)) this.violations.push({ tick: w.tick, fighter: f.id, violation: v });
      }
      intent = quantizeIntent(intent);
      out.set(f.id, intent);
      this.recorder?.record(w.tick, f.id, intent);
    }
    return out;
  }

  // ---- 2 · apply -------------------------------------------------------------------------------------------------
  #applyIntents(intents) {
    const w = this.world;
    for (const bar of this.abilityBars.values()) bar.tick();
    // alternate who is processed first each tick so simultaneous clinch / shot attempts are not biased toward fighter 0
    const order = w.tick % 2 === 0 ? w.fighters : [w.fighters[1], w.fighters[0]];
    for (const f of order) {
      const intent = intents.get(f.id);
      f.intent = intent;
      this.#tickTimers(f);
      if (f.mode === Mode.FINISHED) continue;
      if (intent.ability) this.#useAbility(f, intent.ability);
      if (f.mode === Mode.STANDUP) this.#standupIntent(f, intent);
      if (f.bout && !f.bout.finished) f.bout.applyIntent(f, intent);
      if (intent.grapple?.kind === 'release' && f.heldLeg) this.#releaseCatch(f, 'released');
      if (intent.grapple?.kind === 'followUp') this.#followUp(f);
    }
  }

  #tickTimers(f) {
    tickDefenseTimers(f);
    for (const [k, v] of Object.entries(f.cooldowns)) {
      const inOwn = f.bout && ((k === 'clinch' && f.bout.kind === 'clinch') || ((k === 'ground' || k === 'submission') && f.bout.kind === 'ground'));
      if (v > 0 && !inOwn) f.cooldowns[k] = v - 1;
    }
    if (f.heldLeg && f.heldLeg.ticks <= 0) this.#releaseCatch(f, 'timeout');
  }

  #releaseCatch(f, reason) {
    const w = this.world, kicker = w.byId(f.heldLeg.from);
    f.heldLeg = null;
    if (kicker) kicker.trapped = 0;
    w.emit(EventType.CATCH_RELEASE, { fighter: f.id, reason });
  }

  #standupIntent(f, intent) {
    const w = this.world, tun = w.tun, tick = w.tick, buf = this.buffers.get(f.id), o = w.opp(f);
    const act = f.action ? actionPhase(f.action) : null;
    setGuard(f, act === Phase.STARTUP || act === Phase.ACTIVE ? 'none' : intent.guard);
    if (intent.parry) buf.push(tick, 'parry');
    if (intent.slip) buf.push(tick, 'slip');
    if (intent.catch) buf.push(tick, 'catch');
    for (const [kind, press] of [['parry', pressParry], ['slip', pressSlip], ['catch', pressCatch]]) {
      if (buf.latest(kind, tick, DEFENSE_BUFFER_TICKS) && press(f, tun)) buf.consume(kind, tick, DEFENSE_BUFFER_TICKS);
    }
    if (intent.switchStance && f.stanceSwitchTicks === 0 && !f.busy() && !f.isHelpless()) {
      f.stance = f.stance === 'orthodox' ? 'southpaw' : 'orthodox';
      f.stanceSwitchTicks = 14; f.spendStamina(tun.stamina.switchStanceCost);
      w.emit(EventType.STANCE_SWITCH, { fighter: f.id });
    }
    if (intent.feint && tryFeint(f)) w.emit(EventType.FEINT, { fighter: f.id });
    if (intent.strike) buf.push(tick, 'strike', intent.strike);
    const req = buf.latest('strike', tick, STRIKE_BUFFER_TICKS);
    if (req) {
      const move = resolveStrikeMove(w, { strike: req.payload });
      if (!move) buf.consume('strike', tick, STRIKE_BUFFER_TICKS);
      else if (canStartStrike(f, move, tick)) {
        buf.consume('strike', tick, STRIKE_BUFFER_TICKS);
        const a = startStrike(f, move, tick, tun, { chargeTicks: req.payload.chargeTicks ?? 0 });
        a.counter = f.counterWindow > 0; if (a.counter) f.counterWindow = 0;
        a.mods = f.mods.strike; f.mods.strike = null;
        f.logStrike(tick); f.lastActionTick = tick;
      }
    }
    if (intent.clinch && !f.busy()) attemptClinch(w, f, o, { type: intent.clinch.type });
    if (intent.takedown) startShot(w, f, o, intent.takedown);
  }

  #useAbility(f, { slot = 0, result = 'success' }) {
    const w = this.world, bar = this.abilityBars.get(f.id);
    if (!bar) return;
    const r = bar.use(slot, result);
    if (!r.ok) return;
    w.emit(EventType.ABILITY, { fighter: f.id, ability: r.id, result: r.result });
    const e = r.effect;
    if (e.staminaRestore) f.stamina = Math.min(f.maxStamina, f.stamina + e.staminaRestore);
    if (e.damageScale !== undefined || e.critBonus || e.stunBonus) f.mods.strike = { damageScale: e.damageScale ?? 1, critBonus: e.critBonus ?? 0, stunBonus: e.stunBonus ?? 0 };
    if (e.takedownBonus) f.mods.takedown = e.takedownBonus;
    if (e.submissionBonus) f.mods.submission = e.submissionBonus;
    const c = this.controllers.get(f.id);
    if (c instanceof Brain && r.aiGoal && forceGoal({ consumed: true, procChance: w.tun.ai.cardProcChance, random: w.rng('ai.cards').next() })) c.forcedGoal = r.aiGoal;
  }

  #followUp(f) {
    const w = this.world, o = w.opp(f);
    if (f.mode !== Mode.STANDUP || o.mode !== Mode.DOWN || f.isHelpless() || f.bout) return;
    if (w.tick - o.downTick > w.tun.ground.downedFollowUpTicks || w.gap(f, o) > 1.0) return;
    new GroundBout(w, f, o, G.DOWNED, { reason: 'follow_up' });
  }

  // ---- 3 · locomotion --------------------------------------------------------------------------------------------
  #locomotion() {
    const w = this.world, tun = w.tun;
    const [a, b] = w.fighters;
    for (const f of w.fighters) {
      if (f.mode !== Mode.STANDUP) continue;
      const o = w.opp(f);
      const act = f.action ? actionPhase(f.action) : null;
      const locked = act === Phase.STARTUP || act === Phase.ACTIVE || f.stanceSwitchTicks > 0 || f.trapped > 0;
      stepLocomotion(f, o, f.intent.move, tun, { locked, speedMult: act === Phase.RECOVERY ? 0.5 : 1 });
      if (act === Phase.STARTUP && f.action.move.advance) {                   // lunge: close the distance during the wind-up
        const step = f.action.move.advance / Math.max(1, f.action.frames.startup), u = vFromAngle(f.facing);
        f.pos = { x: f.pos.x + u.x * step, y: f.pos.y + u.y * step };
      }
    }
    if (a.mode === Mode.STANDUP && b.mode === Mode.STANDUP) separate(a, b);
    for (const f of w.fighters) {
      if (f.mode === Mode.STANDUP || (f.mode === Mode.TAKEDOWN && f.bout?.phase === 1)) {
        const c = w.cage.clamp(f.pos, f.radius);
        f.pos = c.pos;
      }
    }
  }

  // ---- 4/5 · actions and contacts --------------------------------------------------------------------------------
  #strikable(def) {
    return def.mode === Mode.STANDUP || (def.mode === Mode.TAKEDOWN && def.bout?.kind === 'takedown' && def.bout.phase === 1 && def.bout.attacker === def);
  }

  #actions() {
    const w = this.world, tun = w.tun;
    const contacts = [];
    for (const f of w.fighters) {
      const a = f.action;
      if (!a) continue;
      a.tick += 1;
      const phase = actionPhase(a);
      const o = w.opp(f);
      if (!a.move.damage) { if (phase === Phase.DONE) f.action = null; continue; }       // pseudo-actions (missed shot recovery)
      if (f.mode === Mode.STANDUP) {
        if (phase === Phase.STARTUP) applyAimAssist(f, o, a.move, tun);
        else if (phase === Phase.ACTIVE && !a.resolved && this.#strikable(o) && hitTest(f, o, a.move).hit) contacts.push({ att: f, def: o, move: a.move, action: a });
        if ((phase === Phase.RECOVERY || phase === Phase.DONE) && !a.resolved) { a.resolved = true; emitAvoided(w, f, o, a.move, 'whiff'); }
      } else if (f.bout && !a.resolved && a.tick >= a.frames.startup) {
        f.bout.resolveAction(f);
      }
      if (phase === Phase.DONE) f.action = null;
    }
    if (contacts.length) this.#resolveContacts(contacts);
  }

  #resolveContacts(contacts) {
    const w = this.world, tun = w.tun;
    // pass 1: decide every contact against the state BEFORE any of them is applied, so trades are symmetric
    const decided = contacts.map((c) => {
      const { att, def, move } = c;
      const standing = def.mode === Mode.STANDUP;
      const defense = standing ? resolveDefense({ attacker: att, defender: def, move, tun, rng: w.rng('defense') }) : { outcome: 'hit', mitigation: 0, strong: false };
      const dp = def.action ? actionPhase(def.action) : null;
      const committed = def.mode === Mode.TAKEDOWN;
      const counterHit = defense.outcome === 'hit' && (committed || dp === Phase.STARTUP || dp === Phase.ACTIVE);
      return { ...c, defense, counterHit };
    });
    // pass 2: apply
    for (const d of decided) {
      const { att, def, move, action, defense } = d;
      action.resolved = true;
      if (defense.outcome === 'hit' || defense.outcome === 'blocked') {
        const mods = action.mods;
        const r = applyImpact(w, att, def, move, defense, {
          mode: 'standup',
          ctx: { counter: action.counter, counterHit: d.counterHit, chargeFrac: action.chargeFrac, catchFailed: defense.catchFailed, critBonus: mods?.critBonus, damageMult: mods?.damageScale },
          bonusByEvent: mods?.stunBonus ? { stun: mods.stunBonus } : null,
        });
        if (defense.outcome === 'blocked') onDefenseSuccess(def, att, 'blocked', tun);
        if (defense.outcome === 'hit' && att.combo.count === 3) w.emit(EventType.COMBO, { fighter: att.id, count: 3 });
        if (def.mode === Mode.TAKEDOWN && def.bout?.kind === 'takedown') def.bout.onStruck(att, move, r.dmg.tier);
        if (def.isHelpless()) { def.action = null; def.guard = { state: 'none', timeUp: 0 }; def.parryTicks = def.slipTicks = def.catchTicks = 0; }
      } else {
        emitAvoided(w, att, def, move, defense.outcome, { strong: defense.strong });
        if (defense.outcome === 'caught') w.emit(EventType.CATCH, { fighter: def.id, from: att.id });
        onDefenseSuccess(def, att, defense.outcome, tun);
      }
    }
  }

  // ---- 9 · bouts, statuses, floor ----------------------------------------------------------------------------------
  #modes() {
    const w = this.world, tun = w.tun;
    const bouts = [];
    for (const f of w.fighters) if (f.bout && !bouts.includes(f.bout)) bouts.push(f.bout);
    for (const b of bouts) if (!b.finished) b.update();

    for (const f of w.fighters) {
      const mash = clamp(f.intent?.prompt?.mash ?? 0, 0, 1) * tun.healthEvents.recoveryMashMaxReduction;
      const tough = (f.rating('toughness') - 50) / 50 * 0.15;
      const r = tickStatus(f, mash + tough);
      if (r === 'recovered') w.emit(EventType.STUN_RECOVERY, { fighter: f.id });
    }
    for (const f of w.fighters) { this.#buckle(f); this.#floor(f); }
    for (const f of w.fighters) {
      const act = f.action ? actionPhase(f.action) : null;
      const paired = [Mode.CLINCH, Mode.GROUND, Mode.SUBMISSION, Mode.TAKEDOWN].includes(f.mode);
      regenStamina(f, tun, { acting: act === Phase.STARTUP || act === Phase.ACTIVE, paired });
    }
  }

  /** A leg pool at zero is a guaranteed buckle (docs/06 §5). */
  #buckle(f) {
    const w = this.world;
    const zero = f.pools.legL.cur <= 0 ? 'legL' : f.pools.legR.cur <= 0 ? 'legR' : null;
    if (!zero) { f.buckled = false; return; }
    if (f.buckled || ['knockdown', 'knockout'].includes(f.status.event)) return;
    if (f.mode === Mode.STANDUP || f.mode === Mode.CLINCH) { f.buckled = true; w.healthEvent(f, w.opp(f), 'knockdown', zero); }
  }

  /** knocked-down fighters go to the floor; they get up when the event timer ends (legs permitting) */
  #floor(f) {
    const w = this.world;
    const ev = f.status.event;
    if ((ev === 'knockdown' || ev === 'knockout') && [Mode.STANDUP, Mode.CLINCH, Mode.TAKEDOWN].includes(f.mode)) {
      if (f.bout && !f.bout.finished) f.bout.end('knockdown');
      f.mode = Mode.DOWN; f.floorPosture = 'back'; f.action = null; f.downTick = w.tick;
      f.guard = { state: 'none', timeUp: 0 }; f.parryTicks = f.slipTicks = f.catchTicks = 0; f.heldLeg = null; f.trapped = 0;
      for (const o of w.fighters) if (o.heldLeg?.from === f.id) this.#releaseCatch(o, 'knockdown');
    }
    if (f.mode === Mode.DOWN && !f.isHelpless() && f.status.event !== 'knockout') {
      const legsGone = f.pools.legL.cur <= 0 || f.pools.legR.cur <= 0;
      if (legsGone) {
        if ((w.tick - f.downTick) % 60 === 0) { f.failedGetups += 1; w.emit(EventType.GET_UP, { actor: f.id, success: false }); }
      } else {
        f.mode = Mode.STANDUP; f.floorPosture = null; f.failedGetups = 0; f.buckled = false;
        w.emit(EventType.GET_UP, { actor: f.id, success: true });
      }
    }
  }

  // ---- 10 · referee ----------------------------------------------------------------------------------------------
  #referee() {
    const s = this.referee.update();
    if (s) this.#finish(s);
  }

  #finish(s) {
    if (this.over) return;
    const w = this.world;
    const type = s.type === 'ko' ? FightResultType.KO : s.type === 'submission' ? FightResultType.SUBMISSION : FightResultType.TKO;
    this.result = { result: type, method: s.how, stoppage: s.type, winner: s.winner, loser: s.loser, round: this.match.round, tick: w.tick, clock: this.match.elapsed };
    this.over = true;
    this.#endAllBouts('stoppage');
    for (const f of w.fighters) f.mode = Mode.FINISHED;
    this.match.finish(s.type === 'ko' ? 'ko' : s.type === 'doctor' ? 'doctorStop' : s.type === 'submission' ? 'tap' : 'tko', this.result);
  }

  // ---- 11 · bookkeeping --------------------------------------------------------------------------------------------
  #bookkeeping() {
    const w = this.world;
    for (const f of w.fighters) {                                    // every fighter-tick is booked to exactly one mode bucket
      if (f.mode === Mode.STANDUP) w.stats.tickTime(f.id, 'time.standup');
      else if (f.mode === Mode.DOWN) w.stats.tickTime(f.id, 'time.down');
      else if (f.bout && f.bout.timeKeys) for (const k of f.bout.timeKeys(f)) w.stats.tickTime(f.id, k);
    }
    const down = w.fighters.some((f) => f.mode === Mode.DOWN);
    if (down) this.match.stop('knockdown'); else if (this.match.reason === 'knockdown') this.match.resume();
    this.match.tickClock();
    if (w.tick % 30 === 0) { const h = w.stateHash(); this.hashes.push({ tick: w.tick, hash: h }); this.recorder?.checkpoint(w.tick, h); }
  }

  // ---- match hooks -------------------------------------------------------------------------------------------------
  #endAllBouts(reason) {
    for (let guard = 0; guard < 4; guard++) {
      const bouts = [];
      for (const f of this.world.fighters) if (f.bout && !f.bout.finished && !bouts.includes(f.bout)) bouts.push(f.bout);
      if (!bouts.length) return;
      for (const b of bouts) {
        if (b.kind === 'ground') b.end(reason, { middle: true }); else b.end(reason);
      }
    }
  }

  #roundStart(round) {
    const w = this.world;
    w.round = round;
    w.stats.startRound(round);
    this.referee.roundReset();
    for (const f of w.fighters) {
      f.action = null; f.guard = { state: 'none', timeUp: 0 }; f.parryTicks = f.parryLock = f.slipTicks = f.catchTicks = f.counterWindow = 0;
      f.heldLeg = null; f.trapped = 0; f.mode = Mode.STANDUP; f.bout = null; f.groundRole = null; f.floorPosture = null; f.cover = 0; f.buckled = false;
      f.stanceSwitchTicks = 0; f.recoveryExtra = 0; f.combo = { count: 0, lastTick: -999 };
      if (f.status.event !== 'knockout') f.status = { event: 'none', ticks: 0, recovery: 0, helpless: false, moveMult: 1, guardMult: 1, limpLeg: null, limpTicks: 0, nextHeavyKdBonus: 0 };
      this.buffers.get(f.id).clear();
    }
    w.resetToMiddle(1.4);
    w.emit(EventType.ROUND_START, { round });
  }

  #roundEnd(round) {
    this.#endAllBouts('bell');
    this.world.emit(EventType.ROUND_END, { round });
  }

  #betweenRounds() {
    const w = this.world;
    for (const f of w.fighters) { recoverBetweenRounds(f, w.tun); cutmanTreat(f, w.rng('cut'), w.tun); }
    const s = this.referee.checkDoctor();
    if (s) this.#finish(s);
  }

  #fightOver() {
    const w = this.world;
    if (this.result) return;                                          // already a stoppage
    // bell of the last round: go to the cards
    const [a, b] = w.fighters;
    const rounds = Array.from({ length: this.rounds }, (_, i) => i + 1);
    const res = scoreFight(w.stats, a, b, rounds, w.tun, this.judges);
    this.result = { result: res.result, method: 'decision', stoppage: 'decision', winner: res.winner, loser: res.winner ? w.opp(w.byId(res.winner)).id : null, round: this.match.round, tick: w.tick, clock: this.match.elapsed, cards: res.cards };
    this.over = true;
    for (const f of w.fighters) f.mode = Mode.FINISHED;
    w.emit(EventType.DECISION, { result: res.result, winner: res.winner, cards: res.cards.map((c) => ({ judge: c.judge, a: c.a, b: c.b, verdict: c.verdict })) });
  }
}
