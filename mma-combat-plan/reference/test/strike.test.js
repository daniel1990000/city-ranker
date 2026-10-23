import test from 'node:test';
import assert from 'node:assert/strict';
import { actionPhase, Phase, canStartStrike, startStrike, tryFeint, hitTest, applyAimAssist, damageTier } from '../src/combat/strike.js';
import { MoveBook, validateMove, inCancelWindow } from '../src/combat/moves.js';
import { buildDefaultMoves } from '../src/data/default-moves.js';
import { Fighter } from '../src/combat/fighter.js';
import { actionStaminaCost, regenStamina, recoverBetweenRounds } from '../src/combat/stamina.js';
import { skillMul, skillAdd, SKILLS } from '../src/combat/skills.js';
import { addHeadImpact, injurySeverity, cutmanTreat, doctorStops, STAGES } from '../src/combat/injuries.js';
import { Rng } from '../src/core/rng.js';
import { Slot, Limb, Side, Target } from '../src/core/taxonomy.js';
import { makeWorld } from '../src/testing/helpers.js';

const book = new MoveBook(buildDefaultMoves());

test('every bundled move validates; the move book covers all four limb cells and all three targets', () => {
  for (const m of book.all()) assert.deepEqual(validateMove(m), [], m.id);
  const cells = new Set(book.all().filter((m) => (m.mode ?? 'standup') === 'standup').map((m) => `${m.limb}|${m.side}`));
  assert.equal(cells.size, 4);
  const targets = new Set(book.all().map((m) => m.target));
  assert.deepEqual([...targets].sort(), ['body', 'head', 'leg']);
  assert.deepEqual([...new Set(book.all().map((m) => m.mode ?? 'standup'))].sort(), ['clinch', 'ground', 'standup']);
  assert.ok(book.all().length >= 37);
  // cancel windows start only after the move has had its active frames
  for (const m of book.all()) for (const [a, b] of m.cancel.out) assert.ok(a >= m.frames.startup + m.frames.active && b <= m.frames.startup + m.frames.active + m.frames.recovery, m.id);
});

test('validateMove reports each kind of mistake', () => {
  const ok = book.get('lead_jab_head');
  const bad = { ...ok, id: '', limb: 'elbow', side: 'x', slot: 'y', target: 'z', power: 'w', contact: 'q', frames: { startup: 0, active: 1, recovery: 1 }, reach: 0, damage: { base: 0, range: 1 }, blockHeight: 'mid', cancel: { out: [[5, 3]], into: [] } };
  const errs = validateMove(bad);
  for (const word of ['id required', 'bad limb', 'bad side', 'bad slot', 'bad target', 'bad power', 'bad contact', 'frames', 'reach', 'damage.base', 'blockHeight', 'cancel window']) assert.ok(errs.some((e) => e.includes(word)), word);
  assert.throws(() => new MoveBook([bad]), /invalid move/);
});

