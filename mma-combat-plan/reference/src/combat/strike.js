// Strike lifecycle, hit detection, aim assist, feints, cancels (docs/04 §2-3).

import { vDist, vSub, vAngle, angleDiff, rad, wrapPi, clamp } from '../core/math.js';
import { inCancelWindow } from './moves.js';
import { actionStaminaCost } from './stamina.js';

export const Phase = Object.freeze({ STARTUP: 'startup', ACTIVE: 'active', RECOVERY: 'recovery', DONE: 'done' });

export function actionPhase(a) {
  const { startup, active, recovery } = a.frames;
  if (a.tick < startup) return Phase.STARTUP;
  if (a.tick < startup + active) return Phase.ACTIVE;
  if (a.tick < startup + active + recovery + a.extraRecovery) return Phase.RECOVERY;
  return Phase.DONE;
}

export function canStartStrike(f, move, tick) {
  if (f.mode !== 'standup' || f.isHelpless() || f.stanceSwitchTicks > 0 || f.trapped > 0) return false;
  if (f.heldLeg && move.limb !== 'punch') return false;   // holding a caught leg: punches only
  if (f.action) {
    // buffered cancel: only inside the current move's cancel window and when the next move is allowed to follow
    const cur = f.action.move;
    const into = new Set(cur.cancel?.into ?? []);
    const allowed = (move.tags ?? []).some((t) => into.has(t));
    return allowed && inCancelWindow(cur, f.action.tick);
  }
  return true;
}

/** Start (or cancel into) a strike. `charge` in ticks scales damage and delays the hit. */
export function startStrike(f, move, tick, tun, { chargeTicks = 0 } = {}) {
  const s = tun.strike;
  const chargeFrac = clamp((chargeTicks - s.minChargeTicks) / (s.maxChargeTicks - s.minChargeTicks), 0, 1);
  const frames = f.scaledFrames(move);
  frames.startup += Math.round(4 * chargeFrac);
  const cancelled = !!f.action;
  f.action = { move, tick: 0, startTick: tick, frames, extraRecovery: f.recoveryExtra, resolved: false, chargeFrac, hitStop: 0, fromCancel: cancelled };
  f.recoveryExtra = 0;
  f.spendStamina(actionStaminaCost(f, move.stamina) * (cancelled ? 1.1 : 1));
  // combo bookkeeping
  if (tick - f.combo.lastTick <= 40) f.combo.count += 1; else f.combo.count = 1;
  f.combo.lastTick = tick;
  return f.action;
}

/** Feint: abort a strike in its first few startup ticks (cheap, provokes a reaction). */
export function tryFeint(f, maxTick = 5) {
  const a = f.action;
  if (!a || actionPhase(a) !== Phase.STARTUP || a.tick > maxTick) return false;
  f.action = null;
  f.spendStamina(0.8);
  return true;
}

/** Geometric hit test for a live (active-phase) strike. */
export function hitTest(att, def, move) {
  const gap = vDist(att.pos, def.pos);
  const reach = move.reach * att.reachFactor;
  const toDef = vAngle(vSub(def.pos, att.pos));
  const ang = Math.abs(angleDiff(toDef, att.facing));
  const inRange = gap <= reach && gap >= (move.minReach ?? 0);
  const inWedge = ang <= rad(move.wedgeDeg);
  return { hit: inRange && inWedge, gap, ang, reach };
}

/** "Magnet": rotate facing toward the opponent during startup if they are close enough to plausibly connect. */
export function applyAimAssist(att, def, move, tun) {
  const gap = vDist(att.pos, def.pos);
  if (gap > move.reach * att.reachFactor * tun.strike.aimAssistReachMult) return;
  const toDef = vAngle(vSub(def.pos, att.pos));
  const diff = wrapPi(toDef - att.facing);
  const step = rad(tun.strike.aimAssistDegPerTick);
  att.facing = wrapPi(att.facing + clamp(diff, -step, step));
}

/** Damage tier of a landed strike by fraction of the target pool. */
export function damageTier(taken, poolMax, tun) {
  const frac = taken / Math.max(poolMax, 1);
  return frac >= tun.damage.tiers.medium ? 'heavy' : frac >= tun.damage.tiers.light ? 'medium' : 'light';
}
