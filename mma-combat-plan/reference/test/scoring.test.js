import test from 'node:test';
import assert from 'node:assert/strict';
import { rawComponents, scoreRound, scoreFight, classifyDecision, makeJudges, neutralJudge, scoreDifferential, JUDGE_BIASES } from '../src/combat/scoring.js';
import { JUDGE_COMPONENTS, FightResultType as R } from '../src/core/taxonomy.js';
import { Rng } from '../src/core/rng.js';
import { makeWorld } from '../src/testing/helpers.js';

// stat keys that feed each component (the test bumps them one at a time)
const FEED = {
  effective_striking: ['strikes.sig.landed.head'], damage: ['damage.dealt'], health_events: ['events.inflicted.stun'],
  blocks_and_parries: ['defense.blocked'], clinch_dominance: ['time.clinch.dom'], ground_dominance: ['time.ground.dominant'],
  takedowns_performed: ['takedowns.landed'], takedowns_denied: ['takedowns.denied'], passes_performed: ['passes.landed'],
  passes_denied: ['passes.denied'], submissions: ['subs.depth'], submissions_escaped: ['subs.escaped'],
};
const level = (w) => {            // identical non-zero baseline for both fighters
  for (const f of w.fighters) {
    w.stats.inc(f.id, 'strikes.thrown', 20); w.stats.inc(f.id, 'strikes.landed', 8);
    for (const keys of Object.values(FEED)) for (const k of keys) w.stats.inc(f.id, k, k.startsWith('damage') ? 20 : k.startsWith('time') ? 600 : 3);
  }
};

test('all 12 components are scored and each has a feeding statistic', () => {
  assert.deepEqual(Object.keys(FEED).sort(), [...JUDGE_COMPONENTS].sort());
  const w = makeWorld();
  const raw = rawComponents(w.stats, w.fighters[0], w.fighters[1], 1, w.tun);
  assert.deepEqual(Object.keys(raw).sort(), [...JUDGE_COMPONENTS].sort());
  for (const v of Object.values(raw)) assert.equal(v, 0);
});

test('an inactive round is a 10-10 draw', () => {
  const w = makeWorld();
  const r = scoreRound(w.stats, w.fighters[0], w.fighters[1], 1, w.tun);
  assert.deepEqual([r.a, r.b, r.winner], [10, 10, null]);
  assert.equal(r.delta, 0);
});

test('symmetry: swapping the fighters swaps the scores', () => {
  const w = makeWorld();
  const [a, b] = w.fighters;
  level(w);
  w.stats.inc(a.id, 'strikes.sig.landed.head', 7); w.stats.inc(a.id, 'damage.dealt', 30); w.stats.inc(b.id, 'takedowns.landed', 2);
  const ab = scoreRound(w.stats, a, b, 1, w.tun), ba = scoreRound(w.stats, b, a, 1, w.tun);
  assert.ok(Math.abs(ab.Sa - ba.Sb) < 1e-12 && Math.abs(ab.Sb - ba.Sa) < 1e-12);
  assert.ok(Math.abs(ab.delta + ba.delta) < 1e-12);
  assert.equal(ab.a, ba.b); assert.equal(ab.b, ba.a);
  assert.ok(Math.abs(ab.Sa + ab.Sb - 1) < 1e-9, 'scores sum to 1');
});

test('monotone: more of any component never lowers the fighter\'s score, and every component matters', () => {
  for (const [comp, keys] of Object.entries(FEED)) {
    const w = makeWorld();
    const [a, b] = w.fighters;
    level(w);
    const before = scoreRound(w.stats, a, b, 1, w.tun).Sa;
    for (const k of keys) w.stats.inc(a.id, k, k.startsWith('damage') ? 20 : k.startsWith('time') ? 600 : 3);
    const after = scoreRound(w.stats, a, b, 1, w.tun).Sa;
    assert.ok(after > before, `${comp}: ${before} -> ${after}`);
  }
});

test('10-point must: 10-9 for a clear round, 10-8 for a dominant one, 10-7 only with two criteria and a huge margin', () => {
  const w = makeWorld();
  const [a, b] = w.fighters;
  w.stats.inc(a.id, 'strikes.thrown', 30); w.stats.inc(a.id, 'strikes.landed', 15); w.stats.inc(a.id, 'strikes.sig.landed.head', 8); w.stats.inc(a.id, 'damage.dealt', 40);
  w.stats.inc(b.id, 'strikes.thrown', 28); w.stats.inc(b.id, 'strikes.landed', 12); w.stats.inc(b.id, 'strikes.sig.landed.head', 5); w.stats.inc(b.id, 'damage.dealt', 25);
  const close = scoreRound(w.stats, a, b, 1, w.tun);
  assert.deepEqual([close.a, close.b], [10, 9]);

  // round 2: A wins every component by a mile
  for (const [comp, keys] of Object.entries(FEED)) for (const k of keys) w.stats.inc(a.id, k, k.startsWith('time') ? 3000 : 20, 2);
  w.stats.inc(b.id, 'strikes.thrown', 20, 2); w.stats.inc(a.id, 'strikes.thrown', 20, 2); w.stats.inc(a.id, 'strikes.landed', 15, 2);
  const dom = scoreRound(w.stats, a, b, 2, w.tun);
  assert.ok(dom.delta >= w.tun.scoring.ten8Margin);
  assert.deepEqual([dom.a, dom.b], [10, 8]);
  assert.deepEqual(dom.criteria, ['margin']);

  // round 3: dominant + knockdown with two health events on the loser + 2 min of ground dominance with GnP
  for (const [comp, keys] of Object.entries(FEED)) for (const k of keys) w.stats.inc(a.id, k, k.startsWith('time') ? 9000 : 20, 3);
  w.stats.inc(a.id, 'strikes.landed.ground', 12, 3); w.stats.inc(b.id, 'events.knockdown', 1, 3); w.stats.inc(b.id, 'events.stun', 1, 3);
  w.stats.inc(a.id, 'strikes.thrown', 20, 3); w.stats.inc(b.id, 'strikes.thrown', 20, 3);
  const crush = scoreRound(w.stats, a, b, 3, w.tun);
  assert.ok(crush.delta >= w.tun.scoring.ten7Margin, `delta ${crush.delta}`);
  assert.deepEqual(crush.criteria.sort(), ['ground_dominance', 'knockdown', 'margin']);
  assert.deepEqual([crush.a, crush.b], [10, 7]);
  // mirror image goes to B
  assert.deepEqual([scoreRound(w.stats, b, a, 3, w.tun).a, scoreRound(w.stats, b, a, 3, w.tun).b], [7, 10]);
});