test('select: exact cell first, then relaxes slot, then side; power filters when it can; allowed loadout filters', () => {
  assert.equal(book.select({ limb: Limb.PUNCH, side: Side.LEAD, slot: Slot.BASIC, target: Target.HEAD }).id, 'lead_jab_head');
  assert.equal(book.select({ limb: Limb.PUNCH, side: Side.BACK, slot: Slot.BASIC, target: Target.HEAD }).id, 'back_cross_head');
  assert.equal(book.select({ limb: Limb.PUNCH, side: Side.LEAD, slot: Slot.TECH_SIG, target: Target.HEAD }).id, 'lead_jab_head', 'unknown slot falls back to basic');
  assert.equal(book.select({ limb: Limb.PUNCH, side: Side.BACK, slot: Slot.BASIC, target: Target.LEG }), null, 'no punch to the legs');
  assert.equal(book.select({ limb: Limb.KICK, side: Side.LEAD, slot: Slot.BASIC, target: Target.LEG }).id, 'lead_legkick_leg');
  assert.equal(book.select({ limb: Limb.PUNCH, side: Side.LEAD, slot: Slot.TECH, target: Target.HEAD, power: 'medium' }).id, 'lead_hook_head');
  assert.equal(book.select({ limb: Limb.PUNCH, side: Side.LEAD, slot: Slot.BASIC, target: Target.HEAD, power: 'heavy' }).id, 'lead_jab_head', 'power is a preference, not a requirement');
  assert.equal(book.select({ limb: Limb.PUNCH, side: Side.LEAD, slot: Slot.BASIC, target: Target.HEAD, allowed: new Set(['back_cross_head']) }).id, 'back_cross_head', 'falls back across sides inside the loadout');
  assert.equal(book.select({ mode: 'clinch', limb: Limb.KICK, side: Side.BACK, slot: Slot.BASIC, target: Target.HEAD }).id, 'clinch_knee_head');
  const pick = book.select({ limb: Limb.PUNCH, side: Side.LEAD, slot: Slot.BASIC, target: Target.HEAD, rng: new Rng(1) });
  assert.ok(pick);
  assert.ok(book.chainable(book.get('lead_jab_head')).every((m) => m.tags.some((t) => book.get('lead_jab_head').cancel.into.includes(t))));
  assert.ok(book.chainable(book.get('lead_jab_head')).some((m) => m.id === 'back_cross_head'));
  assert.ok(inCancelWindow(book.get('lead_jab_head'), 7) && !inCancelWindow(book.get('lead_jab_head'), 6) && !inCancelWindow(book.get('lead_jab_head'), 30));
});

test('action lifecycle: startup → active → recovery → done at the right ticks; extra recovery lengthens it; scaling by speed, gassing and hands-down', () => {
  const w = makeWorld({ a: { punchspeed: 50 } });
  const [a] = w.fighters;
  const jab = book.get('lead_jab_head');
  const act = startStrike(a, jab, 10, w.tun);
  const f = act.frames;
  assert.deepEqual([f.startup, f.active, f.recovery], [5, 2, 9]);
  const phases = [];
  for (let t = 0; t < 20; t++) { act.tick = t; phases.push(actionPhase(act)); }
  assert.deepEqual(phases.slice(0, 5), Array(5).fill(Phase.STARTUP));
  assert.deepEqual(phases.slice(5, 7), Array(2).fill(Phase.ACTIVE));
  assert.equal(phases[7], Phase.RECOVERY); assert.equal(phases[15], Phase.RECOVERY); assert.equal(phases[16], Phase.DONE);
  act.extraRecovery = 10; act.tick = 25;
  assert.equal(actionPhase(act), Phase.RECOVERY); act.tick = 26;
  assert.equal(actionPhase(act), Phase.DONE);

  const fast = makeWorld({ a: { punchspeed: 100 } }).fighters[0].scaledFrames(jab), slow = makeWorld({ a: { punchspeed: 0 } }).fighters[0].scaledFrames(jab);
  assert.ok(fast.startup < slow.startup && fast.recovery < slow.recovery);
  const g = makeWorld({ a: { punchspeed: 50 } }).fighters[0]; g.stamina = 5;
  assert.ok(g.scaledFrames(jab).startup >= f.startup && g.scaledFrames(jab).recovery > f.recovery, 'gassed fighters are slower');
  assert.equal(f.active, jab.frames.active);
});

