// Damage pipeline (docs/04 §5, docs/05 §3): raw → crit → multipliers → blocked/taken (+chip) → pool + stamina effects.

import { clamp } from '../core/math.js';
import { skillMul } from './skills.js';
import { damageTier } from './strike.js';

/** Pick the struck pool region from a move's target. Leg strikes prefer the lead leg (70 %). */
export function regionOf(defender, move, rng) {
  if (move.target === 'head') return 'head';
  if (move.target === 'body') return 'body';
  return defender.legRegion(rng.chance(0.7) ? 'lead' : 'back');
}

export function rawStrikeDamage({ attacker, move, rng, tun, chargeFrac = 0 }) {
  const raw = move.damage.base + rng.next() * move.damage.range;
  const power = attacker.limbPower(move.limb, move.side) / 100;
  const attrFac = tun.damage.attrBase + tun.damage.attrScale * power;
  const gas = attacker.gassed() ? tun.stamina.gassedPowerMult : 1;
  const charge = 1 + (tun.strike.maxChargeMult - 1) * chargeFrac;
  let limp = 1;
  if (move.limb === 'kick' && attacker.status.limpTicks > 0 && attacker.status.limpLeg === attacker.legRegion(move.side)) limp = tun.healthEvents.effects.limping.kickMult;
  return raw * attrFac * gas * charge * limp;
}

/**
 * Full resolution for a strike that was not wholly avoided.
 * ctx: {counter (defender was countering), counterHit (hit during victim's startup/active), chargeFrac, catchFailed}
 */
export function resolveDamage({ attacker, defender, move, defense, region, rng, tun, ctx = {} }) {
  const dm = tun.damage;
  let strike = rawStrikeDamage({ attacker, move, rng, tun, chargeFrac: ctx.chargeFrac ?? 0 });

  const helpless = defender.isHelpless();
  let critChance = (move.critChance ?? 0.03)
    + (defender.handsDown && region === 'head' ? tun.defense.handsDownHeadCritBonus : 0)
    + (helpless ? dm.stunnedCritBonus : 0)
    + (ctx.counter ? 0.05 : 0)
    + (ctx.critBonus ?? 0)
    + (ctx.catchFailed ? tun.defense.catchFailCritBonus : 0);
  const crit = region === 'head' && rng.chance(critChance);
  if (crit) strike *= dm.critMult;

  strike *= dm.regionMult[move.target];
  if (helpless) strike *= dm.stunnedMult;
  if (ctx.counter) strike *= dm.counterMult;
  if (ctx.counterHit) strike *= dm.counterHitMult;
  if (ctx.damageMult !== undefined) strike *= ctx.damageMult; // position / posture multipliers from clinch & ground
  strike *= clamp(skillMul(attacker, 'damage', { other: defender, move }), 1 / dm.skillCap, dm.skillCap);

  const mitigation = defense.outcome === 'blocked' ? defense.mitigation : 0;
  const blocked = strike * mitigation;
  const chip = blocked * tun.defense.chipFraction;
  const taken = strike - blocked + chip;

  const poolMax = defender.pools[region].max;
  return { strike, blocked, taken, crit, tier: damageTier(taken, poolMax, tun), chip, mitigation };
}

/** Is this landed strike "significant" for stats/judging? Heavier-than-light hits or any head/leg power strike. */
export function isSignificant(move, tier) {
  return move.power !== 'light' || tier !== 'light';
}
