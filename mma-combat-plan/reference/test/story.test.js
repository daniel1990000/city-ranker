import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryEngine, ROUND_STORIES } from '../src/sim/story.js';
import { makeWorld } from '../src/testing/helpers.js';
import { FightSim } from '../src/sim/fight-sim.js';
import { DEFAULT_FIGHTERS } from '../src/data/default-fighters.js';

function craft(w, round) {
  const st = w.stats;
  st.inc('a', 'strikes.thrown', 20, round); st.inc('a', 'strikes.landed', 13, round);              // 65 % accuracy
  st.inc('a', 'strikes.landed.leg', 6, round);                                                       // leg kicks
  st.inc('b', 'takedowns.landed', 3, round); st.inc('b', 'takedowns.attempted', 4, round);          // takedowns
  st.inc('a', 'knockdowns.landed', 1, round);                                                        // knockdown (heaviest weight)
}

test('every story has a unique id, a weight and a renderer', () => {
  const ids = ROUND_STORIES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 18);
  for (const s of ROUND_STORIES) { assert.ok(s.weight > 0 && typeof s.test === 'function' && typeof s.text === 'function', s.id); }
});

test('top-k is deterministic for a crafted stats table; the knockdown outranks the rest', () => {
  const run = () => { const w = makeWorld(); craft(w, 1); return new StoryEngine(w).roundStories(1); };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.equal(a[0].id, 'round_knockdown'); assert.equal(a[0].fighter, 'a');
  assert.ok(a[0].score >= a[1].score);
  assert.match(a[0].text, /knockdown/);
  const all = new StoryEngine((() => { const w = makeWorld(); craft(w, 1); return w; })()).candidates(1).map((c) => c.id);
  for (const id of ['round_high_accuracy', 'round_leg_kicks', 'round_takedowns', 'round_knockdown']) assert.ok(all.includes(id), id);
});

test('cooldown: a story cannot repeat within two rounds, then it can', () => {
  const w = makeWorld();
  const eng = new StoryEngine(w, { cooldownRounds: 2, perRound: 3 });
  craft(w, 1); craft(w, 2); craft(w, 3);
  const r1 = eng.roundStories(1).map((s) => s.id);
  const r2 = eng.roundStories(2).map((s) => s.id);
  const r3 = eng.roundStories(3).map((s) => s.id);
  assert.ok(r1.includes('round_knockdown'));
  assert.ok(!r2.includes('round_knockdown'), 'round 2: still cooling down');
  for (const id of r1) assert.ok(!r2.includes(id));
  assert.ok(r3.includes('round_knockdown') || r3.some((id) => r1.includes(id)), 'round 3: eligible again');
  assert.equal(eng.told.length, r1.length + r2.length + r3.length);
});

test('quiet round yields the low-action story once (told for both)', () => {
  const w = makeWorld();
  w.stats.inc('a', 'strikes.thrown', 4, 1); w.stats.inc('b', 'strikes.thrown', 3, 1);
  const s = new StoryEngine(w).roundStories(1);
  assert.deepEqual(s.map((x) => x.id), ['round_low_action']);
  assert.equal(s[0].fighter, null);
});

test('pre-decision and post-fight stories', () => {
  const w = makeWorld();
  w.stats.inc('a', 'strikes.landed', 40); w.stats.inc('b', 'strikes.landed', 22); w.stats.inc('a', 'takedowns.landed', 1);
  const eng = new StoryEngine(w);
  const close = eng.preDecision([{ verdict: 'a' }, { verdict: 'b' }, { verdict: 'a' }]);
  assert.equal(close.id, 'pre_decision_close'); assert.equal(close.edge, 'strikes_landed'); assert.equal(close.leader, 'a');
  assert.equal(eng.preDecision([{ verdict: 'a' }, { verdict: 'a' }, { verdict: 'a' }]).id, 'pre_decision_unanimous');
  const ko = (how) => eng.postFight({ stoppage: 'ko', method: how, winner: 'a', result: 'ko' }).id;
  assert.deepEqual([ko('kick_head'), ko('knee_body'), ko('elbow_head'), ko('punch_head')], ['post_ko_kick', 'post_ko_knee', 'post_ko_elbow', 'post_ko_punch']);
  assert.equal(eng.postFight({ stoppage: 'submission', method: 'armbar', winner: 'a', result: 'submission' }).id, 'post_submission');
  assert.equal(eng.postFight({ stoppage: 'tko', method: 'ground_and_pound', winner: 'a', result: 'tko' }).id, 'post_tko_ground_and_pound');
  assert.equal(eng.postFight({ stoppage: 'tko', method: 'leg_injury', winner: 'a', result: 'tko' }).id, 'post_tko_leg_kicks');
  assert.equal(eng.postFight({ stoppage: 'doctor', method: 'cut', winner: 'a', result: 'tko' }).id, 'post_doctor_stoppage');
  assert.equal(eng.postFight({ stoppage: 'decision', method: 'decision', winner: 'a', result: 'unanimous_decision' }).id, 'post_unanimous_decision');
  assert.equal(eng.postFight({ stoppage: 'decision', method: 'decision', winner: null, result: 'draw' }).id, 'post_draw');
});

test('stories from a real fight: every round produces at most two, ids come from the catalogue', () => {
  const sim = new FightSim({ seed: 21, rounds: 3, fighters: [DEFAULT_FIGHTERS[2], DEFAULT_FIGHTERS[4]] });
  sim.run();
  const eng = new StoryEngine(sim.world);
  const known = new Set(ROUND_STORIES.map((s) => s.id));
  for (let r = 1; r <= sim.match.round; r++) {
    const s = eng.roundStories(r);
    assert.ok(s.length <= 2);
    for (const x of s) assert.ok(known.has(x.id) && x.score > 0 && typeof x.text === 'string');
  }
});
