// The one place a landed (or avoided) strike turns into pool damage, injuries, stats events and health events.
// Stand-up, clinch and ground strikes all funnel through here so the numbers stay consistent (docs/04 §5, docs/06 §4).

import { EventType } from '../sim/events.js';
import { regionOf, resolveDamage, isSignificant } from './damage.js';
import { evaluateLadder } from './health-events.js';
import { addHeadImpact } from './injuries.js';

const NO_DEFENSE = Object.freeze({ outcome: 'hit', mitigation: 0, strong: false });
const GROUND_EXCLUDED = Object.freeze(['knockout']);

/** Emit a STRIKE event for a strike that did no damage (parried, slipped, caught or whiffed). */
export function emitAvoided(world, att, def, move, outcome, { mode = 'standup', strong = false } = {}) {
  return world.emit(EventType.STRIKE, {
    attacker: att.id, defender: def.id, moveId: move.id, limb: move.limb, kind: move.kind, side: move.side, target: move.target,
    mode, outcome, taken: 0, blocked: 0, tier: null, crit: false, counter: false, counterHit: false, significant: false,
    contact: move.contact, region: null, strong,
  });
}

/**
 * Resolve a strike that was not wholly avoided.
 * @param defense  {outcome:'hit'|'blocked', mitigation, strong} from the mode's defence rules
 * @param opts     {mode, ctx:{counter,counterHit,chargeFrac,catchFailed,damageMult}, bonusByEvent}
 * @returns {{region, dmg, event, ev}}  event = the health event triggered ('none' if none)
 */
export function applyImpact(world, att, def, move, defense = NO_DEFENSE, { mode = 'standup', ctx = {}, bonusByEvent = null } = {}) {
  const { tun } = world;
  const rngHit = world.rng('hit');
  const region = regionOf(def, move, rngHit);
  const dmg = resolveDamage({ attacker: att, defender: def, move, defense, region, rng: rngHit, tun, ctx });

  def.damagePool(region, dmg.taken);
  if (dmg.blocked > 0) def.spendStamina(dmg.blocked * tun.defense.staminaPerBlockedDamage);
  def.lastHitTick = world.tick;
  def.logDamage(world.tick, dmg.taken);
  att.lastActionTick = world.tick;

  if (region === 'head' && defense.outcome === 'hit') {
    const inj = addHeadImpact(def, move, dmg.taken, world.rng('injury'), tun);
    if (inj) world.emit(EventType.INJURY, { fighter: def.id, region: inj.region, stage: inj.stage });
  }

  const ev = world.emit(EventType.STRIKE, {
    attacker: att.id, defender: def.id, moveId: move.id, limb: move.limb, kind: move.kind, side: move.side, target: move.target,
    mode, outcome: defense.outcome, taken: dmg.taken, blocked: dmg.blocked, tier: dmg.tier, crit: dmg.crit,
    counter: !!ctx.counter, counterHit: !!ctx.counterHit, significant: isSignificant(move, dmg.tier), contact: move.contact, region,
    strong: !!defense.strong, power: move.power,
  });

  let event = 'none';
  if (dmg.taken > 0) {
    const r = evaluateLadder({
      attacker: att, defender: def, region, move, taken: dmg.taken, poolCurAfter: def.pools[region].cur,
      seed: world.rng('event').nextInt32(), tun, strikesReceivedRound: world.stats.strikesReceivedThisRound(def.id),
      counterHit: !!ctx.counterHit, bonusByEvent,
      exclude: mode === 'ground' ? GROUND_EXCLUDED : null,        // a pounced-on fighter is stopped by the referee (TKO), not "knocked out" by the dice
    });
    if (r.event !== 'none') { event = r.event; world.healthEvent(def, att, r.event, region); }
  }
  return { region, dmg, event, ev };
}
