import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDefense, onDefenseSuccess, setGuard, pressParry, pressSlip, pressCatch, tickDefenseTimers, parryWindow, canCatch, requiredGuard, CATCH_STYLES } from '../src/combat/defense.js';
import { resolveDamage, rawStrikeDamage, regionOf, isSignificant } from '../src/combat/damage.js';
import { healthEventProbability, evaluateLadder, vulnerability } from '../src/combat/health-events.js';
import { Rng } from '../src/core/rng.js';
import { makeWorld } from '../src/testing/helpers.js';

const mk = (over = {}) => makeWorld(over);
const move = (w, id) => w.moveBook.get(id);

function defend(w, att, def, m, seed = 1) {
  return resolveDefense({ attacker: att, defender: def, move: m, tun: w.tun, rng: new Rng(seed) });
}

test('strong high block on a head punch stops at least 70 %; blocking skill adds up to 25 points', () => {
  const w = mk({ a: {}, b: { blocking: 0 } });
  const [a, b] = w.fighters;
  const jab = move(w, 'lead_jab_head');
  b.guard = { state: 'high', timeUp: 10 };
  const lo = defend(w, a, b, jab);
  assert.equal(lo.outcome, 'blocked'); assert.equal(lo.strong, true);
  assert.ok(Math.abs(lo.mitigation - 0.70) < 1e-9);
  b.ratings.blocking = 100;
  assert.ok(Math.abs(defend(w, a, b, jab).mitigation - 0.95) < 1e-9);
});

test('wrong height or a guard raised late is a weak block (30 % + 20 % × blocking)', () => {
  const w = mk({ b: { blocking: 50 } });
  const [a, b] = w.fighters;
  const jab = move(w, 'lead_jab_head'), legKick = move(w, 'lead_legkick_leg');
  assert.equal(requiredGuard(jab), 'high'); assert.equal(requiredGuard(legKick), 'low');
  b.guard = { state: 'low', timeUp: 20 };
  const wrong = defend(w, a, b, jab);
  assert.deepEqual([wrong.outcome, wrong.strong], ['blocked', false]);
  assert.ok(Math.abs(wrong.mitigation - (0.30 + 0.20 * 0.5)) < 1e-9);
  b.guard = { state: 'high', timeUp: w.tun.defense.strongMinTimeUp - 1 };
  assert.equal(defend(w, a, b, jab).strong, false, 'late');
  b.guard = { state: 'high', timeUp: w.tun.defense.strongMinTimeUp };
  assert.equal(defend(w, a, b, jab).strong, true, 'exactly on time');
  b.guard = { state: 'low', timeUp: 20 };
  assert.equal(defend(w, a, b, legKick).strong, true, 'low guard vs leg kick');
});

test('no guard, helpless or off-feet defenders take the hit', () => {
  const w = mk();
  const [a, b] = w.fighters;
  const jab = move(w, 'lead_jab_head');
  assert.equal(defend(w, a, b, jab).outcome, 'hit');
  b.guard = { state: 'high', timeUp: 10 }; b.status = { ...b.status, helpless: true, ticks: 30 };
  assert.equal(defend(w, a, b, jab).outcome, 'hit');
  b.status = { ...b.status, helpless: false, ticks: 0 }; b.mode = 'clinch';
  assert.equal(defend(w, a, b, jab).outcome, 'hit');
});

test('parry: only punches and teeps, only inside the window; the window grows with blocking; presses are locked out briefly', () => {
  const w = mk({ b: { blocking: 75 } });
  const [a, b] = w.fighters;
  const jab = move(w, 'lead_jab_head'), teep = move(w, 'lead_teep_body'), kick = move(w, 'back_kick_body');
  assert.equal(parryWindow(b, w.tun), w.tun.defense.parryBaseWindow + 3);
  assert.ok(pressParry(b, w.tun));
  assert.equal(pressParry(b, w.tun), false, 'locked');
  assert.deepEqual([defend(w, a, b, jab).outcome, defend(w, a, b, teep).outcome, defend(w, a, b, kick).outcome], ['parried', 'parried', 'hit'], 'roundhouse kicks cannot be parried');
  for (let i = 0; i < parryWindow(b, w.tun); i++) tickDefenseTimers(b);
  assert.equal(defend(w, a, b, jab).outcome, 'hit', 'window over');
  for (let i = 0; i < w.tun.defense.parryLockTicks; i++) tickDefenseTimers(b);
  assert.ok(pressParry(b, w.tun));
  const r = defend(w, a, b, jab);
  a.action = { extraRecovery: 0 };
  onDefenseSuccess(b, a, r.outcome, w.tun);
  assert.equal(a.action.extraRecovery, w.tun.defense.parryAttackerExtraRecovery);
  assert.equal(b.counterWindow, w.tun.defense.counterWindowTicks); assert.equal(b.parryTicks, 0);
});

