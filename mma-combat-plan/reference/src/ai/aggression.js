// Aggression level A ∈ [Amin, Amax] from the 21 observed input factors (docs/13 §2.1).
//   A = clamp( A0[t] + Σ_i w_i[t] · curve_i(f_i), Amin[t], Amax[t] )
// Sign convention: positive weight = the factor raises aggression. Fractions are centred (0.5 → 0) so a half-healthy
// fighter contributes nothing; "event" style factors (idle, hit reaction, activity) are used directly.

import { AGGRESSION_FACTORS } from '../core/taxonomy.js';
import { clamp } from '../core/math.js';
import { tendencyProfile } from './tendencies.js';

const CENTRED = new Set([
  'health_head', 'health_body', 'health_leftleg', 'health_rightleg', 'stamina',
  'opp_health_head', 'opp_health_body', 'opp_health_leftleg', 'opp_health_rightleg', 'opp_stamina',
]);

/** The 21 factor values for a situation, each in its natural range (fractions 0..1, score differential -1..1). */
export function factorValues(sit, planner = 0) {
  return {
    health_head: sit.health.head, health_body: sit.health.body, health_leftleg: sit.health.legL, health_rightleg: sit.health.legR,
    delta_health: sit.deltaHealth, in_hit_reaction: sit.inHitReaction, idle: sit.idle, stamina: sit.stamina,
    opp_health_head: sit.opponentHealth.head, opp_health_body: sit.opponentHealth.body, opp_health_leftleg: sit.opponentHealth.legL, opp_health_rightleg: sit.opponentHealth.legR,
    opp_delta_health: sit.opponentDeltaHealth, opp_in_hit_reaction: sit.opponentInHitReaction, opp_idle: sit.opponentIdle, opp_stamina: sit.opponentStamina,
    opp_strike_activity: sit.opponentStrikeActivity, planner, round_num: sit.roundNum, round_time: sit.roundTime, score_differential: sit.scoreDifferential,
  };
}

export const curve = (name, v) => (CENTRED.has(name) ? 2 * v - 1 : v);

export function aggressionBounds(tendency, tun) {
  const p = tendencyProfile(tendency), a = tun.ai.aggression;
  return { a0: p.a0 ?? a.base, min: p.min ?? a.min, max: p.max ?? a.max };
}

export function aggressionLevel(sit, tendency, tun, planner = 0) {
  const p = tendencyProfile(tendency), { a0, min, max } = aggressionBounds(tendency, tun);
  const values = factorValues(sit, planner);
  let A = a0;
  for (const name of AGGRESSION_FACTORS) {
    const w = (tun.ai.aggression.weights[name] ?? 0) * (p.mul[name] ?? 1);
    if (w !== 0) A += w * curve(name, values[name]);
  }
  return clamp(A, min, max);
}

/** Ticks to wait between actions: lerp(slow, fast, A) (docs/13 §2.4). */
export const gapTicks = (A, tun) => tun.ai.gapTicks.slow + (tun.ai.gapTicks.fast - tun.ai.gapTicks.slow) * A;