test('classification of three crafted cards: unanimous / majority / split / draw / majority draw', () => {
  const c = (v) => classifyDecision(v);
  assert.deepEqual(c(['a', 'a', 'a']), { result: R.UNANIMOUS, winner: 'a' });
  assert.deepEqual(c(['b', 'b', 'b']), { result: R.UNANIMOUS, winner: 'b' });
  assert.deepEqual(c(['a', 'a', 'draw']), { result: R.MAJORITY, winner: 'a' });
  assert.deepEqual(c(['a', 'b', 'b']), { result: R.SPLIT, winner: 'b' });
  assert.deepEqual(c(['a', 'a', 'b']), { result: R.SPLIT, winner: 'a' });
  assert.deepEqual(c(['draw', 'draw', 'draw']), { result: R.DRAW, winner: null });
  assert.deepEqual(c(['a', 'b', 'draw']), { result: R.DRAW, winner: null });
  assert.deepEqual(c(['draw', 'draw', 'b']), { result: R.MAJORITY_DRAW, winner: null });
});

test('judges: weights sum to one, biases differ, jitter is bounded, and judges can disagree on a close fight', () => {
  const w = makeWorld();
  const judges = makeJudges(new Rng(3), w.tun);
  assert.equal(judges.length, 3);
  assert.deepEqual(judges.map((j) => j.bias).sort(), [...JUDGE_BIASES].sort());
  for (const j of judges) {
    assert.ok(Math.abs(Object.values(j.weights).reduce((s, x) => s + x, 0) - 1) < 1e-9);
    for (const c of JUDGE_COMPONENTS) assert.ok(j.weights[c] > 0.2 * w.tun.scoring.weights[c] && j.weights[c] < 3 * w.tun.scoring.weights[c]);
  }
  // A: striker with damage, B: wrestler with takedowns + ground time — a damage judge and a grappling judge should differ in margin
  const [a, b] = w.fighters;
  w.stats.inc(a.id, 'strikes.sig.landed.head', 12); w.stats.inc(a.id, 'strikes.thrown', 30); w.stats.inc(a.id, 'strikes.landed', 14); w.stats.inc(a.id, 'damage.dealt', 45); w.stats.inc(a.id, 'events.inflicted.stun', 1);
  w.stats.inc(b.id, 'takedowns.landed', 3); w.stats.inc(b.id, 'time.ground.dominant', 5400); w.stats.inc(b.id, 'passes.landed', 2); w.stats.inc(b.id, 'strikes.thrown', 12); w.stats.inc(b.id, 'strikes.landed', 6); w.stats.inc(b.id, 'strikes.sig.landed.head', 3); w.stats.inc(b.id, 'damage.dealt', 10);
  const dmg = { ...neutralJudge(w.tun), bias: 'damage' }, grp = { ...neutralJudge(w.tun), bias: 'grappling' };
  const mk = (bias) => { const j = makeJudges(new Rng(1), w.tun).find((x) => x.bias === bias); return j; };
  const dA = scoreRound(w.stats, a, b, 1, w.tun, mk('damage')).delta, gA = scoreRound(w.stats, a, b, 1, w.tun, mk('grappling')).delta;
  assert.ok(dA > gA, `damage judge ${dA} vs grappling judge ${gA}`);
  void dmg; void grp;
});

test('scoreFight: a fighter who wins every round on all cards wins a unanimous decision; totals and verdicts are consistent', () => {
  const w = makeWorld();
  const [a, b] = w.fighters;
  for (let r = 1; r <= 3; r++) {
    w.stats.inc(a.id, 'strikes.thrown', 25, r); w.stats.inc(a.id, 'strikes.landed', 15, r); w.stats.inc(a.id, 'strikes.sig.landed.head', 9, r); w.stats.inc(a.id, 'damage.dealt', 35, r);
    w.stats.inc(b.id, 'strikes.thrown', 25, r); w.stats.inc(b.id, 'strikes.landed', 8, r); w.stats.inc(b.id, 'strikes.sig.landed.head', 3, r); w.stats.inc(b.id, 'damage.dealt', 12, r);
  }
  const res = scoreFight(w.stats, a, b, [1, 2, 3], w.tun, makeJudges(new Rng(9), w.tun));
  assert.equal(res.result, R.UNANIMOUS); assert.equal(res.winner, a.id);
  for (const card of res.cards) { assert.equal(card.rounds.length, 3); assert.ok(card.a > card.b); assert.equal(card.a, card.rounds.reduce((s, x) => s + x.a, 0)); assert.equal(card.verdict, 'a'); }
  assert.ok(scoreDifferential(w.stats, a, b, [1, 2, 3], w.tun) > 0.2);
  assert.ok(scoreDifferential(w.stats, b, a, [1, 2, 3], w.tun) < -0.2);
  assert.equal(scoreDifferential(w.stats, a, b, [], w.tun), 0);
});
