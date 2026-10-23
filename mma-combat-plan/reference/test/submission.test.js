import test from 'node:test';
import assert from 'node:assert/strict';
import { SubmissionBout, beginSubmission, availableSubmissions, submissionStartProbability, stageProbability, escapePosition, submissionCategory } from '../src/combat/submission.js';
import { GroundBout } from '../src/combat/ground.js';
import { GroundPosition as G, Mode, SUBMISSIONS } from '../src/core/taxonomy.js';
import { mergeTunables } from '../src/core/tunables.js';
import { makeWorld, faceOff, stepBout, runBout, eventsOf } from '../src/testing/helpers.js';

const SURE = { submission: { startMin: 1, startMax: 1, stageMin: 1, stageMax: 1, stageBase: 1 } };      // attacker always wins
const LOSE = { submission: { startMin: 1, startMax: 1, stageMin: 0, stageMax: 0, stageBase: 0 } };      // defender always wins
const NO_TAP = { submission: { tapBase: 0, tapMin: 0, tapMax: 0 } };
const ALWAYS_TAP = { submission: { tapBase: 1, tapMin: 1, tapMax: 1 } };
const merge = (...o) => o.reduce((acc, x) => { for (const [k, v] of Object.entries(x)) acc[k] = { ...(acc[k] ?? {}), ...v }; return acc; }, {});

function start(w, name, position, role, topIndex = 0) {
  faceOff(w, 0.4);
  const [a, b] = w.fighters;
  const top = topIndex === 0 ? a : b, bottom = top === a ? b : a;
  const g = new GroundBout(w, top, bottom, position);
  const attacker = role === 'dom' ? top : bottom, defender = role === 'dom' ? bottom : top;
  const r = beginSubmission(w, { attacker, defender, name, position, role, ground: g });
  return { ...r, attacker, defender, ground: g };
}

test('availableSubmissions reproduces the observed position → submission table exactly', () => {
  const expected = {};
  for (const [name, s] of Object.entries(SUBMISSIONS)) for (const [pos, role] of Object.entries(s.from)) (expected[`${pos}|${role}`] ??= []).push(name);
  for (const [key, names] of Object.entries(expected)) { const [pos, role] = key.split('|'); assert.deepEqual(availableSubmissions(pos, role).sort(), names.sort(), key); }
  assert.deepEqual(availableSubmissions(G.BACK_MOUNT, 'dom').sort(), ['armbar', 'rear_naked_choke']);
  assert.deepEqual(availableSubmissions(G.GUARD, 'sub').sort(), ['armbar', 'guillotine', 'omoplata', 'triangle']);
  assert.deepEqual(availableSubmissions(G.NORTH_SOUTH, 'sub'), []);
  assert.equal(submissionCategory('rear_naked_choke'), 'choke'); assert.equal(submissionCategory('kimura'), 'lock');
});

test('start and stage probabilities are bounded, monotone in the rating delta, and fall with stage / fatigue', () => {
  const w = makeWorld();
  const [a, b] = w.fighters;
  const tun = mergeTunables();
  let prev = -1;
  for (let r = 0; r <= 100; r += 10) { a.ratings.chokesubmission = r; const p = submissionStartProbability(a, b, 'rear_naked_choke', tun); assert.ok(p >= prev && p >= 0.1 && p <= 0.9); prev = p; }
  a.ratings.chokesubmission = 50; b.ratings.chokedefense = 50;
  const ps = [1, 2, 3, 4, 5].map((s) => stageProbability(a, b, 'rear_naked_choke', s, tun));
  for (let i = 1; i < 5; i++) assert.ok(ps[i] < ps[i - 1]);
  a.stamina = 10; assert.ok(submissionStartProbability(a, b, 'rear_naked_choke', tun) < submissionStartProbability({ ...a, staminaFraction: () => 1, rating: (n) => a.rating(n) }, b, 'rear_naked_choke', tun));
  a.stamina = 100;
  // joint submissions use the joint ratings
  a.ratings.jointsubmission = 90; b.ratings.jointdefense = 10;
  assert.ok(submissionStartProbability(a, b, 'kimura', tun) > submissionStartProbability(a, b, 'rear_naked_choke', tun));
});

