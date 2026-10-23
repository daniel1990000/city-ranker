// Health events: stun → knockdown → KO (docs/06). Two functions are faithful re-implementations of decoded reference
// algorithms; the ladder, effects and tunables around them are ours.

import { HEALTH_EVENT_ID, toTicks } from '../core/taxonomy.js';
import { clamp, EPS } from '../core/math.js';
import { healthEventDice } from '../core/rng.js';
import { skillMul } from './skills.js';

/**
 * HealthEventProbability — decoded (docs/06 §2). All inputs by name; see the doc for each field.
 * Returns the raw (unclamped) probability, exactly as the reference computes it.
 */
export function healthEventProbability(p) {
  const pBase = p.probabilityMin + (p.probabilityMax - p.probabilityMin) * (p.fighterAttribute / 100);
  const g = p.growthNumStrikes !== 0 ? Math.min(p.numStrikesReceivedCurrentRound / p.growthNumStrikes, 1) : 1;
  const pGrow = p.probabilityInit + (pBase - p.probabilityInit) * g;

  const ratio = p.strikeDamage / Math.max(p.currentHealth, 0.001);
  const rangeD = p.damageToHealthRatioHigh - p.damageToHealthRatioLow;
  const rd = Math.abs(rangeD) > EPS ? clamp((ratio - p.damageToHealthRatioLow) / rangeD, 0, 1) : 0;
  const f1 = 1 + (p.damageHealthRatioMod - 1) * rd;

  const S = p.opponentMaxStamina * (p.staminaPercentageHigh - p.staminaPercentageLow);
  const rs = Math.abs(S) > EPS ? clamp((p.opponentCurrentStamina - p.opponentMaxStamina * p.staminaPercentageLow) / S, 0, 1) : 0;
  const f2 = p.staminaMod + (1 - p.staminaMod) * rs;

  return p.skillsMetaMod * p.skillsProbMod * f1 * f2 * pGrow;
}

/**
 * SwitchHealthEvent — decoded cold path (docs/06 §3). Pure: the same (seed, newEvent) always gives the same answer.
 * DoSwitch = (r1 <= P) && (current == none || r2 < 0.5)
 */
export function switchHealthEvent({ newProbability, randomSeed, newEvent, currentEvent }) {
  const { r1, r2 } = healthEventDice(randomSeed, HEALTH_EVENT_ID[newEvent]);
  const noneActive = currentEvent === 'none' || currentEvent === undefined;
  return r1 <= newProbability && (noneActive || r2 < 0.5);
}

export const SEVERITY = Object.freeze({ none: 0, wobbled_shot: 1, limping: 1, stun: 2, liver_shot: 2, critical_stun: 3, knockdown: 4, knockout: 5 });

/** Rating → vulnerability (0 = rock, 100 = glass) for the region group. */
export function vulnerability(defender, group) {
  const tough = defender.rating('toughness');
  const base = group === 'head' ? defender.rating('chinhealth') : group === 'body' ? defender.rating('bodyhealth') : defender.rating('leghealth');
  return Math.round(clamp(100 - (0.6 * base + 0.4 * tough), 0, 100));
}

export const regionGroup = (region) => (region === 'head' ? 'head' : region === 'body' ? 'body' : 'leg');

/**
 * Evaluate the event ladder for one landed strike (most severe first; first success wins).
 * `taken` = post-block damage; `poolCurAfter` = region pool after this strike.
 */
