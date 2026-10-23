import test from 'node:test';
import assert from 'node:assert/strict';
import { FightSim } from '../src/sim/fight-sim.js';
import { emptyIntent } from '../src/input/intent.js';
import { Mode, GroundPosition as G } from '../src/core/taxonomy.js';
import { DEFAULT_FIGHTERS } from '../src/data/default-fighters.js';
import { spec } from '../src/testing/helpers.js';

const idle = () => emptyIntent();
const with_ = (o) => ({ ...emptyIntent(), ...o });
const JAB = { moveId: 'lead_jab_head', limb: 'punch', side: 'lead', slot: 'basic', target: 'head' };
const log = (sim, type) => sim.world.bus.log.filter((e) => e.type === type);

/** A sim with two scripted (controller-less) fighters; `place` sets centre distance on the x axis. */
function duel({ a = {}, b = {}, aMeta = {}, bMeta = {}, seed = 1, gap = 1.0, tunables, rounds = 3, roundSeconds = 300 } = {}) {
  const sim = new FightSim({ seed, rounds, roundSeconds, tunables, fighters: [spec('a', a, aMeta), spec('b', b, bMeta)], controllers: { a: false, b: false }, record: true });
  const [A, B] = sim.world.fighters;
  A.pos = { x: -gap / 2, y: 0 }; B.pos = { x: gap / 2, y: 0 };
  return sim;
}
const run = (sim, n, ia = idle, ib = idle) => { for (let k = 0; k < n && !sim.over; k++) sim.step({ a: typeof ia === 'function' ? ia(k) : ia, b: typeof ib === 'function' ? ib(k) : ib }); };

test('simultaneous jabs are a trade: both land on the same tick and both are counter-hits', () => {
  const sim = duel();
  run(sim, 8, with_({ strike: JAB }), with_({ strike: JAB }));
  const hits = log(sim, 'strike').filter((e) => e.outcome === 'hit');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].tick, hits[1].tick);
  assert.ok(hits.every((h) => h.counterHit), 'each was in its own strike when hit');
  assert.deepEqual(hits.map((h) => h.attacker).sort(), ['a', 'b']);
});

test('a strike that lands on a shooter in Phase I denies the shot and carries the counter-hit multiplier', () => {
  const sim = duel({ gap: 1.4 });
  run(sim, 1, with_({ takedown: { dir: 'fwd', size: 'major' } }), with_({ strike: JAB }));
  assert.equal(sim.world.fighters[0].mode, Mode.TAKEDOWN);
  run(sim, 12);
  const td = log(sim, 'takedown').filter((e) => e.phase === 'result');
  assert.equal(td.length, 1);
  assert.equal(td[0].result, 'denied'); assert.equal(td[0].denial, 'countered_punch');
  const hit = log(sim, 'strike').find((e) => e.outcome === 'hit');
  assert.ok(hit && hit.counterHit, 'hit on a committed shooter is a counter-hit');
  assert.equal(sim.world.fighters[0].mode, Mode.STANDUP);
});

test('parry: the strike does nothing, the attacker pays extra recovery, the defender gets a counter window and its next strike is a counter', () => {
  const sim = duel({ b: { blocking: 80 } });
  const [A, B] = sim.world.fighters;
  run(sim, 1, with_({ strike: JAB }), idle);
  run(sim, 2);
  run(sim, 1, idle, with_({ parry: true }));              // tick 4: window covers the tick-5 impact
  run(sim, 1);
  const parried = log(sim, 'strike').find((e) => e.outcome === 'parried');
  assert.ok(parried, JSON.stringify(log(sim, 'strike')));
  assert.equal(B.pools.head.cur, B.pools.head.max);
  assert.ok(B.counterWindow > 0);
  assert.ok(A.action.extraRecovery >= sim.world.tun.defense.parryAttackerExtraRecovery);
  run(sim, 1, idle, with_({ strike: JAB }));
  assert.equal(B.counterWindow, 0, 'consumed when the counter starts');
  run(sim, 12);
  const counter = log(sim, 'strike').find((e) => e.attacker === 'b' && e.outcome === 'hit');
  assert.ok(counter && counter.counter, 'the counter is flagged');
});

test('blocks mitigate but never nullify; a guard up early on the right height is strong, a late or wrong one is weak', () => {
  const CROSS = { moveId: 'back_cross_head', limb: 'punch', side: 'back', slot: 'basic', target: 'head' };
  const fraction = (guardFromTick, height) => {
    const sim = duel({ seed: 5 });
    for (let tick = 1; tick <= 16; tick++) sim.step({ a: tick === 1 ? with_({ strike: CROSS }) : idle(), b: with_({ guard: tick >= guardFromTick ? height : 'none' }) });
    const e = log(sim, 'strike').find((x) => x.attacker === 'a');
    assert.equal(e.outcome, 'blocked');
    assert.ok(e.taken > 0, 'chip damage always gets through');
    return { f: e.blocked / (e.blocked + e.taken), strong: e.strong };
  };
  const strong = fraction(1, 'high'), late = fraction(8, 'high'), wrong = fraction(1, 'low');
  assert.equal(strong.strong, true); assert.equal(late.strong, false); assert.equal(wrong.strong, false);
  assert.ok(strong.f > late.f && strong.f > wrong.f, `${strong.f} vs late ${late.f} wrong ${wrong.f}`);
  assert.ok(strong.f >= 0.7 && strong.f < 1, 'a strong high block stops at least 70 % but not everything');
});

