import test from 'node:test';
import assert from 'node:assert/strict';
import { aggressionLevel, aggressionBounds, factorValues, gapTicks } from '../src/ai/aggression.js';
import { TENDENCY_PROFILES, tendencyProfile, goalScoreTable, GOALS } from '../src/ai/tendencies.js';
import { difficultyProfile, reactionDelay, defendProbability, DIFFICULTIES } from '../src/ai/difficulty.js';
import { Brain, ScriptedBrain } from '../src/ai/brain.js';
import { checkIntent } from '../src/ai/legality.js';
import { buildSituation } from '../src/core/situation.js';
import { TENDENCIES, AGGRESSION_FACTORS } from '../src/core/taxonomy.js';
import { mergeTunables } from '../src/core/tunables.js';
import { Rng } from '../src/core/rng.js';
import { FightSim } from '../src/sim/fight-sim.js';
import { DEFAULT_FIGHTERS } from '../src/data/default-fighters.js';
import { makeWorld, spec, faceOff } from '../src/testing/helpers.js';
import { emptyIntent } from '../src/input/intent.js';

const tun = mergeTunables();
const world = makeWorld();
const baseSit = () => buildSituation(world, world.fighters[0], { elapsedTicks: 9000, roundTicks: 18000, round: 2, rounds: 3, scoreDifferential: 0 });

test('all 12 tendency archetypes exist with complete, positive goal tables and sane aggression bounds', () => {
  assert.deepEqual(Object.keys(TENDENCY_PROFILES).sort(), [...TENDENCIES].sort());
  for (const [name, p] of Object.entries(TENDENCY_PROFILES)) {
    for (const g of GOALS) assert.ok(p.goals[g] > 0, `${name}.${g}`);
    const b = aggressionBounds(name, tun);
    assert.ok(b.min < b.a0 && b.a0 < b.max && b.min >= 0 && b.max <= 1, name);
  }
  assert.equal(tendencyProfile('nonsense'), TENDENCY_PROFILES.striking_purist);
});

test('aggression: every documented factor moves it in the documented direction; result stays inside [Amin, Amax]', () => {
  const sit = baseSit();
  const A0 = aggressionLevel(sit, 'striking_purist', tun);
  const set = {   // factor → [mutator for "more of the factor", expected direction]
    health_head: (s, v) => { s.health.head = v; }, stamina: (s, v) => { s.stamina = v; },
    opp_health_head: (s, v) => { s.opponentHealth.head = v; }, opp_stamina: (s, v) => { s.opponentStamina = v; },
    delta_health: (s, v) => { s.deltaHealth = v; }, in_hit_reaction: (s, v) => { s.inHitReaction = v; }, idle: (s, v) => { s.idle = v; },
    opp_strike_activity: (s, v) => { s.opponentStrikeActivity = v; }, score_differential: (s, v) => { s.scoreDifferential = v === 1 ? 0.9 : -0.9; }, round_time: (s, v) => { s.roundTime = v; },
  };
  const w = tun.ai.aggression.weights;
  for (const [name, mutate] of Object.entries(set)) {
    const lo = structuredClone(sit), hi = structuredClone(sit);
    mutate(lo, 0); mutate(hi, 1);
    const a = aggressionLevel(lo, 'striking_purist', tun), b = aggressionLevel(hi, 'striking_purist', tun);
    const dir = Math.sign(w[name]);
    assert.ok(dir !== 0, `${name} has a weight`);
    assert.ok((b - a) * dir > 0, `${name}: ${a} → ${b} should go ${dir > 0 ? 'up' : 'down'}`);
  }
  // clamped for every tendency under extreme inputs
  for (const t of TENDENCIES) {
    const extreme = structuredClone(sit);
    extreme.opponentHealth.head = 0; extreme.stamina = 1; extreme.health.head = 1; extreme.scoreDifferential = -1; extreme.idle = 1; extreme.roundTime = 1; extreme.opponentStamina = 0;
    const calm = structuredClone(sit);
    calm.opponentHealth.head = 1; calm.stamina = 0; calm.health.head = 0; calm.scoreDifferential = 1; calm.inHitReaction = 1; calm.deltaHealth = 1; calm.opponentStamina = 1;
    const { min, max } = aggressionBounds(t, tun);
    const hi = aggressionLevel(extreme, t, tun), lo = aggressionLevel(calm, t, tun);
    assert.ok(hi <= max + 1e-12 && lo >= min - 1e-12 && hi > lo, `${t}: ${lo}..${hi} in [${min},${max}]`);
  }
  assert.equal(A0, aggressionLevel(sit, 'striking_purist', tun), 'pure function');
  assert.equal(Object.keys(factorValues(sit)).length, 21);
  assert.deepEqual(Object.keys(factorValues(sit)).sort(), [...AGGRESSION_FACTORS].sort());
});

