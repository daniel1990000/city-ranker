// Per-fighter, per-round and total statistics derived from the event stream (docs/04 §6, docs/12 §4, docs/16 §2).
// Keys are flat dotted strings so they are easy to serialise, diff and chart.

import { EventType } from './events.js';

export class StatsTracker {
  constructor(bus, fighterIds) {
    this.ids = [...fighterIds];
    this.totals = new Map(this.ids.map((id) => [id, new Map()]));
    this.rounds = new Map(); // round -> Map(id -> Map)
    this.round = 0;
    this.lastEventTick = new Map(); // `${id}.${key}` -> tick
    this.strikesReceivedRound = new Map(this.ids.map((id) => [id, 0]));
    bus.on('*', (ev) => this.#consume(ev));
    this.bus = bus;
  }

  #roundMap(round, id) {
    let r = this.rounds.get(round);
    if (!r) this.rounds.set(round, (r = new Map(this.ids.map((i) => [i, new Map()]))));
    return r.get(id);
  }

  inc(id, key, n = 1, round = this.round) {
    const t = this.totals.get(id);
    t.set(key, (t.get(key) ?? 0) + n);
    const r = this.#roundMap(round, id);
    r.set(key, (r.get(key) ?? 0) + n);
  }

  /** Read a counter. round omitted → fight total. */
  get(id, key, round) {
    const m = round === undefined ? this.totals.get(id) : this.#roundMap(round, id);
    return m.get(key) ?? 0;
  }

  mark(id, key, tick) { this.lastEventTick.set(`${id}.${key}`, tick); }
  ticksSince(id, key, tick) {
    const t = this.lastEventTick.get(`${id}.${key}`);
    return t === undefined ? Infinity : tick - t;
  }

  /** Time accounting: call once per tick per fighter with the key to credit (e.g. 'time.standup', 'time.clinch.dom'). */
  tickTime(id, key) { this.inc(id, key, 1); }

  startRound(n) { this.round = n; for (const id of this.ids) this.strikesReceivedRound.set(id, 0); this.#roundMap(n, this.ids[0]); }

  strikesReceivedThisRound(id) { return this.strikesReceivedRound.get(id) ?? 0; }

  snapshot() {
    const out = { totals: {}, rounds: {} };
    for (const [id, m] of this.totals) out.totals[id] = Object.fromEntries(m);
    for (const [r, byId] of this.rounds) {
      out.rounds[r] = {};
      for (const [id, m] of byId) out.rounds[r][id] = Object.fromEntries(m);
    }
    return out;
  }

  #consume(ev) {
    switch (ev.type) {
      case EventType.STRIKE: return this.#strike(ev);
      case EventType.FEINT: this.inc(ev.fighter, 'feints'); return;
      case EventType.COMBO: this.inc(ev.fighter, 'combos.landed'); return;
      case EventType.CATCH: this.inc(ev.fighter, 'defense.caught'); return;
      case EventType.HEALTH_EVENT:
        if (ev.event === 'none') return;
        this.inc(ev.fighter, `events.${ev.event}`);
        if (ev.source) this.inc(ev.source, `events.inflicted.${ev.event}`);
        this.mark(ev.fighter, `event.${ev.event}`, ev.tick);
        if (ev.event === 'stun' || ev.event === 'critical_stun') this.mark(ev.fighter, 'stunned', ev.tick);
        return;
      case EventType.KNOCKDOWN:
        this.inc(ev.fighter, 'knockdowns.against');
        if (ev.by) this.inc(ev.by, 'knockdowns.landed');
        this.mark(ev.fighter, 'knockdown', ev.tick);
        return;
      case EventType.INJURY: this.inc(ev.fighter, `injury.${ev.region}.${ev.stage}`); return;
      case EventType.CLINCH_ATTEMPT:
        this.inc(ev.attacker, `clinch.attempts`);
        if (ev.outcome === 'success') this.inc(ev.attacker, 'clinch.success');
        if (ev.outcome === 'denied') this.inc(ev.defender, 'clinch.denied');
        return;
      case EventType.CLINCH_TRANSITION: this.inc(ev.actor, 'clinch.transitions'); return;
      case EventType.TAKEDOWN:
        if (ev.phase === 'start') { this.inc(ev.attacker, 'takedowns.attempted'); return; }
        if (ev.result === 'success') this.inc(ev.attacker, 'takedowns.landed');
        else if (ev.result === 'missed') this.inc(ev.attacker, 'takedowns.missed');
        else { this.inc(ev.attacker, 'takedowns.stuffed'); this.inc(ev.defender, 'takedowns.denied'); }
        if (ev.result === 'success') this.mark(ev.attacker, 'takedown_landed', ev.tick);
        return;
      case EventType.PASS:
        if (ev.success) this.inc(ev.actor, 'passes.landed'); else this.inc(ev.actor, 'passes.failed');
        if (!ev.success && ev.against) this.inc(ev.against, 'passes.denied');
        return;
      case EventType.SWEEP: this.inc(ev.actor, 'sweeps.landed'); return;
      case EventType.GET_UP: this.inc(ev.actor, ev.success ? 'getups.success' : 'getups.failed'); return;
      case EventType.SUBMISSION:
        if (ev.result === 'start') this.inc(ev.attacker, 'subs.attempted');
        if (ev.result === 'stage') { this.inc(ev.attacker, 'subs.depth'); if (ev.stage === 2) this.inc(ev.attacker, 'subs.locked'); if (ev.stage === 4) this.inc(ev.attacker, 'subs.deep'); }
        if (ev.result === 'escape') { this.inc(ev.defender, 'subs.escaped'); }
        if (ev.result === 'tap' || ev.result === 'ko') this.inc(ev.attacker, 'subs.finished');
        return;
      case EventType.STANCE_SWITCH: this.inc(ev.fighter, 'stance.switches'); return;
      default: return;
    }
  }

