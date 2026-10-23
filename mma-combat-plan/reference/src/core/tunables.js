// All starting numbers in one place. These are ORIGINAL values chosen for sensible behaviour (see docs 04-13).
// Override by passing a partial object to mergeTunables(); data/tunables.json is generated from DEFAULT_TUNABLES.

export const DEFAULT_TUNABLES = {
  fighter: {
    radius: 0.28,                 // m (disc)
    baseSpeed: 2.0,               // m/s at movement rating 50
    movementRatingSpan: 0.30,     // speed *= 0.85 + span*rating/100
    loco: [1.0, 0.92, 0.80, 0.66, 0.55, 0.66, 0.80, 0.92], // D1..D8 (docs/11 §1.1)
    turnRateDegPerTick: 9,
    limpMult: 0.65, wobbleMult: 0.5, gassedSpeedMult: 0.9,
    reachRefCm: 180,
  },
  stamina: {
    max: 100, costScale: 0.6, regenPerSecBase: 1.9, regenPerSecRating: 1.9, guardRegenMult: 0.5, actingRegenMult: 0.0, pairedRegenMult: 0.35,
    gassedBelow: 0.2, gassedPowerMult: 0.85, betweenRoundsRecover: 0.40, switchStanceCost: 1.0,
  },
  pools: { headBase: 640, headPerChin: 4.6, bodyBase: 360, bodyPerBody: 3.4, legBase: 300, legPerLeg: 2.7, toughnessMix: 0.4 },
  damage: {
    attrBase: 0.6, attrScale: 0.8,       // attrFac = base + scale * power/100
    critMult: 1.5, counterMult: 1.20, counterHitMult: 1.15, stunnedMult: 1.25, stunnedCritBonus: 0.05,
    regionMult: { head: 0.8, body: 0.7, leg: 0.65 },
    tiers: { light: 0.010, medium: 0.022 }, // taken / pool max
    skillCap: 1.35,
    cutChancePerHit: { elbow: 0.10, foot_shin: 0.05, fist: 0.03, knee: 0.04, shoulder: 0.02, none: 0 },
    injuryStageThresholds: [0.35, 0.7, 1.0], // cumulative swelling/cut score → swollen, cut, worse, critical (see injuries.js)
  },
  defense: {
    guardRaiseTicks: 4, strongMinTimeUp: 3,
    strongBase: 0.70, strongPerBlocking: 0.25, weakBase: 0.30, weakPerBlocking: 0.20,
    heavyKickPierce: 0.15, chipFraction: 0.10, staminaPerBlockedDamage: 0.5,
    parryBaseWindow: 7, parryWindowPerBlocking: 25, parryAttackerExtraRecovery: 10, parryLockTicks: 20, parryStaminaCost: 0.5,
    slipWindow: 3, slipBase: 0.25, slipPerMovement: 0.5, slipStaminaCost: 1.0, stepBackStaminaCost: 1.5,
    counterWindowTicks: 18, slipCounterWindowTicks: 14,
    catchEarly: 6, catchMaxTicks: 180, catchFailCritBonus: 0.05,
    handsDownStartupBonus: 1, handsDownHeadCritBonus: 0.04,
  },
  strike: { aimAssistReachMult: 1.4, aimAssistDegPerTick: 6, hitStopTicks: { light: 2, medium: 4, heavy: 6 }, minChargeTicks: 15, maxChargeTicks: 48, maxChargeMult: 1.6 },
  healthEvents: {
    ladders: {
      head: ['knockout', 'knockdown', 'critical_stun', 'stun', 'wobbled_shot'],
      body: ['liver_shot', 'stun'],
      leg: ['knockdown', 'limping'],
    },
    profiles: {
      'head.wobbled_shot':  { pMin: 0.030,  pMax: 0.22,  low: 0.03, high: 0.15, dmgMod: 3.0,  staminaMod: 0.6, spl: 0.2, sph: 0.8, init: 0.040,  growth: 5 },
      'head.stun':          { pMin: 0.015,  pMax: 0.18,  low: 0.05, high: 0.20, dmgMod: 3.5,  staminaMod: 0.5, spl: 0.2, sph: 0.8, init: 0.020,  growth: 6 },
      'head.critical_stun': { pMin: 0.006,  pMax: 0.09,  low: 0.06, high: 0.25, dmgMod: 4.0,  staminaMod: 0.5, spl: 0.2, sph: 0.8, init: 0.008,  growth: 8 },
      'head.knockdown':     { pMin: 0.0007, pMax: 0.013, low: 0.07, high: 0.30, dmgMod: 6.0,  staminaMod: 0.5, spl: 0.2, sph: 0.8, init: 0.002,  growth: 10 },
      'head.knockout':      { pMin: 0.0004, pMax: 0.0075, low: 0.08, high: 0.40, dmgMod: 8.0,  staminaMod: 0.4, spl: 0.2, sph: 0.8, init: 0.0007, growth: 12 },
      'body.liver_shot':    { pMin: 0.010,  pMax: 0.12,  low: 0.04, high: 0.20, dmgMod: 4.0,  staminaMod: 0.5, spl: 0.2, sph: 0.8, init: 0.012,  growth: 6 },
      'body.stun':          { pMin: 0.010,  pMax: 0.10,  low: 0.05, high: 0.22, dmgMod: 3.0,  staminaMod: 0.5, spl: 0.2, sph: 0.8, init: 0.010,  growth: 6 },
      'leg.limping':        { pMin: 0.020,  pMax: 0.20,  low: 0.03, high: 0.18, dmgMod: 3.0,  staminaMod: 0.6, spl: 0.2, sph: 0.8, init: 0.030,  growth: 4 },
      'leg.knockdown':      { pMin: 0.001,  pMax: 0.03,  low: 0.08, high: 0.35, dmgMod: 8.0,  staminaMod: 0.5, spl: 0.2, sph: 0.8, init: 0.002,  growth: 8 },
    },
    // durations in seconds; mults apply while the event is active
    effects: {
      wobbled_shot:  { seconds: 1.2, moveMult: 0.5, guardMult: 0.5, helpless: false },
      stun:          { seconds: 2.5, recoverySeconds: 1.5, moveMult: 0.0, guardMult: 0.0, helpless: true },
      critical_stun: { seconds: 3.5, recoverySeconds: 1.5, moveMult: 0.0, guardMult: 0.0, helpless: true, nextHeavyKnockdownBonus: 0.25 },
      knockdown:     { seconds: 2.0, helpless: true },
      knockout:      { seconds: 600, moveMult: 0.0, guardMult: 0.0, helpless: true },
      liver_shot:    { seconds: 2.5, moveMult: 0.0, guardMult: 0.0, helpless: true, staminaLossFraction: 0.25 },
      limping:       { seconds: 10, moveMult: 0.65, kickMult: 0.7, helpless: false },
    },
    stunnedDamageMult: 1.25,
    recoveryMashMaxReduction: 0.30,
  },
  clinch: {
    range: 0.30, entryBase: 0.45, entryPerRating: 0.004, entryStrikingPenalty: 0.15, entryGuardPenalty: 0.10, entryMin: 0.10, entryMax: 0.90,
    domBase: 0.5, domPerRating: 0.005, domMin: 0.15, domMax: 0.85,
    pairSpeedMult: 0.4, resistK: 0.3, staminaPerSecDom: 0.6, staminaPerSecSub: 0.9, staminaPerSecPlum: 0.8,
    cagePinDistance: 0.6, cageEscapePenalty: 0.25,
    breakBase: 0.35, breakPerRating: 0.004, breakGap: 0.9,
    positionStrikeMult: { thai: 1.25, over_under: 0.8, double_under: 0.8, single_collar: 0.9, back_clinch: 0.85 },
    plumHeadKneeMult: 1.3, plumStunBonus: 0.04, subBlockStrength: 0.5,
    pummelBase: 0.40, pummelPerRating: 0.004,
    takedownBase: { hip_throw: 0.30, judo_throw: 0.28, bodylock_throw: 0.34, suplex: 0.30, trip: 0.32, leg: 0.33, throw: 0.30, leg_grab: 0.30 },
    takedownPerRating: 0.004, takedownThrowsPerRating: 0.003, subTakedownPenalty: 0.08, cageTakedownBonus: 0.06, whizzerPenalty: 0.12, subStrikeMult: 0.85, contestTicks: 36,
    lowActionWarnSeconds: 5, breakSeconds: 8,
    actionCooldownTicks: 30,
  },
  takedown: {
    shotRange: 0.95, startup: 14, recoveryMiss: 10, staminaEntry: 5, staminaPerSecContest: 1.0, minStamina: 6,
    base: 0.50, perRating: 0.004, cageBonus: 0.10, sprawlInputPenalty: 0.15, staminaDiffWeight: 0.10, pMin: 0.05, pMax: 0.95,
    contestTicks: 60, resolver: 'auto', contactGap: 0.12, closeExtra: 0.10, counterStaggerTier: 'heavy', cooldownTicks: 1500, minorBonus: 0.06, minorStaminaMult: 0.75, scrambleInitiative: 0.10,
    meter: { startDelay: 0.3, duration: 1.4, numPasses: 2, scoreSizeMin: 0.12, scoreSizeMax: 0.35, perfectZoneSize: 0.06 },
    sprawlChance: 0.35, sprawlPerDefense: 0.003, counterWindow: 10,
    slamDamageFraction: [0.02, 0.05],
    styleBonus: { freestyle_wrestler: 0.06, greco_roman_wrestler: 0.05, judo: 0.04, jiu_jutsu: 0.03, muay_thai: -0.02, boxer: -0.03, karate: -0.03, kickboxer: -0.03, tae_kwon_do: -0.03, jeet_kune_do: 0.0 },
  },
  ground: {
    transitionCooldownTicks: 90, staminaPerAttempt: 3, failedAttemptFreeTicks: 10,
    topBase: 0.45, topPerRating: 0.004, bottomBase: 0.30, bottomPerRating: 0.004, movementWeight: 0.003,
    noHooksBonus: 0.20, activeDefencePenalty: 0.10, staminaDeficitWeight: 0.002, activeDefenceTicks: 40,
    pTopMin: 0.05, pTopMax: 0.92, pBottomMin: 0.05, pBottomMax: 0.85, sweepShare: 0.35,
    downedFollowUpTicks: 150, getUpGap: 0.7, standUpGap: 1.6,
    hold: { guard: 0.0, halfguard: 0.05, stacked_guard: 0.05, rubber_guard: 0.05, sidecontrol: 0.15, sidesaddle: 0.15, northsouth: 0.18, fullmount: 0.25, crucifix: 0.30, backmount: 0.28, back_sidemount: 0.20, sprawl: 0.0, downed: 0.0 },
    gnpMult: { downed: 1.1, sprawl: 0.7, guard: 0.55, halfguard: 0.8, stacked_guard: 0.65, rubber_guard: 0.4, sidecontrol: 1.0, sidesaddle: 0.95, northsouth: 1.0, fullmount: 1.2, crucifix: 1.3, backmount: 0.9, back_sidemount: 0.9 },
    brokenPostureMult: 0.5, postureBreakTicks: 45, coverMitigation: 0.4,
    getUpBase: 0.40, getUpPerRating: 0.004, getUpBrokenBonus: 0.15, getUpCageBonus: 0.20, sprawlGetUpBonus: 0.35,
    gnpStamina: 2.5, staminaPerSecTop: 0.5, staminaPerSecBottom: 0.7,
    gnpIntervalTicks: 24,
  },
  submission: {
    startBase: 0.25, startPerRating: 0.004, startMin: 0.10, startMax: 0.90, attemptCooldownTicks: 300,
    stageBase: 0.46, stagePerRating: 0.003, stagePenaltyPerStage: 0.03, stageMin: 0.10, stageMax: 0.90,
    stageTicks: 75, stages: 5, stageDamage: { choke: 0.20, lock: 0.20 }, startDepth: 2, staminaDiffWeight: 0.10,
    staminaPerSecAttacker: 1.3, staminaPerSecDefender: 1.7, abortStamina: 0.08,
    tapDamageThreshold: 1.0, tapBase: 0.92, tapToughnessWeight: 0.004, tapMin: 0.40, tapMax: 0.98,
    chokeKoRestTicks: 240, lockInjuryFraction: 1.0,
    mode: 'auto',                       // auto | meter | snipe | gate
    meter: { startDelay: 0.4, duration: 1.6, numPasses: 2, scoreSizeMin: 0.12, scoreSizeMax: 0.35, perfectZoneSize: 0.06 },
    gateTicks: 36, snipeCountUpTime: 40, snipeCountDownTime: 34, snipeDelayTicks: 60, snipeSpeedUp: 6, snipeMinDelay: 18,
  },
  referee: {
    lowActionWarnSeconds: 5, standupBreakSeconds: 10, groundIdleSeconds: 10,
    tkoUnansweredHeavy: 3, tkoUnansweredAny: 7, tkoWindowSeconds: 3, tkoHeadFraction: 0.05, tkoStunnedChance: 0.35,
    doctorChanceFactor: 0.5,
    roundSeconds: 300, restSeconds: 60, secondsOut: 10,
  },
  recovery: { bodyLegFraction: 0.04, headFraction: 0.03, cutmanSuccess: 0.7 },
  scoring: {
    weights: {
      effective_striking: 0.26, damage: 0.26, health_events: 0.14, takedowns_performed: 0.05, takedowns_denied: 0.02,
      ground_dominance: 0.07, clinch_dominance: 0.03, passes_performed: 0.02, passes_denied: 0.01, submissions: 0.05,
      submissions_escaped: 0.02, blocks_and_parries: 0.07,
    },
    eventValue: { wobbled_shot: 1, stun: 2, critical_stun: 3.5, knockdown: 8, liver_shot: 2, limping: 1.5, knockout: 20 },
    targetValue: { head: 1.0, body: 0.7, leg: 0.6 },
    ten8Margin: 0.38, ten8SoftMargin: 0.20, ten7Margin: 0.55, drawMargin: 0.004, judgeWeightJitter: 0.05,
  },
  ai: {
    aggression: {
      min: 0.05, max: 0.98, base: 0.5,
      weights: { opp_health_head: -0.35, opp_stamina: -0.20, stamina: 0.25, health_head: 0.20, in_hit_reaction: -0.30, score_differential: -0.25, round_time: 0.10, idle: 0.15, opp_strike_activity: -0.10, delta_health: -0.15 },
    },
    difficulty: {
      beginner: { reactionTicks: 26, reactionJitter: 8, defend: 0.30, tau: 0.80, maxCombo: 2 },
      pro:      { reactionTicks: 16, reactionJitter: 5, defend: 0.55, tau: 0.55, maxCombo: 2 },
      champion: { reactionTicks: 8,  reactionJitter: 3, defend: 0.78, tau: 0.35, maxCombo: 3 },
    },
    gapTicks: { slow: 640, fast: 230 },   // pause after an attack plan: lerp(slow, fast, aggression)
    rePlanTicks: [12, 24],             // re-decide this often while only moving
  },
};

export function deepMerge(base, over) {
  if (over === undefined || over === null) return structuredClone(base);
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return structuredClone(over);
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(over)])) {
    out[k] = k in over ? deepMerge(base[k], over[k]) : structuredClone(base[k]);
  }
  return out;
}

export const mergeTunables = (over) => deepMerge(DEFAULT_TUNABLES, over ?? {});