test('starting a strike: stamina, combos (within 40 ticks), charge delays the hit, cancels cost 10 % more', () => {
  const w = makeWorld();
  const [a] = w.fighters;
  const jab = book.get('lead_jab_head'), cross = book.get('back_cross_head');
  const s0 = a.stamina;
  const first = startStrike(a, jab, 100, w.tun);
  assert.ok(Math.abs(s0 - a.stamina - actionStaminaCost(a, jab.stamina)) < 1e-9);
  assert.equal(a.combo.count, 1);
  const before = a.stamina;
  const second = startStrike(a, cross, 120, w.tun);
  assert.equal(a.combo.count, 2); assert.equal(second.fromCancel, true);
  assert.ok(Math.abs(before - a.stamina - actionStaminaCost(a, cross.stamina) * 1.1) < 1e-9);
  a.action = null;
  startStrike(a, jab, 300, w.tun);
  assert.equal(a.combo.count, 1, 'too long since the last strike');
  a.action = null;
  const charged = startStrike(a, cross, 400, w.tun, { chargeTicks: 100 });
  a.action = null;
  const plain = startStrike(a, cross, 500, w.tun);
  assert.equal(charged.chargeFrac, 1); assert.equal(charged.frames.startup, plain.frames.startup + 4);
  assert.ok(first.frames.startup > 0);
});

test('canStartStrike: only standing, un-stunned, un-trapped fighters; a busy fighter only inside a cancel window and only into allowed tags', () => {
  const w = makeWorld();
  const [a] = w.fighters;
  const jab = book.get('lead_jab_head'), cross = book.get('back_cross_head'), kick = book.get('back_kick_head');
  assert.ok(canStartStrike(a, jab, 0));
  a.mode = 'clinch'; assert.equal(canStartStrike(a, jab, 0), false); a.mode = 'standup';
  a.status = { ...a.status, helpless: true, ticks: 5 }; assert.equal(canStartStrike(a, jab, 0), false); a.status = { ...a.status, helpless: false, ticks: 0 };
  a.stanceSwitchTicks = 3; assert.equal(canStartStrike(a, jab, 0), false); a.stanceSwitchTicks = 0;
  a.trapped = 5; assert.equal(canStartStrike(a, jab, 0), false); a.trapped = 0;
  a.heldLeg = { ticks: 50, from: 'b' };
  assert.equal(canStartStrike(a, kick, 0), false); assert.equal(canStartStrike(a, jab, 0), true, 'punches only while holding a leg');
  a.heldLeg = null;
  a.action = { move: jab, tick: 3 };
  assert.equal(canStartStrike(a, cross, 0), false, 'inside startup');
  a.action.tick = 7; assert.equal(canStartStrike(a, cross, 0), true, 'cancel window open, cross follows a jab');
  assert.equal(canStartStrike(a, kick, 0), false, 'a head kick is not in the jab\'s branch list');
  a.action.tick = 20; assert.equal(canStartStrike(a, cross, 0), false, 'window closed');
});

test('feint: only early in startup, costs a little stamina, cancels the move', () => {
  const w = makeWorld(); const [a] = w.fighters;
  startStrike(a, book.get('back_cross_head'), 0, w.tun);
  a.action.tick = 3;
  const s = a.stamina;
  assert.ok(tryFeint(a));
  assert.equal(a.action, null); assert.ok(Math.abs(s - a.stamina - 0.8) < 1e-9);
  assert.equal(tryFeint(a), false, 'nothing to feint');
  startStrike(a, book.get('back_cross_head'), 0, w.tun); a.action.tick = 6;
  assert.equal(tryFeint(a), false, 'too late');
  a.action.tick = 9; assert.equal(tryFeint(a), false, 'active');
});

test('hit test: reach (scaled by the reach factor), minimum reach and the wedge are all boundaries', () => {
  const w = makeWorld(); const [a, b] = w.fighters;
  const jab = book.get('lead_jab_head'), reach = jab.reach * a.reachFactor;
  const at = (d, angle = 0) => { a.pos = { x: 0, y: 0 }; a.facing = 0; b.pos = { x: Math.cos(angle) * d, y: Math.sin(angle) * d }; return hitTest(a, b, jab).hit; };
  assert.ok(at(reach - 0.01)); assert.ok(!at(reach + 0.01));
  assert.ok(at(0.5, (jab.wedgeDeg - 1) * Math.PI / 180)); assert.ok(!at(0.5, (jab.wedgeDeg + 1) * Math.PI / 180));
  const longArms = makeWorld({ aMeta: { physique: { reachCm: 200 } } }).fighters[0], shortArms = makeWorld({ aMeta: { physique: { reachCm: 160 } } }).fighters[0];
  assert.ok(longArms.reachFactor > a.reachFactor && a.reachFactor > shortArms.reachFactor);
  assert.ok(longArms.reachFactor <= 1.12 && shortArms.reachFactor >= 0.9);
  const sup = book.get('back_superman_head');
  assert.ok(sup.reach > jab.reach);
  const inside = { ...jab, minReach: 0.6 };
  a.pos = { x: 0, y: 0 }; b.pos = { x: 0.5, y: 0 };
  assert.equal(hitTest(a, b, inside).hit, false, 'too close for a move with a minimum reach');
});

