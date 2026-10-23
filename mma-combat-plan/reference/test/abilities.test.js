import test from 'node:test';
import assert from 'node:assert/strict';
import { AbilityBar, ABILITIES, RESULT_SCALE, scaleEffect, forceGoal, AbilityPhase, MinigameResult } from '../src/combat/abilities.js';
import { beltFromScore, beltFromCombos, validateThresholds, spendRatingPoints, BELTS } from '../src/meta/progression.js';
import { buildSituation } from '../src/core/situation.js';
import { Rng } from '../src/core/rng.js';
import { makeWorld, faceOff } from '../src/testing/helpers.js';

test('ability cooldown: never negative, ready flips exactly when the timer reaches zero, disabled phases block use', () => {
  const bar = new AbilityBar(['iron_fist', 'level_change', 'iron_grip']);
  assert.ok(bar.ready(0));
  const r = bar.use(0, 'success');
  assert.ok(r.ok);
  const total = ABILITIES.iron_fist.cooldownSecs * 60;
  assert.equal(bar.slots[0].cooldown, total);
  assert.equal(bar.use(0).reason, 'cooldown');
  for (let i = 0; i < total - 1; i++) { bar.tick(); assert.ok(!bar.ready(0)); assert.ok(bar.slots[0].cooldown > 0); }
  bar.tick(); assert.ok(bar.ready(0) && bar.slots[0].cooldown === 0);
  for (let i = 0; i < 100; i++) bar.tick();
  assert.equal(bar.slots[0].cooldown, 0, 'never negative');
  bar.disabledPhases.add(AbilityPhase.TAKEDOWN);
  assert.equal(bar.use(1).reason, 'disabled');
  assert.equal(bar.use(9).reason, 'empty');
  assert.throws(() => new AbilityBar(['nope']));
});

test('result tiers scale the effect strictly: perfect > success > fail', () => {
  const bar = new AbilityBar(['iron_fist', 'iron_fist']);
  const perfect = bar.use(0, 'perfect'), success = bar.use(1, 'success');
  assert.ok(perfect.effect.damageScale > success.effect.damageScale && success.effect.damageScale > 1);
  assert.ok(perfect.effect.critBonus > success.effect.critBonus);
  const fail = new AbilityBar(['iron_fist']).use(0, 'fail');
  assert.equal(fail.effect.damageScale, 1); assert.equal(fail.effect.critBonus, 0);
  assert.ok(RESULT_SCALE.perfect > RESULT_SCALE.success && RESULT_SCALE.success > RESULT_SCALE.fail);
  assert.deepEqual(scaleEffect({ damageScale: 1.5, stunBonus: 0.1 }, 2), { damageScale: 2, stunBonus: 0.2 });
  assert.equal(new AbilityBar(['second_wind']).use(0, MinigameResult.NONE).scale, 1, 'no minigame counts as success');
});

test('per-phase counters', () => {
  const bar = new AbilityBar(['iron_fist', 'iron_grip']);
  bar.use(0); bar.record('standup', { landed: true, damage: 12 }); bar.use(1);
  assert.deepEqual(bar.counters.standup, { played: 1, landed: 1, damage: 12 });
  assert.deepEqual(bar.counters.submission, { played: 1, landed: 0, damage: 0 });
});

test('forceGoal: forced only after consumption; empirical rate matches procChance', () => {
  assert.equal(forceGoal({ consumed: false, procChance: 1, random: 0 }), false);
  const rng = new Rng(5);
  let forced = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) if (forceGoal({ consumed: true, procChance: 0.3, random: rng.next() })) forced++;
  assert.ok(Math.abs(forced / N - 0.3) < 0.03);
});

test('training belts: thresholds must be strictly ascending; score and combo modes both give a monotone tier', () => {
  const th = [100, 250, 500, 900];
  assert.ok(validateThresholds(th));
  assert.ok(!validateThresholds([100, 100, 500, 900]) && !validateThresholds([100, 250]) && !validateThresholds([0, 1, 2, 3]));
  assert.throws(() => beltFromScore(10, [5, 4, 3, 2]));
  let prev = -1;
  for (let s = 0; s <= 1200; s += 25) { const i = BELTS.indexOf(beltFromScore(s, th)); assert.ok(i >= prev); prev = i; }
  assert.equal(beltFromScore(99, th), 'white'); assert.equal(beltFromScore(100, th), 'blue'); assert.equal(beltFromScore(900, th), 'black');
  prev = -1;
  for (let d = 0; d <= 20; d++) { const i = BELTS.indexOf(beltFromCombos(d, 20)); assert.ok(i >= prev); prev = i; }
  assert.equal(beltFromCombos(0, 20), 'white'); assert.equal(beltFromCombos(20, 20), 'black'); assert.equal(beltFromCombos(0, 0), 'white');
});

test('spendRatingPoints respects the cap and the budget', () => {
  const r = spendRatingPoints({ takedown: 95, blocking: 50 }, { takedown: 10, blocking: 10 }, 12, 100);
  assert.deepEqual(r.ratings, { takedown: 100, blocking: 57 });
  assert.equal(r.left, 0);
});

test('FighterSituation: geometry, cage flags, health, tempo and context pass-through', () => {
  const w = makeWorld();
  faceOff(w, 1.5);
  const [a, b] = w.fighters;
  const s = buildSituation(w, a, { elapsedTicks: 150, roundTicks: 300, round: 2, rounds: 3, scoreDifferential: 0.4 });
  assert.ok(Math.abs(s.range - (1.5 - a.radius - b.radius)) < 1e-9);
  assert.ok(Math.abs(s.bearing) < 1e-9 && Math.abs(Math.abs(s.opponentBearing)) < 1e-9);
  assert.equal(s.mode, 'standup'); assert.equal(s.health.head, 1); assert.equal(s.stamina, 1);
  assert.equal(s.roundTime, 0.5); assert.ok(Math.abs(s.roundNum - 2 / 3) < 1e-9); assert.equal(s.scoreDifferential, 0.4);
  assert.equal(s.cage.backAgainstCage, false);
  b.damagePool('head', 40); b.logDamage(w.tick, 40); b.lastHitTick = w.tick;
  const so = buildSituation(w, b);
  assert.ok(so.health.head < 1 && so.deltaHealth > 0 && so.inHitReaction === 1);
  assert.equal(so.opponentHealth.head, 1);
  const n = w.cage.normals[0];                         // 0.2 m from wall 0, facing along the wall normal → facing the cage
  a.pos = { x: n.x * (w.cage.apothem - 0.2), y: n.y * (w.cage.apothem - 0.2) }; a.facing = Math.atan2(n.y, n.x);
  const sc = buildSituation(w, a);
  assert.ok(sc.cage.pinned && sc.cage.facingCage && sc.cage.sector === 'front' && !sc.cage.backAgainstCage);
  a.facing += Math.PI;
  const sb = buildSituation(w, a);
  assert.ok(sb.cage.backAgainstCage && sb.cage.sector === 'back');
  assert.ok(Object.keys(s.timeSince).length === 4 && s.timeSince.stun === Infinity);
});
