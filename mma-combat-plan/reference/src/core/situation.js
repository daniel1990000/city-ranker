// FighterSituation (docs/03 §7, docs/13 §2): a read-only snapshot of everything the AI, the commentary and the HUD ask about
// one fighter this tick. Built on demand by `buildSituation`; nothing in the sim reads it back, so it can never desync.

import { Mode, TICK_HZ } from './taxonomy.js';
import { vAngle, vSub, wrapPi, clamp } from './math.js';

const poolFractions = (f) => ({
  head: f.poolFraction('head'), body: f.poolFraction('body'), legL: f.poolFraction('legL'), legR: f.poolFraction('legR'), overall: f.overallHealthFraction(),
});
const poolTotal = (f) => f.pools.head.max + f.pools.body.max + f.pools.legL.max + f.pools.legR.max;

/**
 * @param ctx optional match context {elapsedTicks, roundTicks, round, rounds, scoreDifferential}; omitted → neutral values
 */
export function buildSituation(world, f, ctx = {}) {
  const o = world.opp(f), tick = world.tick;
  const toOpp = vSub(o.pos, f.pos);
  const sense = world.cage.sense(f.pos, f.facing, f.radius), oSense = world.cage.sense(o.pos, o.facing, o.radius);
  const since = (id, key) => world.stats.ticksSince(id, key, tick) / TICK_HZ;
  const idleSeconds = (x) => (tick - x.lastActionTick) / TICK_HZ;
  const hitReaction = (x) => (tick - x.lastHitTick < 24 || x.status.ticks > 0 ? 1 : 0);
  return {
    tick, id: f.id, opponentId: o.id, mode: f.mode, opponentMode: o.mode, userControlled: f.human,
    range: world.gap(f, o), centreDistance: Math.hypot(toOpp.x, toOpp.y),
    bearing: wrapPi(vAngle(toOpp) - f.facing),                       // where the opponent is relative to my facing
    opponentBearing: wrapPi(vAngle({ x: -toOpp.x, y: -toOpp.y }) - o.facing),
    cage: { gap: sense.gap, sector: sense.sector, pinned: sense.pinned, backAgainstCage: f.backAgainstCage || sense.backAgainstCage, facingCage: sense.facingCage, backExposed: sense.backAgainstCage, fenceDominance: f.fenceDominance },
    opponentCage: { gap: oSense.gap, sector: oSense.sector, pinned: oSense.pinned, backAgainstCage: o.backAgainstCage || oSense.backAgainstCage, facingCage: oSense.facingCage, fenceDominance: o.fenceDominance },
    health: poolFractions(f), opponentHealth: poolFractions(o),
    stamina: f.staminaFraction(), opponentStamina: o.staminaFraction(),
    deltaHealth: clamp(f.recentDamage(tick) / (poolTotal(f) * 0.25), 0, 1),          // damage taken in the last 8 s, 25 % of all pools = 1
    opponentDeltaHealth: clamp(o.recentDamage(tick) / (poolTotal(o) * 0.25), 0, 1),
    inHitReaction: hitReaction(f), opponentInHitReaction: hitReaction(o),
    idleSeconds: idleSeconds(f), idle: clamp(idleSeconds(f) / 5, 0, 1), opponentIdle: clamp(idleSeconds(o) / 5, 0, 1),
    opponentStrikeActivity: clamp(o.strikeLog.length / 5 / 3, 0, 1),                  // strikes per second / 3
    strikeActivity: clamp(f.strikeLog.length / 5 / 3, 0, 1),
    roundTime: ctx.roundTicks ? clamp((ctx.elapsedTicks ?? 0) / ctx.roundTicks, 0, 1) : 0,
    roundNum: ctx.rounds ? clamp((ctx.round ?? 1) / ctx.rounds, 0, 1) : 0,
    scoreDifferential: ctx.scoreDifferential ?? 0,
    handsDown: f.handsDown, isStunned: f.isHelpless(), isCircling: Math.hypot(f.vel.x, f.vel.y) > 0.4 && Math.abs(Math.sin(wrapPi(vAngle(f.vel) - vAngle(toOpp)))) > 0.7,
    flatOnMat: f.mode === Mode.DOWN || (f.mode === Mode.GROUND && f.groundRole === 'sub'),
    inDominantStatus: !!(f.bout && f.bout.kind === 'ground' && f.bout.top === f && f.bout.dominant),
    inSubmissionAttempt: f.mode === Mode.SUBMISSION,
    groundPosition: f.bout && f.bout.kind === 'ground' ? f.bout.position : null,
    groundRole: f.groundRole,
    timeSince: { stun: since(f.id, 'stunned'), knockdown: since(f.id, 'knockdown'), takedownLanded: since(f.id, 'takedown_landed'), hit: since(f.id, 'hit') },
    busy: f.busy(), canAct: !f.isHelpless() && f.mode !== Mode.FINISHED,
  };
}