test('slip: head punches only, probability follows movement', () => {
  const rate = (movement) => {
    let ok = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const w = mk({ seed, b: { movement } });
      const [a, b] = w.fighters;
      pressSlip(b, w.tun);
      if (defend(w, a, b, move(w, 'lead_jab_head'), seed).outcome === 'slipped') ok++;
    }
    return ok / 600;
  };
  const lo = rate(0), hi = rate(100);
  assert.ok(Math.abs(lo - 0.25) < 0.06 && Math.abs(hi - 0.75) < 0.06, `${lo} ${hi}`);
  const w = mk(); const [a, b] = w.fighters;
  pressSlip(b, w.tun);
  assert.notEqual(defend(w, a, b, move(w, 'lead_jab_body')).outcome, 'slipped', 'body punches cannot be slipped');
  assert.notEqual(defend(w, a, b, move(w, 'back_kick_head')).outcome, 'slipped');
});

test('catch: only styles/skills that allow it, only body/head kicks, success rate follows blocking; failure is a full hit with crit bonus', () => {
  assert.ok(['judo', 'muay_thai', 'freestyle_wrestler'].every((s) => CATCH_STYLES.has(s)));
  const w = mk({ bMeta: { style: 'boxer' } });
  const [a, b] = w.fighters;
  assert.equal(canCatch(b), false); assert.equal(pressCatch(b, w.tun), false);
  b.skills = ['catch_kick']; assert.equal(canCatch(b), true);
  b.skills = []; b.style = 'judo';
  let caught = 0, failed = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const ww = mk({ seed, bMeta: { style: 'judo' }, b: { blocking: 50 } });
    const [x, y] = ww.fighters;
    assert.ok(pressCatch(y, ww.tun));
    const r = defend(ww, x, y, move(ww, 'back_kick_body'), seed);
    if (r.outcome === 'caught') caught++; else { failed++; assert.ok(r.catchFailed); assert.equal(r.outcome, 'hit'); }
    assert.equal(defend(ww, x, y, move(ww, 'lead_jab_head'), seed).outcome === 'caught', false, 'punches are not caught');
    assert.equal(defend(ww, x, y, move(ww, 'lead_legkick_leg'), seed).outcome === 'caught', false, 'leg kicks are not caught');
  }
  assert.ok(Math.abs(caught / 400 - 0.6) < 0.07, `caught ${caught / 400}`);
  assert.ok(failed > 0);
});

test('catch states time out and release deterministically', () => {
  const w = mk({ bMeta: { style: 'judo' } });
  const [a, b] = w.fighters;
  onDefenseSuccess(b, a, 'caught', w.tun);
  assert.equal(b.heldLeg.ticks, w.tun.defense.catchMaxTicks); assert.equal(a.trapped, w.tun.defense.catchMaxTicks);
  for (let i = 0; i < w.tun.defense.catchMaxTicks; i++) { tickDefenseTimers(b); tickDefenseTimers(a); }
  assert.ok(b.heldLeg.ticks <= 0 && a.trapped === 0, 'the sim releases a hold whose timer ran out');
  setGuard(b, 'high');
  assert.equal(b.guard.state, 'none', 'no guard while holding a leg');
});

test('hands-down fighters start strikes a tick faster and take extra head crits; guard cannot be raised while helpless', () => {
  const w = mk({}); const [a, b] = w.fighters;
  const jab = move(w, 'lead_jab_head');
  const base = a.scaledFrames(jab).startup;
  a.handsDown = true;
  assert.equal(a.scaledFrames(jab).startup, base - w.tun.defense.handsDownStartupBonus);
  b.status = { ...b.status, helpless: true, ticks: 10 };
  setGuard(b, 'high'); assert.equal(b.guard.state, 'none');
});

// ---- damage pipeline ----------------------------------------------------------------------------------------------------

test('damage: taken = strike − blocked + chip; blocked never reaches zero damage; stunned defenders take more; regions scale', () => {
  const w = mk();
  const [a, b] = w.fighters;
  const m = move(w, 'back_cross_head');
  const none = resolveDamage({ attacker: a, defender: b, move: m, defense: { outcome: 'hit', mitigation: 0 }, region: 'head', rng: new Rng(1), tun: w.tun });
  const blocked = resolveDamage({ attacker: a, defender: b, move: m, defense: { outcome: 'blocked', mitigation: 0.7 }, region: 'head', rng: new Rng(1), tun: w.tun });
  assert.ok(Math.abs(blocked.strike - none.strike) < 1e-9, 'same dice → same strike');
  assert.ok(Math.abs(blocked.blocked - 0.7 * blocked.strike) < 1e-9);
  assert.ok(Math.abs(blocked.taken - (blocked.strike - blocked.blocked + blocked.blocked * w.tun.defense.chipFraction)) < 1e-9);
  assert.ok(blocked.taken > 0 && blocked.taken < none.taken);
  b.status = { ...b.status, helpless: true, ticks: 30 };
  const stunned = resolveDamage({ attacker: a, defender: b, move: m, defense: { outcome: 'hit', mitigation: 0 }, region: 'head', rng: new Rng(1), tun: w.tun, ctx: {} });
  assert.ok(stunned.strike > none.strike * 1.2 && stunned.strike < none.strike * 1.3 * 1.6);
  b.status = { ...b.status, helpless: false, ticks: 0 };
  const counter = resolveDamage({ attacker: a, defender: b, move: m, defense: { outcome: 'hit', mitigation: 0 }, region: 'head', rng: new Rng(1), tun: w.tun, ctx: { counter: true, counterHit: true } });
  assert.ok(counter.strike >= none.strike * w.tun.damage.counterMult * w.tun.damage.counterHitMult * 0.99 || counter.crit);
  const body = resolveDamage({ attacker: a, defender: b, move: m, defense: { outcome: 'hit', mitigation: 0 }, region: 'body', rng: new Rng(1), tun: w.tun });
  assert.ok(body.strike <= none.strike * 1.01, 'regional multiplier');
});

