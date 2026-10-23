// The 12 observed tendency archetypes (docs/13 §1) as data: aggression overrides, goal base weights, strike preferences and
// preferred fighting range. Every number is ours; the structure (a generic tunable set per archetype) is what the reference has.

import { TENDENCIES } from '../core/taxonomy.js';

const goals = (strike, special_strike, loco, transition, takedown, clinch, submission) => ({ strike, special_strike, loco, transition, takedown, clinch, submission });

export const TENDENCY_PROFILES = Object.freeze({
  striking_purist: { a0: 0.55, min: 0.15, max: 0.90, mul: {}, goals: goals(0.5, 0.08, 0.3, 0.1, 0.02, 0.03, 0.04), prefs: { limb: { punch: 1.0, kick: 1.15 }, tags: {} }, range: 0.55 },
  brawler: { a0: 0.75, min: 0.45, max: 0.98, mul: {}, goals: goals(0.62, 0.1, 0.12, 0.08, 0.01, 0.05, 0.02), prefs: { limb: { punch: 1.4, kick: 0.6 }, tags: { hook: 1.3, overhand: 1.4 } }, range: 0.30 },
  chess_master: { a0: 0.40, min: 0.10, max: 0.75, mul: {}, goals: goals(0.4, 0.05, 0.42, 0.1, 0.02, 0.02, 0.04), prefs: { limb: { punch: 1.0, kick: 1.0 }, tags: { jab: 1.3, teep: 1.4 } }, range: 0.75 },
  attrition_specialist: { a0: 0.55, min: 0.20, max: 0.90, mul: { opp_stamina: 2 }, goals: goals(0.4, 0.04, 0.2, 0.1, 0.04, 0.08, 0.05), prefs: { limb: { punch: 0.9, kick: 1.2 }, tags: { legkick: 1.5, bodykick: 1.3, body: 1.3 } }, range: 0.45 },
  adaptive_finisher: { a0: 0.55, min: 0.20, max: 0.95, mul: { opp_health_head: 1.8 }, goals: goals(0.46, 0.14, 0.22, 0.1, 0.02, 0.03, 0.1), prefs: { limb: { punch: 1.0, kick: 1.0 }, tags: {} }, range: 0.50 },
  bjj_fighter: { a0: 0.55, min: 0.20, max: 0.90, mul: {}, goals: goals(0.22, 0.03, 0.1, 0.25, 0.06, 0.1, 0.17), prefs: { limb: { punch: 0.9, kick: 0.8 }, tags: {} }, range: 0.45 },
  damage_specialist: { a0: 0.60, min: 0.25, max: 0.95, mul: {}, goals: goals(0.44, 0.18, 0.2, 0.1, 0.02, 0.03, 0.04), prefs: { limb: { punch: 1.1, kick: 1.1 }, tags: { overhand: 1.2, headkick: 1.2 } }, range: 0.50 },
  dirty_boxer: { a0: 0.65, min: 0.30, max: 0.95, mul: {}, goals: goals(0.46, 0.06, 0.12, 0.1, 0.02, 0.1, 0.02), prefs: { limb: { punch: 1.3, kick: 0.6 }, tags: { uppercut: 1.4, elbow: 1.4, hook: 1.2 } }, range: 0.35 },
  dominance_specialist: { a0: 0.55, min: 0.20, max: 0.90, mul: {}, goals: goals(0.26, 0.03, 0.12, 0.24, 0.06, 0.08, 0.08), prefs: { limb: { punch: 1.0, kick: 0.8 }, tags: {} }, range: 0.45 },
  off_the_back_specialist: { a0: 0.50, min: 0.20, max: 0.90, mul: {}, goals: goals(0.28, 0.04, 0.14, 0.22, 0.05, 0.04, 0.2), prefs: { limb: { punch: 1.0, kick: 1.0 }, tags: {} }, range: 0.50, bottomGame: 1.5 },
  rounded_clincher: { a0: 0.55, min: 0.20, max: 0.90, mul: {}, goals: goals(0.3, 0.04, 0.14, 0.12, 0.04, 0.12, 0.05), prefs: { limb: { punch: 1.0, kick: 0.9 }, tags: { knee: 1.2 } }, range: 0.40 },
  thai_clincher: { a0: 0.60, min: 0.25, max: 0.92, mul: {}, goals: goals(0.34, 0.06, 0.15, 0.08, 0.03, 0.18, 0.03), prefs: { limb: { punch: 0.8, kick: 1.3 }, tags: { knee: 1.4, elbow: 1.3, legkick: 1.2 } }, range: 0.40 },
});

export function tendencyProfile(name) {
  return TENDENCY_PROFILES[name] ?? TENDENCY_PROFILES.striking_purist;
}

export const tendencyNames = () => [...TENDENCIES];

export const GOALS = Object.freeze(['strike', 'special_strike', 'loco', 'transition', 'takedown', 'clinch', 'submission']);
const OFFENSIVE = new Set(['strike', 'special_strike', 'takedown', 'clinch', 'submission', 'transition']);

/**
 * score_g = base[t][g] · fit_g · (1 + interest_g) · noise · aggressionGain(g, A)   (docs/13 §2.2)
 * Offensive goals gain with aggression, footwork (loco) gains when aggression is low; at A = 0.5 both gains are 1.
 */
export function goalScoreTable({ base, fit = {}, interest = {}, A = 0.5, noise = () => 1 }) {
  const out = {};
  for (const g of GOALS) {
    const gain = OFFENSIVE.has(g) ? 0.5 + A : 1.5 - A;
    out[g] = base[g] * (fit[g] ?? 1) * (1 + (interest[g] ?? 0)) * noise() * gain;
  }
  return out;
}
