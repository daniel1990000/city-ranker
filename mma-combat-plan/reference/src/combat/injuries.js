// Cuts and swelling on facial regions (docs/03 §6): staged none → swollen → cut → worse → critical, plus doctor checks.

import { clamp } from '../core/math.js';

export const FACE_REGIONS = Object.freeze(['brow', 'cheek', 'eye', 'nose', 'lip', 'jaw']);
export const STAGES = Object.freeze(['none', 'swollen', 'cut', 'worse', 'critical']);

function pickRegion(contact, rng) {
  // elbows favour the brow; fists the nose/lip/cheek; shins the cheek/jaw
  const weights = {
    elbow: [4, 2, 1.5, 1, 0.5, 0.5], foot_shin: [1, 3, 1, 1, 1, 3], fist: [1, 2, 2, 3, 2, 1], knee: [1.5, 2, 1, 2, 1, 2], shoulder: [1, 2, 1, 1, 1, 1], none: [1, 1, 1, 1, 1, 1],
  }[contact] ?? [1, 1, 1, 1, 1, 1];
  return FACE_REGIONS[rng.weightedIndex(weights)];
}

/** Register an impact on the head. Returns {region, stage} when a region advanced to a worse stage, else null. */
export function addHeadImpact(defender, move, taken, rng, tun) {
  const inj = tun.injury;
  const mult = inj.contactMult[move.contact] ?? 0.8;
  if (mult <= 0 || taken <= 0) return null;
  const cutsFactor = inj.cutsBase + defender.rating('cuts') / 100; // higher "cuts" rating = more susceptible (see docs/03 §2)
  const region = pickRegion(move.contact, rng);
  const entry = (defender.injuries[region] ??= { score: 0, stage: 0 });
  entry.score += (taken / defender.pools.head.max) * mult * cutsFactor * inj.scoreScale;
  let stage = 0;
  for (let i = 0; i < inj.stageThresholds.length; i++) if (entry.score >= inj.stageThresholds[i]) stage = i + 1;
  if (stage > entry.stage) { entry.stage = stage; return { region, stage: STAGES[stage] }; }
  return null;
}

/** 0..1 aggregate (worst region) used by the doctor and by `FIGHTER_INJURY_SEVERITY`-style displays. */
export function injurySeverity(f) {
  let worst = 0;
  for (const e of Object.values(f.injuries)) worst = Math.max(worst, e.stage);
  return worst / (STAGES.length - 1);
}

/** Between-round cutman: reduce a cut region by one stage (critical cuts need a doctor). */
export function cutmanTreat(f, rng, tun) {
  for (const e of Object.values(f.injuries)) {
    if (e.stage >= 2 && e.stage < 4 && rng.chance(tun.recovery.cutmanSuccess)) { e.stage -= 1; e.score = Math.min(e.score, tun.injury.stageThresholds[e.stage - 1] ?? 0); }
  }
}

/** Doctor check at round end / on request: probability scales with severity (docs/12 §2). */
export function doctorStops(f, rng, tun) {
  const critical = Object.values(f.injuries).some((e) => e.stage >= 4);
  if (!critical) return false;
  return rng.chance(clamp(tun.referee.doctorChanceFactor * injurySeverity(f), 0, 1));
}