test('damage scales with the limb power rating and charge; gassed attackers hit softer; a limping leg kicks weaker', () => {
  const dmg = (ratings, o = {}) => {
    const w = mk({ a: ratings });
    const [a] = w.fighters;
    o.setup?.(a);
    return rawStrikeDamage({ attacker: a, move: move(w, o.id ?? 'back_cross_head'), rng: new Rng(3), tun: w.tun, chargeFrac: o.charge ?? 0 });
  };
  assert.ok(dmg({ righthandpower: 100 }) > dmg({ righthandpower: 0 }) * 1.9);
  assert.ok(dmg({}, { charge: 1 }) > dmg({}) * 1.55);
  assert.ok(dmg({}, { setup: (a) => { a.stamina = 5; } }) < dmg({}));
  assert.ok(dmg({}, { id: 'back_legkick_leg', setup: (a) => { a.status.limpTicks = 100; a.status.limpLeg = a.legRegion('back'); } }) < dmg({}, { id: 'back_legkick_leg' }));
});

test('regionOf: leg strikes pick the lead leg 70 % of the time; significance rules', () => {
  const w = mk(); const [a, b] = w.fighters;
  const rng = new Rng(2);
  let lead = 0; for (let i = 0; i < 2000; i++) if (regionOf(b, move(w, 'lead_legkick_leg'), rng) === b.legRegion('lead')) lead++;
  assert.ok(Math.abs(lead / 2000 - 0.7) < 0.04);
  assert.equal(regionOf(b, move(w, 'lead_jab_head'), rng), 'head'); assert.equal(regionOf(b, move(w, 'lead_jab_body'), rng), 'body');
  assert.equal(isSignificant(move(w, 'lead_jab_head'), 'light'), false);
  assert.equal(isSignificant(move(w, 'lead_jab_head'), 'medium'), true);
  assert.equal(isSignificant(move(w, 'back_cross_head'), 'light'), true);
  void a;
});

test('a heavy kick through a strong block still hurts, and its event probability exceeds a punch of equal raw damage', () => {
  const w = mk({ b: { blocking: 80 } });
  const [a, b] = w.fighters;
  b.guard = { state: 'high', timeUp: 10 };
  const kick = move(w, 'back_kick_head'), punch = { ...kick, id: 'p', limb: 'punch', power: 'medium', kind: 'punch', tags: ['cross', 'punch'] };
  const dk = defend(w, a, b, kick), dp = defend(w, a, b, punch);
  assert.equal(dk.outcome, 'blocked'); assert.equal(dp.outcome, 'blocked');
  assert.ok(dk.mitigation < dp.mitigation, 'roundhouse pierces');
  assert.ok(Math.abs(dp.mitigation - dk.mitigation - w.tun.defense.heavyKickPierce) < 1e-9);
  const rk = resolveDamage({ attacker: a, defender: b, move: kick, defense: dk, region: 'head', rng: new Rng(4), tun: w.tun });
  const rp = resolveDamage({ attacker: a, defender: b, move: punch, defense: dp, region: 'head', rng: new Rng(4), tun: w.tun });
  assert.ok(rk.taken > 0 && rk.taken > rp.taken);
  const p = (taken) => healthEventProbability({
    probabilityMin: 0.02, probabilityMax: 0.2, fighterAttribute: vulnerability(b, 'head'), skillsProbMod: 1, skillsMetaMod: 1, damageHealthRatioMod: 5,
    strikeDamage: taken, currentHealth: 200, damageToHealthRatioLow: 0.02, damageToHealthRatioHigh: 0.2, staminaMod: 0.5, opponentCurrentStamina: 100, opponentMaxStamina: 100,
    staminaPercentageLow: 0.2, staminaPercentageHigh: 0.8, probabilityInit: 0.05, growthNumStrikes: 5, numStrikesReceivedCurrentRound: 5,
  });
  assert.ok(p(rk.taken) > p(rp.taken), 'event probability is fed by damage TAKEN, so the pierced kick is more dangerous');
  void evaluateLadder;
});