  #strike(ev) {
    const a = ev.attacker, d = ev.defender;
    const kind = ev.kind ?? ev.limb;
    const keys = [`strikes.thrown`, `strikes.thrown.${ev.target}`, `strikes.thrown.${kind}`, `strikes.thrown.${ev.mode}`];
    for (const k of keys) this.inc(a, k);
    if (ev.significant) this.inc(a, 'strikes.sig.thrown');
    switch (ev.outcome) {
      case 'hit': {
        const lk = [`strikes.landed`, `strikes.landed.${ev.target}`, `strikes.landed.${kind}`, `strikes.landed.${ev.mode}`];
        for (const k of lk) this.inc(a, k);
        if (ev.significant) { this.inc(a, 'strikes.sig.landed'); this.inc(a, `strikes.sig.landed.${ev.target}`); }
        this.inc(a, 'damage.dealt', ev.taken ?? 0);
        this.inc(d, 'damage.taken', ev.taken ?? 0);
        this.inc(d, 'strikes.absorbed');
        this.strikesReceivedRound.set(d, (this.strikesReceivedRound.get(d) ?? 0) + 1);
        if (ev.counter || ev.counterHit) this.inc(a, 'counters.landed');
        if (ev.crit) this.inc(a, 'strikes.crit');
        if (ev.tier) this.inc(a, `strikes.tier.${ev.tier}`);
        this.mark(d, 'hit', ev.tick);
        this.inc(a, `damage.dealt.${ev.target}`, ev.taken ?? 0);
        break;
      }
      case 'blocked': {
        this.inc(a, 'strikes.blocked');
        this.inc(d, 'defense.blocked');
        this.inc(a, 'damage.blocked', ev.blocked ?? 0);
        this.inc(d, 'damage.taken', ev.taken ?? 0);
        if (ev.limb === 'kick' && ev.target !== 'leg') this.inc(a, ev.strong ? 'kicks.against_block' : 'kicks.through_guard');
        break;
      }
      case 'parried': this.inc(a, 'strikes.avoided'); this.inc(d, 'defense.parried'); break;
      case 'slipped': this.inc(a, 'strikes.avoided'); this.inc(d, 'defense.slipped'); break;
      case 'caught': this.inc(a, 'strikes.avoided'); this.inc(d, 'defense.caught'); break;
      case 'whiff': this.inc(a, 'strikes.avoided'); this.inc(d, 'defense.evaded'); break;
      default: break;
    }
  }
}