test('catching a kick traps the kicker, lets the catcher punch (not kick), and releases on request', () => {
  let caught = null;
  for (let seed = 1; seed < 60 && !caught; seed++) {
    const sim = duel({ seed, gap: 1.3, a: { kickspeed: 50 }, bMeta: { style: 'judo' } });
    run(sim, 1, with_({ strike: { moveId: 'back_kick_body', limb: 'kick', side: 'back', slot: 'basic', target: 'body' } }), idle);
    run(sim, 7);
    run(sim, 1, idle, with_({ catch: true }));
    run(sim, 8);
    if (log(sim, 'catch').length) caught = sim;
  }
  assert.ok(caught, 'a catch happened for some seed');
  const [A, B] = caught.world.fighters;
  assert.ok(B.heldLeg && A.trapped > 0);
  const punch = with_({ strike: JAB }), kick = with_({ strike: { moveId: 'back_legkick_leg', limb: 'kick', side: 'back', slot: 'basic', target: 'leg' } });
  run(caught, 1, idle, kick); run(caught, 1);
  assert.notEqual(B.action?.move.limb, 'kick', 'holding a leg: no kicks');
  run(caught, 1, idle, punch);
  assert.equal(B.action?.move.id, 'lead_jab_head');
  run(caught, 30);
  run(caught, 1, idle, with_({ grapple: { kind: 'release' } }));
  assert.equal(B.heldLeg, null); assert.equal(A.trapped, 0);
  assert.ok(log(caught, 'catch_release').length === 1);
});

test('knockdown: fighter goes down, clock pauses, recovery stands them up; a follow-up starts a ground bout; unanswered ground strikes end it', () => {
  const sim = duel({ gap: 0.9 });
  const [A, B] = sim.world.fighters;
  run(sim, 2);
  sim.world.healthEvent(B, A, 'knockdown', 'head');
  run(sim, 1);
  assert.equal(B.mode, Mode.DOWN); assert.equal(B.floorPosture, 'back');
  const elapsed = sim.match.elapsed;
  assert.equal(sim.match.state, 'stopped');
  run(sim, 5);
  assert.equal(sim.match.elapsed, elapsed, 'clock frozen while a fighter is down');
  run(sim, 1, with_({ grapple: { kind: 'followUp' } }));
  assert.equal(A.mode, Mode.GROUND); assert.equal(A.bout.position, G.DOWNED); assert.equal(A.bout.top, A);
  run(sim, 3);
  assert.ok(sim.match.elapsed > elapsed, 'the action is live again once the fight is back on the mat');
  // ground and pound on a helpless fighter
  let n = 0;
  while (!sim.over && n++ < 900) sim.step({ a: with_({ grapple: { kind: 'strike', strike: 'hammer', target: 'head' } }), b: idle() });
  assert.ok(sim.over);
  assert.equal(sim.result.stoppage, 'tko'); assert.equal(sim.result.method, 'ground_and_pound'); assert.equal(sim.result.winner, 'a');

  // without a follow-up the downed fighter just gets up and the clock resumes
  const s2 = duel({ gap: 2.5 });
  run(s2, 2);
  s2.world.healthEvent(s2.world.fighters[1], s2.world.fighters[0], 'knockdown', 'head');
  run(s2, 5);
  assert.equal(s2.world.fighters[1].mode, Mode.DOWN);
  run(s2, 200);
  assert.equal(s2.world.fighters[1].mode, Mode.STANDUP);
  assert.equal(s2.match.state, 'fight');
  assert.ok(log(s2, 'get_up').some((e) => e.success && e.actor === 'b'));
});

test('a destroyed leg buckles the fighter; two failed get-ups end the fight (leg-injury TKO)', () => {
  const sim = duel({ gap: 2.5 });
  const B = sim.world.fighters[1];
  run(sim, 3);
  B.pools.legL.cur = 0;
  run(sim, 2);
  assert.equal(B.mode, Mode.DOWN);
  assert.ok(log(sim, 'knockdown').some((e) => e.fighter === 'b'));
  run(sim, 600);
  assert.ok(sim.over, 'stopped');
  assert.deepEqual([sim.result.stoppage, sim.result.method, sim.result.winner], ['tko', 'leg_injury', 'a']);
});

test('knockout ends the fight immediately with the finishing blow described', () => {
  const sure = { healthEvents: { profiles: { 'head.knockout': { pMin: 1, pMax: 1, init: 1, dmgMod: 1, staminaMod: 1 } } } };
  const sim = duel({ gap: 1.0, a: { righthandpower: 100 }, tunables: sure });
  let n = 0;
  while (!sim.over && n++ < 400) sim.step({ a: with_({ strike: { moveId: 'back_overhand_head', limb: 'punch', side: 'back', slot: 'tech', target: 'head' } }), b: idle() });
  assert.ok(sim.over);
  assert.equal(sim.result.result, 'ko');
  assert.match(sim.result.method, /head$/);
  assert.equal(sim.world.fighters[0].mode, Mode.FINISHED);
  assert.equal(sim.step(), false, 'no stepping after the end');
});