test('aim assist: rotates toward the opponent by at most the tunable step, only when close enough', () => {
  const w = makeWorld(); const [a, b] = w.fighters;
  const jab = book.get('lead_jab_head');
  a.pos = { x: 0, y: 0 }; a.facing = 0; b.pos = { x: 0, y: 1 };
  applyAimAssist(a, b, jab, w.tun);
  const step = w.tun.strike.aimAssistDegPerTick * Math.PI / 180;
  assert.ok(Math.abs(a.facing - step) < 1e-9);
  a.facing = 0; b.pos = { x: 0, y: 3 };
  applyAimAssist(a, b, jab, w.tun);
  assert.equal(a.facing, 0, 'too far to bother');
});

test('damage tiers follow the pool-relative thresholds', () => {
  const w = makeWorld();
  const { light, medium } = w.tun.damage.tiers;
  assert.equal(damageTier(light * 100 - 0.01, 100, w.tun), 'light');
  assert.equal(damageTier(light * 100, 100, w.tun), 'medium');
  assert.equal(damageTier(medium * 100 - 0.01, 100, w.tun), 'medium');
  assert.equal(damageTier(medium * 100, 100, w.tun), 'heavy');
});

test('stamina: costs scale with skills, regen depends on rating and activity, rounds restore a share of the deficit', () => {
  const w = makeWorld({ aMeta: { skills: ['marathoner'] } });
  const [a, b] = w.fighters;
  assert.ok(actionStaminaCost(a, 10) < actionStaminaCost(b, 10));
  a.stamina = 50; b.stamina = 50;
  regenStamina(a, w.tun); regenStamina(b, w.tun, { acting: true });
  assert.ok(a.stamina > 50 && b.stamina === 50, 'acting stops regeneration');
  b.stamina = 50; regenStamina(b, w.tun, { paired: true });
  const paired = b.stamina - 50; b.stamina = 50; regenStamina(b, w.tun);
  assert.ok(paired > 0 && paired < b.stamina - 50);
  a.stamina = 20; a.pools.head.cur = 100; a.pools.body.cur = 50;
  recoverBetweenRounds(a, w.tun);
  assert.ok(Math.abs(a.stamina - (20 + w.tun.stamina.betweenRoundsRecover * 80)) < 1e-9);
  assert.equal(a.pools.head.cur, 100 + w.tun.recovery.headFraction * a.pools.head.max);
  const hi = makeWorld({ a: { stamina: 100 } }).fighters[0], lo = makeWorld({ a: { stamina: 0 } }).fighters[0];
  hi.stamina = lo.stamina = 10; regenStamina(hi, w.tun); regenStamina(lo, w.tun);
  assert.ok(hi.stamina > lo.stamina);
});

test('skills combine multiplicatively / additively and respect their conditions', () => {
  const w = makeWorld({ aMeta: { skills: ['heavy_handed', 'vicious_kicks', 'last_stand', 'iron_clinch'] } });
  const [a] = w.fighters;
  const punch = book.get('lead_jab_head'), kick = book.get('back_kick_head');
  assert.equal(skillMul(a, 'damage', { move: punch }), 1.08); assert.equal(skillMul(a, 'damage', { move: kick }), 1.08);
  assert.equal(skillAdd(a, 'clinch'), 8);
  assert.equal(skillMul(a, 'eventProb', { move: punch }), 1, 'last stand needs a hurt head');
  a.pools.head.cur = a.pools.head.max * 0.2;
  assert.ok(Math.abs(skillMul(a, 'eventProb', { move: punch }) - 1.10) < 1e-9);
  assert.ok(Math.abs(skillMul(a, 'damage', { move: punch }) - 1.08 * 1.15) < 1e-9);
  assert.equal(skillMul(a, 'nothing'), 1);
  assert.equal(Object.keys(SKILLS).length, 10);
});

