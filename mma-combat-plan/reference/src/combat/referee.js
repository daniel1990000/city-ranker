// Referee (docs/12 §3, docs/06 §6): decides stoppages (KO, TKO rules, submission, doctor) and enforces stand-up idle rules.
// Clinch and ground idle rules live in their bouts (they own the timers); the referee observes everything through the event bus.

import { EventType } from '../sim/events.js';
import { Mode, toTicks } from '../core/taxonomy.js';
import { doctorStops } from './injuries.js';

export class Referee {
  constructor(world) {
    this.world = world;
    this.stoppage = null;
    this.lastActivity = 0; this.warned = false;
    this.windows = new Map(world.fighters.map((f) => [f.id, []]));   // unanswered ground strikes per victim
    this.lastHit = new Map();                                         // victim id → last landed strike (for the KO description)
    this.off = world.bus.on('*', (ev) => this.#observe(ev));
  }

  dispose() { this.off(); }

  stop(type, how, winner, loser) {
    if (this.stoppage) return this.stoppage;
    this.stoppage = { type, how, winner: winner?.id ?? null, loser: loser?.id ?? null };
    this.world.emit(EventType.STOPPAGE, { ...this.stoppage });
    return this.stoppage;
  }

  #activity() { this.lastActivity = this.world.tick; this.warned = false; }

  #observe(ev) {
    switch (ev.type) {
      case EventType.STRIKE: this.#onStrike(ev); break;
      case EventType.TAKEDOWN: if (ev.phase === 'start') this.#activity(); break;
      case EventType.CLINCH_ATTEMPT: if (ev.outcome === 'success') this.#activity(); break;
      case EventType.CLINCH_TRANSITION: case EventType.GROUND_POSITION: case EventType.PASS: case EventType.SWEEP: case EventType.GET_UP:
        this.#activity(); break;
      case EventType.SUBMISSION: this.#onSubmission(ev); break;
      default: break;
    }
  }

  #onSubmission(ev) {
    this.#activity();
    const { world } = this;
    const att = world.byId(ev.attacker), def = world.byId(ev.defender);
    if (ev.result === 'tap') this.stop('submission', ev.name, att, def);
    else if (ev.result === 'ko') this.stop('submission', `${ev.name}_choke_out`, att, def);
    else if (ev.result === 'injury') this.stop('tko', `${ev.name}_injury`, att, def);
  }

  #onStrike(ev) {
    this.#activity();
    if (this.stoppage) return;
    const { world } = this, r = world.tun.referee;
    const victim = world.byId(ev.defender), attacker = world.byId(ev.attacker);
    if (ev.outcome === 'hit' || ev.outcome === 'blocked') this.lastHit.set(victim.id, { moveId: ev.moveId, kind: ev.kind, target: ev.target, mode: ev.mode, tick: ev.tick });
    if (ev.outcome === 'blocked') { this.windows.get(victim.id).length = 0; return; }
    if (ev.outcome !== 'hit') return;
    const heavy = ev.tier === 'heavy';
    // rule 3: head pool nearly empty, already stunned, another heavy head strike lands → stoppage (the status is the one BEFORE this strike)
    const stunned = victim.status.ticks > 0 && (victim.status.event === 'stun' || victim.status.event === 'critical_stun');
    if (heavy && ev.target === 'head' && stunned && victim.poolFraction('head') < r.tkoHeadFraction && world.rng('referee').chance(r.tkoStunnedChance)) {
      this.stop('tko', 'stunned_and_hurt', attacker, victim); return;        // referee discretion: not every such shot ends it
    }
    // rule 2: unanswered ground strikes
    if (ev.mode === 'ground') {
      const w = this.windows.get(victim.id), T = toTicks(r.tkoWindowSeconds);
      while (w.length && ev.tick - w[0].tick > T) w.shift();
      if (ev.tick - victim.activeDefenceTick <= T || victim.cover > 0) w.length = 0;
      else w.push({ tick: ev.tick, heavy });
      if (w.filter((x) => x.heavy).length >= r.tkoUnansweredHeavy || w.length >= r.tkoUnansweredAny) this.stop('tko', 'ground_and_pound', attacker, victim);
    }
  }

  /** Once per tick, after the bouts have updated. Returns the stoppage (or null). */
  update() {
    if (this.stoppage) return this.stoppage;
    const { world } = this, r = world.tun.referee;
    const [a, b] = world.fighters;
    // rule 1: knockout
    const ko = world.fighters.filter((f) => f.status.event === 'knockout');
    if (ko.length === 2) {                                          // double knockout: the fighter who is less hurt wins, exact tie = no contest
      const d = a.poolFraction('head') - b.poolFraction('head');
      if (Math.abs(d) < 1e-9) return this.stop('ko', 'double_ko', null, null);
      return this.stop('ko', 'double_ko', d > 0 ? a : b, d > 0 ? b : a);
    }
    if (ko.length === 1) {
      const loser = ko[0], winner = world.opp(loser), hit = this.lastHit.get(loser.id);
      return this.stop('ko', hit ? `${hit.kind}_${hit.target}` : 'unknown', winner, loser);
    }
    // rule 4: legs gone and unable to stand after two attempts
    for (const f of world.fighters) {
      if ((f.pools.legL.cur <= 0 || f.pools.legR.cur <= 0) && f.failedGetups >= 2) return this.stop('tko', 'leg_injury', world.opp(f), f);
    }
    // stand-up idle rule: warning, then a break back to the centre of the octagon
    if (a.mode === Mode.STANDUP && b.mode === Mode.STANDUP) {
      const idle = world.tick - Math.max(this.lastActivity, a.lastActionTick, b.lastActionTick);
      if (!this.warned && idle >= toTicks(r.lowActionWarnSeconds)) { this.warned = true; world.emit(EventType.REFEREE, { kind: 'low_action', mode: 'standup' }); }
      if (idle >= toTicks(r.standupBreakSeconds)) {
        world.emit(EventType.REFEREE, { kind: 'break', mode: 'standup' });
        world.resetToMiddle();
        this.#activity();
      }
    } else { this.lastActivity = world.tick; this.warned = false; }
    return null;
  }

  /** Doctor check (between rounds or on request): a critical cut can end the fight. */
  checkDoctor() {
    if (this.stoppage) return this.stoppage;
    const { world } = this;
    for (const f of world.fighters) if (doctorStops(f, world.rng('referee'), world.tun)) return this.stop('doctor', 'cut', world.opp(f), f);
    return null;
  }

  roundReset() {
    for (const w of this.windows.values()) w.length = 0;
    this.lastActivity = this.world.tick; this.warned = false;
  }
}
