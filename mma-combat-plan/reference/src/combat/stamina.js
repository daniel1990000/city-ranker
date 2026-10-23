// Stamina rules (docs/03 §1, docs/04, docs/07): spend on actions, regen when idle, gassing penalties, between-round recovery.

import { DT } from '../core/taxonomy.js';
import { skillMul } from './skills.js';

export function actionStaminaCost(fighter, base) {
  return base * fighter.tun.stamina.costScale * skillMul(fighter, 'staminaCost');
}

/** Per-tick regeneration. `acting` = in an action/bout that spends stamina; guarding halves regen. */
export function regenStamina(fighter, tun, { acting = false, paired = false, resting = false } = {}) {
  const t = tun.stamina;
  let perSec = t.regenPerSecBase + t.regenPerSecRating * fighter.rating('stamina') / 100;
  if (acting) perSec *= t.actingRegenMult;
  else if (paired) perSec *= t.pairedRegenMult;
  else if (fighter.guard.state !== 'none') perSec *= t.guardRegenMult;
  if (fighter.pools.body.cur / fighter.pools.body.max < 0.25) perSec *= 0.6; // battered body: slower recovery
  if (resting) perSec *= 0.5; // (between rounds uses recoverBetweenRounds instead)
  fighter.stamina = Math.min(fighter.maxStamina, fighter.stamina + perSec * DT);
}

export function recoverBetweenRounds(fighter, tun) {
  fighter.stamina = Math.min(fighter.maxStamina, fighter.stamina + tun.stamina.betweenRoundsRecover * (fighter.maxStamina - fighter.stamina));
  const r = tun.recovery;
  for (const reg of ['body', 'legL', 'legR']) fighter.healPool(reg, r.bodyLegFraction * fighter.pools[reg].max);
  fighter.healPool('head', r.headFraction * fighter.pools.head.max);
}