test('abilities: a perfect iron fist makes the next strike hit harder; the effect is one-shot and cooldown applies', () => {
  const ratio = (seed) => {
    const strike = with_({ strike: { moveId: 'back_cross_head', limb: 'punch', side: 'back', slot: 'basic', target: 'head' } });
    const base = duel({ seed }); run(base, 10, strike); const b = log(base, 'strike').find((e) => e.outcome === 'hit');
    const buffed = duel({ seed, aMeta: { abilities: ['iron_fist'] } });
    buffed.step({ a: with_({ ability: { slot: 0, result: 'perfect' } }), b: idle() });
    run(buffed, 10, strike);
    const h = log(buffed, 'strike').find((e) => e.outcome === 'hit');
    return h && b ? h.taken / b.taken : null;
  };
  const rs = [];
  for (let s = 1; s <= 30; s++) { const r = ratio(s); if (r) rs.push(r); }
  const mean = rs.reduce((x, y) => x + y, 0) / rs.length;
  assert.ok(rs.length >= 20 && mean > 1.35, `mean ratio ${mean}`);
  const sim = duel({ aMeta: { abilities: ['iron_fist'] } });
  sim.step({ a: with_({ ability: { slot: 0, result: 'perfect' } }), b: idle() });
  sim.step({ a: with_({ ability: { slot: 0, result: 'perfect' } }), b: idle() });
  assert.equal(log(sim, 'ability').length, 1, 'cooldown blocks the second press');
  assert.ok(sim.world.fighters[0].mods.strike);
  run(sim, 10, with_({ strike: JAB }));
  assert.equal(sim.world.fighters[0].mods.strike, null, 'spent on the next strike');
});

test('stance switch flips the stance, costs stamina, locks the fighter briefly and is counted', () => {
  const sim = duel();
  const A = sim.world.fighters[0];
  const s0 = A.stamina;
  run(sim, 1, with_({ switchStance: true }));
  assert.equal(A.stance, 'southpaw'); assert.ok(A.stamina < s0 + 0.1);
  assert.ok(A.stanceSwitchTicks > 0);
  run(sim, 1, with_({ strike: JAB }));
  assert.equal(A.action, null, 'cannot strike mid-switch');
  run(sim, 20);
  assert.equal(sim.world.stats.get('a', 'stance.switches'), 1);
});

test('invariants hold through whole fights: no negative stamina or pools, consistent bouts and modes, fighters stay in the cage', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const sim = new FightSim({ seed, rounds: 2, roundSeconds: 150, fighters: [DEFAULT_FIGHTERS[seed % 8], DEFAULT_FIGHTERS[(seed * 3 + 2) % 8]].map((f, i) => ({ ...f, id: `${f.id}_${i}` })) });
    const [A, B] = sim.world.fighters;
    let k = 0;
    while (!sim.over && k++ < 40000) {
      sim.step();
      if (sim.world.tick % 7 !== 0) continue;
      for (const f of sim.world.fighters) {
        assert.ok(f.stamina >= 0 && f.stamina <= f.maxStamina, `stamina ${f.stamina}`);
        for (const r of ['head', 'body', 'legL', 'legR']) assert.ok(f.pools[r].cur >= 0 && f.pools[r].cur <= f.pools[r].max, `${r} ${f.pools[r].cur}`);
        assert.ok(Number.isFinite(f.pos.x) && Number.isFinite(f.pos.y) && Number.isFinite(f.facing));
        assert.ok(sim.world.cage.inside(f.pos, f.radius * 0.4), `${f.id} outside the cage at ${f.pos.x.toFixed(2)},${f.pos.y.toFixed(2)} mode ${f.mode}`);
        if (f.bout) assert.ok(f.bout.fighters.includes(f));
      }
      if ([Mode.CLINCH, Mode.GROUND, Mode.SUBMISSION].includes(A.mode)) { assert.equal(B.mode, A.mode); assert.equal(A.bout, B.bout, 'one bout per pair'); }
      if (A.mode === Mode.TAKEDOWN || B.mode === Mode.TAKEDOWN) assert.ok(A.bout === B.bout && A.bout.kind === 'takedown');
      if (A.mode === Mode.STANDUP && B.mode === Mode.STANDUP) assert.ok(!A.bout || A.bout.kind === 'takedown');
    }
    assert.ok(sim.over, `fight ${seed} finished`);
  }
});

test('state hash is checkpointed every 30 ticks and differs as the fight evolves', () => {
  const sim = new FightSim({ seed: 3, rounds: 1, roundSeconds: 30, fighters: [DEFAULT_FIGHTERS[0], DEFAULT_FIGHTERS[1]] });
  sim.run();
  assert.equal(sim.hashes.length, Math.floor(sim.world.tick / 30));
  assert.ok(new Set(sim.hashes.map((h) => h.hash)).size > sim.hashes.length * 0.9);
});