export function evaluateLadder({ attacker, defender, region, move, taken, poolCurAfter, seed, tun, strikesReceivedRound, counterHit = false, bonusByEvent = null }) {
  const group = regionGroup(region);
  const ladder = tun.healthEvents.ladders[group];
  const cur = defender.status.event;
  const curSev = SEVERITY[cur] ?? 0;
  const attr = vulnerability(defender, group);
  const eventMult = move.eventMult ?? 1;
  const sMul = skillMul(attacker, 'eventProb', { other: defender, move }) * eventMult * (counterHit ? 1.1 : 1);
  const rMul = skillMul(defender, 'eventResist', { other: attacker, move });
  const bonus = defender.status.nextHeavyKdBonus || 0;
  const results = [];
  for (const ev of ladder) {
    if ((SEVERITY[ev] ?? 0) < curSev) continue; // never downgrade an active event
    const prof = tun.healthEvents.profiles[`${group}.${ev}`];
    let p = healthEventProbability({
      probabilityMin: prof.pMin, probabilityMax: prof.pMax, fighterAttribute: attr,
      skillsProbMod: sMul, skillsMetaMod: rMul, damageHealthRatioMod: prof.dmgMod, strikeDamage: taken, currentHealth: poolCurAfter,
      damageToHealthRatioLow: prof.low, damageToHealthRatioHigh: prof.high, staminaMod: prof.staminaMod,
      opponentCurrentStamina: attacker.stamina, opponentMaxStamina: attacker.maxStamina,
      staminaPercentageLow: prof.spl, staminaPercentageHigh: prof.sph, probabilityInit: prof.init,
      growthNumStrikes: prof.growth, numStrikesReceivedCurrentRound: strikesReceivedRound,
    });
    if (ev === 'knockdown' && move.power === 'heavy') p += bonus;
    if (bonusByEvent && bonusByEvent[ev]) p += bonusByEvent[ev]; // e.g. plum knees add a stun chance (docs/07 §3.3)
    p = clamp(p, 0, 1);
    results.push({ event: ev, p });
    if (switchHealthEvent({ newProbability: p, randomSeed: seed, newEvent: ev, currentEvent: cur })) return { event: ev, p, results };
  }
  return { event: 'none', p: 0, results };
}

/** Apply an event's lasting effects to the defender (mode changes for knockdown/KO are handled by the sim). */
export function applyHealthEvent(defender, event, region, tun) {
  const fx = tun.healthEvents.effects[event];
  const s = defender.status;
  s.event = event;
  s.ticks = toTicks(fx.seconds ?? 0);
  s.recovery = toTicks(fx.recoverySeconds ?? 0);
  s.helpless = !!fx.helpless;
  s.moveMult = fx.moveMult ?? 1;
  s.guardMult = fx.guardMult ?? 1;
  if (event === 'critical_stun') s.nextHeavyKdBonus = fx.nextHeavyKnockdownBonus ?? 0;
  if (event === 'liver_shot') defender.spendStamina(defender.maxStamina * (fx.staminaLossFraction ?? 0));
  if (event === 'limping') { s.limpLeg = region; s.limpTicks = toTicks(fx.seconds); s.event = 'none'; s.ticks = 0; s.helpless = false; s.moveMult = 1; }
  return fx;
}

/** Per-tick status countdown. Returns 'recovered' when a helpless phase just ended, 'cleared' when the event is fully over. */
export function tickStatus(f, mashBonus = 0) {
  const s = f.status;
  let result = null;
  if (s.limpTicks > 0) { s.limpTicks--; if (s.limpTicks === 0) s.limpLeg = null; }
  if (s.ticks > 0) {
    s.ticks -= 1 + mashBonus;
    if (s.ticks <= 0) {
      s.ticks = 0;
      if (s.helpless) result = 'recovered';
      s.helpless = false;
      if (s.recovery <= 0) { s.event = 'none'; s.moveMult = 1; s.guardMult = 1; result = result ?? 'cleared'; }
      else s.moveMult = Math.max(s.moveMult, 0.6);
    }
  } else if (s.recovery > 0) {
    s.recovery--;
    if (s.recovery === 0) { s.event = 'none'; s.moveMult = 1; s.guardMult = 1; result = 'cleared'; }
  }
  if (s.nextHeavyKdBonus && s.event !== 'critical_stun') s.nextHeavyKdBonus = 0;
  return result;
}
