// Typed event bus (docs/16). The sim emits; HUD, camera, audio, commentary, stats, replay and AI-situation code subscribe.
// Payload contracts are documented next to each type; every payload also carries {tick, round}.

export const EventType = Object.freeze({
  STRIKE: 'strike',                 // {attacker, defender, moveId, limb, kind, side, target, mode, outcome, taken, blocked, tier, crit, counter, counterHit, significant, contact, region}
  FEINT: 'feint',                   // {fighter}
  COMBO: 'combo',                   // {fighter, count}
  CATCH: 'catch',                   // {fighter, from}
  CATCH_RELEASE: 'catch_release',   // {fighter, reason}
  HEALTH_EVENT: 'health_event',     // {fighter, event, region, source}
  STUN_RECOVERY: 'stun_recovery',   // {fighter}
  KNOCKDOWN: 'knockdown',           // {fighter, by}
  INJURY: 'injury',                 // {fighter, region, stage}
  STANCE_SWITCH: 'stance_switch',   // {fighter}
  CLINCH_ATTEMPT: 'clinch_attempt', // {attacker, defender, outcome: success|denied|missed}
  CLINCH_START: 'clinch_start',     // {dom, sub, position, cage}
  CLINCH_TRANSITION: 'clinch_transition', // {actor, from, to, style}
  CLINCH_BREAK: 'clinch_break',     // {dom, sub, reason}
  TAKEDOWN: 'takedown',             // {attacker, defender, phase: start|result, move, size, direction, origin, result: success|denied|missed, denial, position}
  GROUND_POSITION: 'ground_position', // {top, bottom, from, to, reason}
  PASS: 'pass',                     // {actor, success}
  SWEEP: 'sweep',                   // {actor}
  GET_UP: 'get_up',                 // {actor, success}
  SUBMISSION: 'submission',         // {attacker, defender, name, category, stage, result: start|denied|stage|defend|escape|abort|tap|ko|injury}
  REFEREE: 'referee',               // {kind: low_action|break|stand_up|warn|stop}
  ROUND_START: 'round_start',       // {}
  ROUND_END: 'round_end',           // {}
  STOPPAGE: 'stoppage',             // {type: ko|tko|submission|doctor, winner, loser, how}
  DECISION: 'decision',             // {result, cards}
  ABILITY: 'ability',               // {fighter, ability, result}
});

export class EventBus {
  constructor({ record = false } = {}) {
    this.handlers = new Map();
    this.log = record ? [] : null;
    this.context = { tick: 0, round: 0 };
  }
  /** Subscribe to one type or '*' (all). Returns an unsubscribe function. */
  on(type, fn) {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }
  /** Synchronous, ordered dispatch. Listeners added/removed while dispatching take effect on the next emit. */
  emit(type, payload = {}) {
    const ev = { ...payload, type, tick: this.context.tick, round: this.context.round }; // envelope keys can never be shadowed by payload fields
    if (this.log) this.log.push(ev);
    for (const key of [type, '*']) {
      const set = this.handlers.get(key);
      if (!set) continue;
      for (const fn of [...set]) fn(ev);
    }
    return ev;
  }
}