test('unavailable moves are refused; a failed gate leaves the fighters on the ground', () => {
  const w = makeWorld();
  faceOff(w, 0.4);
  const [a, b] = w.fighters;
  const g = new GroundBout(w, a, b, G.GUARD);
  assert.equal(beginSubmission(w, { attacker: a, defender: b, name: 'armbar', position: G.GUARD, role: 'dom', ground: g }).ok, false);
  assert.equal(eventsOf(w, 'submission').length, 0);

  const w2 = makeWorld({ tunables: { submission: { startMin: 0, startMax: 0 } } });
  faceOff(w2, 0.4);
  const g2 = new GroundBout(w2, w2.fighters[0], w2.fighters[1], G.BACK_MOUNT);
  const r = beginSubmission(w2, { attacker: w2.fighters[0], defender: w2.fighters[1], name: 'rear_naked_choke', position: G.BACK_MOUNT, role: 'dom', ground: g2 });
  assert.deepEqual([r.ok, r.started], [true, false]);
  assert.deepEqual(eventsOf(w2, 'submission').map((e) => e.result), ['start', 'denied']);
  assert.equal(w2.fighters[0].mode, Mode.GROUND); assert.equal(g2.finished, false);
});

test('full success path: five stages, 0.2 damage each, tap decision, SUBMISSION win events', () => {
  const w = makeWorld({ tunables: merge(SURE, ALWAYS_TAP) });
  const { bout, attacker, defender } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
  assert.equal(attacker.mode, Mode.SUBMISSION); assert.equal(bout.mode, 'auto');
  runBout(w, bout);
  assert.equal(bout.result, 'tap');
  assert.ok(Math.abs(bout.damage - 1.0) < 1e-9);
  const evs = eventsOf(w, 'submission').map((e) => `${e.result}${e.stage ?? ''}`);
  assert.deepEqual(evs, ['start0', 'stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'tap5']);
  assert.equal(w.stats.get(attacker.id, 'subs.attempted'), 1);
  assert.equal(w.stats.get(attacker.id, 'subs.locked'), 1);
  assert.equal(w.stats.get(attacker.id, 'subs.finished'), 1);
  assert.equal(bout.finished, true); assert.equal(defender.bout, null);
});

test('no tap: a choke puts the defender out (knockout event); a lock injures (injury result)', () => {
  const w = makeWorld({ tunables: merge(SURE, NO_TAP) });
  const { bout, defender } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
  runBout(w, bout);
  assert.equal(bout.result, 'ko');
  assert.equal(defender.status.event, 'knockout');
  assert.equal(eventsOf(w, 'submission').at(-1).result, 'ko');
  assert.ok(eventsOf(w, 'health_event').some((e) => e.event === 'knockout' && e.fighter === defender.id));
  assert.equal(w.stats.get(bout.attacker.id, 'subs.finished'), 1);

  const w2 = makeWorld({ tunables: merge(SURE, NO_TAP) });
  const s2 = start(w2, 'kimura', G.SIDE_CONTROL, 'dom');
  runBout(w2, s2.bout);
  assert.equal(s2.bout.result, 'injury');
  assert.equal(s2.defender.status.event, 'none', 'locks injure, they do not knock out');
  assert.equal(eventsOf(w2, 'submission').at(-1).result, 'injury');
});

test('AI tap probability falls with toughness', () => {
  const rate = (toughness) => {
    let taps = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const w = makeWorld({ seed, b: { toughness }, tunables: SURE });
      const { bout } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
      runBout(w, bout);
      if (bout.result === 'tap') taps++;
    }
    return taps / 300;
  };
  assert.ok(rate(10) > rate(95) + 0.1);
});

test('escape: three lost duels free the defender; a top attacker loses position, a bottom attacker keeps it', () => {
  const w = makeWorld({ tunables: LOSE });
  const { bout, attacker, defender } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
  runBout(w, bout);
  assert.equal(bout.result, 'escape');
  assert.equal(attacker.mode, Mode.GROUND);
  assert.equal(attacker.bout.kind, 'ground');
  assert.equal(attacker.bout.position, escapePosition(G.BACK_MOUNT));
  assert.equal(attacker.bout.top, attacker, 'roles unchanged');
  assert.equal(w.stats.get(defender.id, 'subs.escaped'), 1);
  assert.equal(w.stats.get(attacker.id, 'subs.locked'), 0);

  const w2 = makeWorld({ tunables: LOSE });
  const s2 = start(w2, 'armbar', G.GUARD, 'sub');
  runBout(w2, s2.bout);
  assert.equal(s2.attacker.bout.position, G.GUARD);
  assert.equal(s2.attacker.bout.bottom, s2.attacker);
});

test('counters reconcile over many sessions: attempts >= locked, attempts >= finishes + escapes', () => {
  let attempted = 0, locked = 0, finished = 0, escaped = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const w = makeWorld({ seed, a: { chokesubmission: 60, jointsubmission: 60 }, b: { chokedefense: 50, jointdefense: 50, toughness: 40 } });
    faceOff(w, 0.4);
    const [a, b] = w.fighters;
    const g = new GroundBout(w, a, b, G.BACK_MOUNT);
    const r = beginSubmission(w, { attacker: a, defender: b, name: 'rear_naked_choke', position: G.BACK_MOUNT, role: 'dom', ground: g });
    if (r.started) runBout(w, r.bout, 3000);
    attempted += w.stats.get('a', 'subs.attempted'); locked += w.stats.get('a', 'subs.locked');
    finished += w.stats.get('a', 'subs.finished'); escaped += w.stats.get('b', 'subs.escaped');
  }
  assert.equal(attempted, 400);
  assert.ok(attempted >= locked && locked > 0);
  assert.ok(attempted >= finished + escaped && finished > 0 && escaped > 0, JSON.stringify({ attempted, locked, finished, escaped }));
});