test('tendency overrides: attrition doubles opp_stamina, adaptive finisher boosts opp_head_health', () => {
  const sit = baseSit();
  const tired = structuredClone(sit); tired.opponentStamina = 0.1;
  const fresh = structuredClone(sit); fresh.opponentStamina = 0.9;
  const spread = (t) => aggressionLevel(tired, t, tun) - aggressionLevel(fresh, t, tun);
  assert.ok(spread('attrition_specialist') > spread('striking_purist') * 1.5, 'attrition reacts more to a tired opponent');
  const hurt = structuredClone(sit); hurt.opponentHealth.head = 0.1;
  const well = structuredClone(sit); well.opponentHealth.head = 0.9;
  const hspread = (t) => aggressionLevel(hurt, t, tun) - aggressionLevel(well, t, tun);
  assert.ok(hspread('adaptive_finisher') > hspread('striking_purist') * 1.5);
  assert.ok(aggressionLevel(sit, 'brawler', tun) > aggressionLevel(sit, 'chess_master', tun));
  assert.ok(gapTicks(1, tun) < gapTicks(0, tun) && gapTicks(0.5, tun) === (tun.ai.gapTicks.slow + tun.ai.gapTicks.fast) / 2);
});

test('goal draws converge to the tendency base weights (5 000 draws, ±3 %) under neutral conditions', () => {
  for (const t of ['striking_purist', 'bjj_fighter', 'thai_clincher']) {
    const w = makeWorld({ seed: 4 });
    const brain = new Brain(w, w.fighters[0], {});
    const base = tendencyProfile(t).goals;
    const scores = goalScoreTable({ base, A: 0.5 });
    const total = GOALS.reduce((s, g) => s + base[g], 0);
    const counts = Object.fromEntries(GOALS.map((g) => [g, 0]));
    const N = 5000;
    for (let i = 0; i < N; i++) counts[brain.drawGoal(scores)]++;
    for (const g of GOALS) assert.ok(Math.abs(counts[g] / N - base[g] / total) < 0.03, `${t}.${g}: ${counts[g] / N} vs ${base[g] / total}`);
  }
  // aggression gain: offensive goals gain with A, footwork gains when A is low
  const hi = goalScoreTable({ base: tendencyProfile('striking_purist').goals, A: 0.9 }), lo = goalScoreTable({ base: tendencyProfile('striking_purist').goals, A: 0.1 });
  assert.ok(hi.strike > lo.strike && hi.loco < lo.loco);
});

test('difficulty: reaction delays order beginner > pro > champion; read probability orders the other way; hands-down hurts', () => {
  const means = {};
  for (const d of DIFFICULTIES) {
    const rng = new Rng(8), p = difficultyProfile(d, tun);
    let s = 0; const N = 4000;
    for (let i = 0; i < N; i++) { const r = reactionDelay(rng, p); assert.ok(r >= 1); s += r; }
    means[d] = s / N;
    assert.ok(Math.abs(means[d] - p.reactionTicks) < 0.6, `${d}: ${means[d]}`);
  }
  assert.ok(means.beginner > means.pro && means.pro > means.champion);
  const f = makeWorld().fighters[0];
  const pd = DIFFICULTIES.map((d) => defendProbability(difficultyProfile(d, tun), f));
  assert.ok(pd[0] < pd[1] && pd[1] < pd[2]);
  f.handsDown = true;
  assert.ok(defendProbability(difficultyProfile('pro', tun), f) < pd[1]);
  f.handsDown = false; f.ratings.blocking = 100;
  assert.ok(defendProbability(difficultyProfile('pro', tun), f) > pd[1]);
});

const oneRound = (seed, aDiff, bDiff) => new FightSim({
  seed, rounds: 1, roundSeconds: 120, fighters: [{ ...spec('a', { blocking: 55 }, { difficulty: aDiff, tendency: 'chess_master' }) }, { ...spec('b', { blocking: 55 }, { difficulty: bDiff, tendency: 'striking_purist' }) }],
});
function defenceRate(diff, fights = 24) {
  let defended = 0, faced = 0;
  for (let s = 1; s <= fights; s++) {
    const sim = oneRound(900 + s, diff, 'pro');
    sim.run();
    const st = sim.world.stats;
    defended += ['blocked', 'parried', 'slipped', 'caught', 'evaded'].reduce((n, k) => n + st.get('a', `defense.${k}`), 0);
    faced += st.get('b', 'strikes.thrown');
  }
  return defended / Math.max(1, faced);
}

