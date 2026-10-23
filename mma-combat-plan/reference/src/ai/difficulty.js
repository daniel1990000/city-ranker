// Difficulty curve (docs/13 §2.3): reaction delay, defensive read probability, softmax temperature and combo length.

import { clamp } from '../core/math.js';

export const DIFFICULTIES = Object.freeze(['beginner', 'pro', 'champion']);

export function difficultyProfile(name, tun) {
  return tun.ai.difficulty[name] ?? tun.ai.difficulty.pro;
}

/** Ticks between an incoming strike entering startup and the AI being able to react. */
export function reactionDelay(rng, profile) {
  return Math.max(1, Math.round(profile.reactionTicks + (rng.next() * 2 - 1) * profile.reactionJitter));
}

/** P(the AI reads and answers an incoming strike): base + 0.002·blocking, lowered when the fighter keeps his hands down. */
export function defendProbability(profile, fighter) {
  return clamp(profile.defend + 0.002 * fighter.rating('blocking') - (fighter.handsDown ? 0.10 : 0), 0.02, 0.98);
}

/** Weighted-pick sharpness from the temperature: low τ → near-greedy, high τ → more mistakes. */
export const sharpness = (profile) => 1 / profile.tau;