test('a better submission artist finishes more; a better defender escapes more', () => {
  const finishRate = (atk, def) => {
    let n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const w = makeWorld({ seed, a: { chokesubmission: atk }, b: { chokedefense: def }, tunables: { submission: { startMin: 1, startMax: 1 } } });
      const { bout } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
      runBout(w, bout, 3000);
      if (bout.result === 'tap' || bout.result === 'ko') n++;
    }
    return n / 300;
  };
  assert.ok(finishRate(90, 40) > finishRate(50, 50) && finishRate(50, 50) > finishRate(40, 90));
});

test('stamina: attacker and defender drain at the tunable per-second rates while the session runs', () => {
  const w = makeWorld({ tunables: { submission: { stageTicks: 10000, startMin: 1, startMax: 1 } } });
  const { bout, attacker, defender } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
  const sa = attacker.stamina, sd = defender.stamina;
  for (let i = 0; i < 120; i++) stepBout(w, bout);
  const s = w.tun.submission;
  assert.ok(Math.abs((sa - attacker.stamina) - 2 * s.staminaPerSecAttacker) < 1e-6 && Math.abs((sd - defender.stamina) - 2 * s.staminaPerSecDefender) < 1e-6);
  assert.ok(s.staminaPerSecDefender > s.staminaPerSecAttacker, 'the defender works harder');
});

test('an exhausted AI attacker releases the hold (abort), no escape recorded', () => {
  const w = makeWorld({ tunables: { submission: { stageTicks: 10000, startMin: 1, startMax: 1 } } });
  const { bout, attacker, defender } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
  attacker.stamina = 5;                                  // below the 8 % abort threshold
  stepBout(w, bout);
  assert.equal(bout.result, 'abort');
  assert.equal(attacker.bout.kind, 'ground'); assert.equal(attacker.bout.position, G.BACK_MOUNT);
  assert.equal(w.stats.get(defender.id, 'subs.escaped'), 0);
});