test('champions defend more often than beginners over the same fights (end to end)', () => {
  const beginner = defenceRate('beginner'), champion = defenceRate('champion');
  assert.ok(champion > beginner + 0.03, `beginner ${beginner.toFixed(3)} champion ${champion.toFixed(3)}`);
});

test('the AI never emits an illegal intent (all tendencies, three difficulties, full fights, debug checks every tick)', () => {
  let ticks = 0;
  TENDENCIES.forEach((t, k) => {
    const a = { ...spec(`a${k}`, { takedown: 60, clinchcontrol: 60, groundcontrol: 60, chokesubmission: 60, jointsubmission: 60 }, { tendency: t, difficulty: DIFFICULTIES[k % 3] }) };
    const b = { ...DEFAULT_FIGHTERS[k % DEFAULT_FIGHTERS.length], id: `b${k}` };
    const sim = new FightSim({ seed: 300 + k, rounds: 2, roundSeconds: 150, fighters: [a, b], debug: true });
    sim.run();
    ticks += sim.world.tick;
    assert.deepEqual(sim.violations.slice(0, 3), [], `${t}`);
  });
  assert.ok(ticks > 5000);
});

test('same seed ⇒ identical decisions (event log and state hash); a different seed differs', () => {
  const run = (seed) => {
    const sim = new FightSim({ seed, rounds: 1, roundSeconds: 90, fighters: [DEFAULT_FIGHTERS[0], DEFAULT_FIGHTERS[2]], record: true });
    sim.run();
    return [sim.world.stateHash(), JSON.stringify(sim.world.bus.log.map((e) => [e.type, e.tick, e.outcome ?? e.event ?? e.result ?? null]))];
  };
  assert.deepEqual(run(5), run(5));
  assert.notDeepEqual(run(5), run(6));
});

test('scripted brain: runs its steps in order, exactly once; `when` and `at` triggers work', () => {
  const w = makeWorld();
  faceOff(w, 1.2);
  const [a] = w.fighters;
  const log = [];
  const brain = new ScriptedBrain(w, a, [
    { at: 5, ticks: 3, intent: { guard: 'high' } },
    { ticks: 2, intent: { move: { x: 1, y: 0 } } },
    { when: (s) => s.range < 5, ticks: 1, intent: { parry: true } },
  ]);
  for (let t = 0; t < 40; t++) { w.tick = t; const i = brain.think(); log.push([t, i.guard, i.move.x, i.parry]); }
  const active = log.filter(([, g, mx, p]) => g !== 'none' || mx !== 0 || p);
  assert.deepEqual(active.map(([t]) => t), [5, 6, 7, 8, 9, 10], 'guard 5-7, move 8-9 → started right after, parry at 10');
  assert.deepEqual(log.filter(([, g]) => g === 'high').map(([t]) => t), [5, 6, 7]);
  assert.deepEqual(log.filter(([, , mx]) => mx === 1).map(([t]) => t), [8, 9]);
  assert.deepEqual(log.filter(([, , , p]) => p).map(([t]) => t), [10]);
  assert.ok(brain.finished && brain.ran === 3, 'each step ran once');
  for (let t = 40; t < 60; t++) { w.tick = t; assert.deepEqual(brain.think(), emptyIntent(), 'nothing after the script'); }
});

test('forced goals (ability proc) override the next draw; brains with ability bars press abilities', () => {
  const w = makeWorld({ seed: 2 });
  faceOff(w, 1.0);
  const brain = new Brain(w, w.fighters[0], {});
  brain.forcedGoal = 'clinch';
  w.tick = 1;
  brain.think(); w.tick = 2; brain.think();
  assert.equal(brain.lastGoal, 'clinch');
  assert.equal(brain.forcedGoal, null);

  const sim = new FightSim({
    seed: 11, rounds: 2, roundSeconds: 120,
    fighters: [{ ...DEFAULT_FIGHTERS[0], abilities: ['iron_fist', 'second_wind', 'level_change'] }, { ...DEFAULT_FIGHTERS[1], abilities: ['flurry'] }], record: true,
  });
  sim.run();
  const used = sim.world.bus.log.filter((e) => e.type === 'ability');
  assert.ok(used.length >= 1, 'abilities were used');
  for (const e of used) assert.ok(['fail', 'success', 'perfect'].includes(e.result));
});