test('injuries: cuts and swelling stage up with impact × contact × cuts rating; cutman and doctor', () => {
  const w = makeWorld(); const [a, b] = w.fighters;
  const rng = new Rng(2);
  const elbow = book.get('back_elbow_head'), jab = book.get('lead_jab_head');
  let stage = null;
  for (let i = 0; i < 60 && !stage; i++) stage = addHeadImpact(b, elbow, 60, rng, w.tun);
  assert.ok(stage && STAGES.includes(stage.stage));
  assert.ok(injurySeverity(b) > 0 && injurySeverity(b) <= 1);
  const soft = makeWorld({ b: { cuts: 0 } }).fighters[1], delicate = makeWorld({ b: { cuts: 100 } }).fighters[1];
  const score = (f) => { const r = new Rng(9); for (let i = 0; i < 40; i++) addHeadImpact(f, jab, 12, r, w.tun); return Object.values(f.injuries).reduce((s, e) => s + e.score, 0); };
  assert.ok(score(delicate) > score(soft) * 1.5, 'a higher cuts rating is more susceptible');
  assert.equal(addHeadImpact(b, { contact: 'none' }, 10, rng, w.tun), null);
  b.injuries = { brow: { score: 2, stage: 3 } };
  let treated = false; for (let s = 1; s < 50 && !treated; s++) { b.injuries.brow = { score: 2, stage: 3 }; cutmanTreat(b, new Rng(s), w.tun); treated = b.injuries.brow.stage === 2; }
  assert.ok(treated);
  b.injuries = { brow: { score: 5, stage: 4 } };
  b.injuries.brow.stage = 4; cutmanTreat(b, new Rng(1), w.tun);
  assert.equal(b.injuries.brow.stage, 4, 'critical cuts need the doctor');
  b.injuries = { brow: { score: 1, stage: 2 } };
  assert.equal(doctorStops(b, new Rng(1), w.tun), false);
});

test('fighters: pools come from ratings (chin/toughness, body, legs), a left/right limb mapping follows the stance', () => {
  const tough = makeWorld({ a: { chinhealth: 100, toughness: 100, bodyhealth: 100, leghealth: 100 } }).fighters[0];
  const glass = makeWorld({ a: { chinhealth: 0, toughness: 0, bodyhealth: 0, leghealth: 0 } }).fighters[0];
  for (const r of ['head', 'body', 'legL', 'legR']) assert.ok(tough.pools[r].max > glass.pools[r].max * 1.3, r);
  const o = new Fighter({ id: 'o', stance: 'orthodox', ratings: { lefthandpower: 80, righthandpower: 20 } }, tough.tun);
  const s = new Fighter({ id: 's', stance: 'southpaw', ratings: { lefthandpower: 80, righthandpower: 20 } }, tough.tun);
  assert.equal(o.limbPower('punch', 'lead'), 80); assert.equal(o.limbPower('punch', 'back'), 20);
  assert.equal(s.limbPower('punch', 'lead'), 20); assert.equal(s.limbPower('punch', 'back'), 80);
  assert.equal(o.legRegion('lead'), 'legL'); assert.equal(s.legRegion('lead'), 'legR');
  assert.ok(o.overallHealthFraction() === 1);
  o.damagePool('head', 1e9);
  assert.equal(o.pools.head.cur, 0);
  assert.ok(Math.abs(o.overallHealthFraction() - 0.5) < 1e-9);
});
