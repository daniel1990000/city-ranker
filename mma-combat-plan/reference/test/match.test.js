import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { FightSim } from '../src/sim/fight-sim.js';
import { MatchState } from '../src/core/taxonomy.js';
import { emptyIntent } from '../src/input/intent.js';
import { DEFAULT_FIGHTERS } from '../src/data/default-fighters.js';
import { spec } from '../src/testing/helpers.js';

function recorder() {
  const calls = [];
  return { calls, hooks: { onRoundStart: (r) => calls.push(`start${r}`), onRoundEnd: (r) => calls.push(`end${r}`), onBetweenRounds: (r) => calls.push(`rest${r}`), onFightOver: () => calls.push('over') } };
}

test('flow: preFight → round 1 live ⇄ stopped → between rounds → round 2 … → postFight; hooks fire in order, once each', () => {
  const { calls, hooks } = recorder();
  const m = new Match({ rounds: 2, roundTicks: 10, restTicks: 3, hooks });
  assert.equal(m.state, MatchState.PRE_FIGHT);
  m.start();
  assert.equal(m.state, MatchState.FIGHT); assert.equal(m.round, 1); assert.ok(m.live);
  m.stop('referee'); assert.equal(m.state, MatchState.STOPPED); assert.equal(m.reason, 'referee');
  m.resume(); assert.equal(m.state, MatchState.FIGHT); assert.equal(m.reason, null);
  for (let i = 0; i < 10; i++) m.tickClock();
  assert.equal(m.state, MatchState.BETWEEN_ROUNDS);
  for (let i = 0; i < 3; i++) m.tickRest();
  assert.equal(m.state, MatchState.FIGHT); assert.equal(m.round, 2); assert.equal(m.elapsed, 0);
  for (let i = 0; i < 10; i++) m.tickClock();
  assert.equal(m.state, MatchState.POST_FIGHT);
  assert.deepEqual(calls, ['start1', 'end1', 'rest1', 'start2', 'end2', 'over']);
});

test('illegal events are ignored', () => {
  const m = new Match({ rounds: 3, roundTicks: 10 }).start();
  m.send('resume'); m.send('next'); m.send('fightStart');
  assert.equal(m.state, MatchState.FIGHT); assert.equal(m.round, 1);
  m.stop('x'); m.stop('y');
  assert.equal(m.reason, 'x', 'a second stop while stopped does nothing');
  m.send('bell');
  assert.equal(m.state, MatchState.BETWEEN_ROUNDS, 'bell works from stopped too');
  m.send('refStop'); assert.equal(m.state, MatchState.BETWEEN_ROUNDS);
  m.send('ko');
  assert.equal(m.state, MatchState.POST_FIGHT);
  m.send('next'); m.send('bell'); m.send('ko');
  assert.equal(m.state, MatchState.POST_FIGHT, 'nothing leaves postFight');
});

test('bell on the last round goes straight to postFight; stoppage events end the fight from every fight state', () => {
  const m = new Match({ rounds: 1, roundTicks: 5 }).start();
  for (let i = 0; i < 5; i++) m.tickClock();
  assert.equal(m.state, MatchState.POST_FIGHT);
  for (const kind of ['ko', 'tko', 'tap', 'doctorStop']) {
    for (const where of ['live', 'stopped', 'between']) {
      const x = new Match({ rounds: 3, roundTicks: 5, restTicks: 100 }).start();
      if (where === 'stopped') x.stop();
      if (where === 'between') { for (let i = 0; i < 5; i++) x.tickClock(); assert.equal(x.state, MatchState.BETWEEN_ROUNDS); }
      x.finish(kind, { how: kind });
      assert.equal(x.state, MatchState.POST_FIGHT, `${kind} from ${where}`);
      assert.deepEqual(x.outcome, { how: kind });
    }
  }
});

test('clock: runs only while live, resumes with the same time left, resets every round', () => {
  const m = new Match({ rounds: 3, roundTicks: 100 }).start();
  for (let i = 0; i < 30; i++) m.tickClock();
  assert.equal(m.elapsed, 30);
  m.stop();
  for (let i = 0; i < 50; i++) m.tickClock();
  assert.equal(m.elapsed, 30, 'paused');
  assert.equal(m.secondsLeft, 70 / 60);
  m.resume();
  m.tickClock(); assert.equal(m.elapsed, 31);
  assert.equal(m.simRuns, true);
  m.stop('knockdown'); assert.equal(m.simRuns, true, 'a knockdown pauses the clock, not the action');
  m.resume(); m.stop('referee'); assert.equal(m.simRuns, false);
});

test('FightSim over several rounds: bell breaks bouts, resets positions, restores some stamina, clears the per-round strike counter, reads the cards', () => {
  const sim = new FightSim({ seed: 4, rounds: 2, roundSeconds: 40, fighters: [spec('a'), spec('b')], controllers: { a: false, b: false }, record: true });
  const [A, B] = sim.world.fighters;
  A.pos = { x: -0.3, y: 0 }; B.pos = { x: 0.3, y: 0 };
  sim.world.stats.inc('b', 'x', 1);
  // clinch them near the end of round 1 by script, then let the bell ring
  let k = 0;
  while (sim.match.round === 1 && k++ < 5000) {
    sim.step({ a: sim.world.tick % 10 === 5 && sim.world.tick < 200 ? { ...emptyIntent(), clinch: {} } : emptyIntent(), b: emptyIntent() });
    if (sim.world.tick > 50 && sim.state === 'fight' && sim.match.round === 1 && sim.world.tick < 2399) A.stamina = 10;   // gas A out, then watch the corner restore some
  }
  assert.equal(sim.match.round, 2);
  const types = sim.world.bus.log.map((e) => e.type);
  assert.ok(sim.world.bus.log.some((e) => e.type === 'clinch_start'), 'they did clinch');
  assert.ok(types.indexOf('round_end') < types.lastIndexOf('round_start'));
  assert.equal(types.filter((t) => t === 'round_start').length, 2);
  assert.equal(A.mode, 'standup'); assert.equal(B.mode, 'standup'); assert.equal(A.bout, null);
  assert.ok(A.stamina > 10, 'recovery between rounds');
  assert.ok(Math.abs(sim.world.gap(A, B) - 1.4) < 1e-6, 'back in the middle');
  assert.equal(sim.world.stats.strikesReceivedThisRound('a'), 0);
  while (!sim.over) sim.step({ a: emptyIntent(), b: emptyIntent() });
  assert.equal(sim.state, MatchState.POST_FIGHT);
  const dec = sim.world.bus.log.find((e) => e.type === 'decision');
  assert.ok(dec && dec.cards.length === 3);
  assert.equal(sim.result.stoppage, 'decision');
  assert.equal(sim.world.bus.log.filter((e) => e.type === 'round_end').length, 2);
});

test('real-time rest: with fastRest off the sim spends the rest period between rounds', () => {
  const sim = new FightSim({ seed: 4, rounds: 2, roundSeconds: 5, restSeconds: 2, fastRest: false, fighters: [DEFAULT_FIGHTERS[0], DEFAULT_FIGHTERS[1]], controllers: { a: false, b: false } });
  let rests = 0;
  while (sim.match.round === 1 || sim.state === MatchState.BETWEEN_ROUNDS) { const before = sim.state; sim.step({}); if (before === MatchState.BETWEEN_ROUNDS) rests++; if (rests > 1000) break; }
  assert.equal(rests, 2 * 60, 'two seconds of rest ticks');
  assert.equal(sim.match.round, 2);
});
