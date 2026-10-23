// Guard, parry, slip, catch and counter windows (docs/05).

import { clamp } from '../core/math.js';

export const CATCH_STYLES = new Set(['judo', 'muay_thai', 'freestyle_wrestler', 'greco_roman_wrestler', 'jiu_jutsu', 'jeet_kune_do']);
export const canCatch = (f) => CATCH_STYLES.has(f.style) || f.skills.includes('catch_kick');

/** Guard height needed for a strike: legs need LOW, everything else HIGH. */
export const requiredGuard = (move) => (move.target === 'leg' ? 'low' : 'high');

export function setGuard(f, state) {
  if (f.isHelpless() || f.mode !== 'standup' || f.heldLeg) state = 'none';
  if (state === f.guard.state) return;
  f.guard = { state, timeUp: 0 };
}

/** Advance defensive timers one tick. */
export function tickDefenseTimers(f) {
  if (f.guard.state !== 'none') f.guard.timeUp += 1;
  if (f.parryTicks > 0) f.parryTicks -= 1;
  if (f.parryLock > 0) f.parryLock -= 1;
  if (f.slipTicks > 0) f.slipTicks -= 1;
  if (f.catchTicks > 0) f.catchTicks -= 1;
  if (f.counterWindow > 0) f.counterWindow -= 1;
  if (f.stanceSwitchTicks > 0) f.stanceSwitchTicks -= 1;
  if (f.heldLeg) { f.heldLeg.ticks -= 1; }
  if (f.trapped > 0) f.trapped -= 1;
}

export const parryWindow = (f, tun) => tun.defense.parryBaseWindow + Math.floor(f.rating('blocking') / tun.defense.parryWindowPerBlocking);

/** Parry is a timed press: impact within `window` ticks afterwards counts. Locked briefly to stop spam. */
export function pressParry(f, tun) {
  if (f.parryLock > 0 || f.isHelpless() || f.mode !== 'standup') return false;
  f.parryTicks = parryWindow(f, tun);
  f.parryLock = tun.defense.parryLockTicks;
  f.spendStamina(tun.defense.parryStaminaCost);
  return true;
}
export function pressSlip(f, tun) {
  if (f.isHelpless() || f.mode !== 'standup' || f.slipTicks > 0) return false;
  f.slipTicks = tun.defense.slipWindow * 2;
  f.spendStamina(tun.defense.slipStaminaCost);
  return true;
}
export function pressCatch(f, tun) {
  if (!canCatch(f) || f.isHelpless() || f.mode !== 'standup') return false;
  f.catchTicks = tun.defense.catchEarly;
  return true;
}

/**
 * Decide what a defender does to an incoming strike that is geometrically in range.
 * Returns {outcome: hit|blocked|parried|slipped|caught, mitigation, strong, catchFailed?}
 */
export function resolveDefense({ attacker, defender, move, tun, rng }) {
  const d = tun.defense;
  const base = { outcome: 'hit', mitigation: 0, strong: false };
  if (defender.mode !== 'standup' || defender.isHelpless()) return base;

  const parryable = move.limb === 'punch' || (move.tags ?? []).includes('teep');
  if (defender.parryTicks > 0 && parryable) return { outcome: 'parried', mitigation: 1, strong: true };

  if (defender.slipTicks > 0 && move.target === 'head' && move.limb === 'punch') {
    const p = d.slipBase + d.slipPerMovement * defender.rating('movement') / 100;
    if (rng.chance(p)) return { outcome: 'slipped', mitigation: 1, strong: false };
  }

  if (defender.catchTicks > 0 && move.limb === 'kick' && move.target !== 'leg' && canCatch(defender)) {
    const p = 0.5 + 0.2 * defender.rating('blocking') / 100;
    if (rng.chance(p)) return { outcome: 'caught', mitigation: 1, strong: true };
    return { ...base, catchFailed: true };
  }

  const g = defender.guard;
  if (g.state !== 'none') {
    const matches = g.state === requiredGuard(move);
    const strong = matches && g.timeUp >= d.strongMinTimeUp;
    const blocking = defender.rating('blocking') / 100;
    let m = strong ? d.strongBase + d.strongPerBlocking * blocking : d.weakBase + d.weakPerBlocking * blocking;
    if (move.power === 'heavy' && move.limb === 'kick') m -= d.heavyKickPierce;
    if (defender.status.ticks > 0 || defender.status.recovery > 0) m *= defender.status.guardMult;
    return { outcome: 'blocked', mitigation: clamp(m, 0, 0.95), strong };
  }
  return base;
}

/** Side effects after a defensive success. */
export function onDefenseSuccess(defender, attacker, outcome, tun) {
  const d = tun.defense;
  if (outcome === 'parried') {
    if (attacker.action) attacker.action.extraRecovery += d.parryAttackerExtraRecovery;
    defender.counterWindow = d.counterWindowTicks;
    defender.parryTicks = 0;
  } else if (outcome === 'slipped') {
    defender.counterWindow = d.slipCounterWindowTicks;
    defender.slipTicks = 0;
  } else if (outcome === 'caught') {
    defender.heldLeg = { ticks: d.catchMaxTicks, from: attacker.id };
    defender.catchTicks = 0;
    attacker.trapped = d.catchMaxTicks; // the kicker is stuck for as long as the hold lasts (released by timeout / release)
    defender.counterWindow = Math.max(defender.counterWindow, 30);
  } else if (outcome === 'blocked') {
    defender.counterWindow = Math.max(defender.counterWindow, Math.round(d.counterWindowTicks * 0.6));
  }
}