test('bell during stage >= 3 is "saved by the bell"', () => {
  const w = makeWorld({ tunables: merge(SURE, { submission: { stageTicks: 5 } }) });
  const { bout, defender } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
  for (let i = 0; i < 4 * 5 + 1 && bout.stage < 3; i++) stepBout(w, bout);
  assert.ok(bout.stage >= 3);
  bout.end('bell');
  assert.equal(w.stats.get(defender.id, 'subs.saved_by_bell'), 1);
  assert.equal(defender.mode, Mode.GROUND);
});

test('meter mode: a human attacker who locks at the centre of the zone wins stages; defender AI never presses', () => {
  const w = makeWorld({ aMeta: { human: true }, tunables: merge({ submission: { mode: 'meter', startMin: 1, startMax: 1 } }, NO_TAP) });
  const { bout } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
  assert.equal(bout.mode, 'meter');
  let guard = 0;
  while (!bout.finished && guard++ < 6000) {
    const m = bout.duel;
    const press = m && m.running && m.delay <= 0 && m.posDom >= m.centre;
    stepBout(w, bout, { a: { prompt: { end: !!press } } });
  }
  assert.equal(bout.result, 'ko', 'five clean stage wins then no-tap');
  assert.equal(bout.stage, 5);
});

test('meter mode: a human attacker who never locks loses the stage (and eventually the hold)', () => {
  const w = makeWorld({ aMeta: { human: true }, tunables: { submission: { mode: 'meter', startMin: 1, startMax: 1 } } });
  const { bout } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
  runBout(w, bout, 6000);
  assert.equal(bout.result, 'escape');
});

test('gate mode: a human defender who presses the prompted button blocks every stage; one who does not is submitted', () => {
  const play = (defends) => {
    const w = makeWorld({ bMeta: { human: true }, tunables: merge({ submission: { mode: 'gate', startMin: 1, startMax: 1 } }, ALWAYS_TAP) });
    const { bout } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
    assert.equal(bout.mode, 'gate');
    let guard = 0;
    while (!bout.finished && guard++ < 6000) {
      const mask = bout.duel.mask;
      const buttons = [0, 1, 2, 3].map((i) => (defends && mask === 1 << i ? 1 : 0));
      stepBout(w, bout, { b: { prompt: { buttons, tap: true } } });
    }
    return bout.result;
  };
  assert.equal(play(true), 'escape');
  assert.equal(play(false), 'tap');
});

test('snipe mode: a human attacker who never reacts fails the three count-up tries (denied, back to the ground)', () => {
  const w = makeWorld({ aMeta: { human: true }, tunables: { submission: { mode: 'snipe', startMin: 1, startMax: 1 } } });
  const { bout, attacker } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
  runBout(w, bout, 3000);
  assert.equal(bout.tries, 3);
  assert.equal(eventsOf(w, 'submission').at(-1).result, 'denied');
  assert.equal(attacker.bout.kind, 'ground');
});

test('snipe mode: perfect reactions set the hold and survive the countdown to a finish', () => {
  const w = makeWorld({ aMeta: { human: true }, tunables: merge({ submission: { mode: 'snipe', startMin: 1, startMax: 1 } }, ALWAYS_TAP) });
  const { bout } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
  let guard = 0;
  while (!bout.finished && guard++ < 8000) {
    const mask = bout.chain && bout.chainBusy ? 1 << (bout.nextButton ?? 0) : 0;
    const buttons = [0, 1, 2, 3].map((i) => (mask === 1 << i ? 1 : 0));
    stepBout(w, bout, { a: { prompt: { buttons } } });
  }
  assert.equal(bout.result, 'tap');
  assert.equal(bout.stage, 5);
});

test('fixed seed → identical session', () => {
  const run = (seed) => {
    const w = makeWorld({ seed });
    const { bout } = start(w, 'rear_naked_choke', G.BACK_MOUNT, 'dom');
    if (bout) runBout(w, bout, 3000);
    return JSON.stringify([w.bus.log.map((e) => [e.type, e.tick, e.result ?? null]), w.stateHash()]);
  };
  assert.equal(run(9), run(9));
});
