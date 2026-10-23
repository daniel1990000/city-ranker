import test from 'node:test';
import assert from 'node:assert/strict';
import { GroundBout, GROUND_GRAPH, GROUND_POSITIONS, topImproveProbability, bottomEscapeProbability, getUpProbability, hooksInFor, flagEnabled } from '../src/combat/ground.js';
import { GroundPosition as G, Mode } from '../src/core/taxonomy.js';
import { mergeTunables } from '../src/core/tunables.js';
import { makeWorld, faceOff, stepBout, runBout, eventsOf } from '../src/testing/helpers.js';

function ground(w, position, topIndex = 0, opts = {}) {
  faceOff(w, 0.4);
  const [a, b] = w.fighters;
  const top = topIndex === 0 ? a : b;
  return new GroundBout(w, top, top === a ? b : a, position, opts);
}
const sure = { ground: { pTopMin: 1, pTopMax: 1, pBottomMin: 1, pBottomMax: 1, sweepShare: 1 } };
const never = { ground: { pTopMin: 0, pTopMax: 0, pBottomMin: 0, pBottomMax: 0 } };
const act = (w, bout, f) => { f.cooldowns.ground = 0; f.action = null; };

test('graph: every position has a top option, a bottom option, a hold value and a GnP multiplier; no dangling targets', () => {
  const tun = mergeTunables();
  const all = Object.values(G).filter((p) => p !== G.NONE);
  assert.deepEqual([...GROUND_POSITIONS].sort(), [...all].sort());
  for (const pos of all) {
    const { top, bottom } = GROUND_GRAPH[pos];
    assert.ok(top.some((e) => !e.flag && !e.needs), `${pos} unconditional top option`);
    assert.ok(bottom.length >= 1, `${pos} bottom option`);
    assert.ok(typeof tun.ground.hold[pos] === 'number', `${pos} hold`);
    assert.ok(typeof tun.ground.gnpMult[pos] === 'number', `${pos} gnp`);
    for (const e of [...top, ...bottom]) assert.ok(GROUND_GRAPH[e.to], `${pos} -> ${e.to}`);
  }
});

test('graph: from guard the top fighter can reach side control, full mount and back mount', () => {
  const seen = new Set([G.GUARD]);
  const queue = [G.GUARD];
  while (queue.length) for (const e of GROUND_GRAPH[queue.shift()].top) if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
  for (const p of [G.HALF_GUARD, G.SIDE_CONTROL, G.FULL_MOUNT, G.BACK_MOUNT, G.NORTH_SOUTH]) assert.ok(seen.has(p), p);
  // and a bottom fighter can always work back toward guard/half guard
  for (const pos of GROUND_POSITIONS) assert.ok(GROUND_GRAPH[pos].bottom.some((e) => [G.GUARD, G.HALF_GUARD].includes(e.to) || e.swap), pos);
});

test('probabilities are bounded and monotone in the rating delta', () => {
  const w = makeWorld();
  const [a, b] = w.fighters;
  const tun = mergeTunables();
  let prev = -1;
  for (let r = 0; r <= 100; r += 10) { a.ratings.groundpassing = r; const p = topImproveProbability(a, b, tun, { position: G.HALF_GUARD }); assert.ok(p >= prev && p >= 0.05 && p <= 0.92); prev = p; }
  prev = 2;
  for (let r = 0; r <= 100; r += 10) { b.ratings.groundcontrol = r; const p = topImproveProbability(a, b, tun, { position: G.HALF_GUARD }); assert.ok(p <= prev); prev = p; }
  assert.ok(topImproveProbability(a, b, tun, { position: G.GUARD }) < topImproveProbability(a, b, tun, { position: G.HALF_GUARD }), 'closed guard resists passes');
  assert.ok(topImproveProbability(a, b, tun, { position: G.HALF_GUARD, activeDefence: true }) < topImproveProbability(a, b, tun, { position: G.HALF_GUARD }));
  prev = -1;
  b.ratings.groundcontrol = 50; a.ratings.groundcontrol = 50;
  for (let r = 0; r <= 100; r += 10) { b.ratings.groundcontrol = r; const p = bottomEscapeProbability(b, a, tun, { position: G.SIDE_CONTROL }); assert.ok(p >= prev && p >= 0.05 && p <= 0.85); prev = p; }
  assert.ok(bottomEscapeProbability(b, a, tun, { position: G.FULL_MOUNT }) < bottomEscapeProbability(b, a, tun, { position: G.GUARD }), 'mount holds harder than guard');
  assert.ok(getUpProbability(b, a, tun, { broken: true }) > getUpProbability(b, a, tun) && getUpProbability(b, a, tun, { cage: true }) > getUpProbability(b, a, tun));
  assert.ok(hooksInFor(G.GUARD) && !hooksInFor(G.SIDE_CONTROL));
});

test('top fighter with broken posture hits at <= 0.5x damage (same dice)', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const take = (posture) => {
      const w = makeWorld({ seed });
      const bout = ground(w, G.SIDE_CONTROL);
      bout.topPosture = posture;
      assert.ok(bout.strike(w.fighters[0], 'hammer', 'head'));
      const before = w.fighters[1].pools.head.cur;
      bout.resolveAction(w.fighters[0]);
      return before - w.fighters[1].pools.head.cur;
    };
    const up = take('upright'), broken = take('broken');
    assert.ok(up > 0);
    assert.ok(broken <= up * 0.5 + 1e-9, `seed ${seed}: ${broken} vs ${up}`);
  }
});

test('cover blocks 40 % of ground strikes; mount hits harder than guard', () => {
  const w = makeWorld({ seed: 4 });
  const bout = ground(w, G.FULL_MOUNT);
  const [a, b] = w.fighters;
  bout.applyIntent(b, { move: { x: 0, y: 0 }, guard: 'high', grapple: null });
  assert.ok(b.cover > 0);
  bout.strike(a, 'hammer', 'head');
  const r = bout.resolveAction(a);
  assert.equal(r.ev.outcome, 'blocked');
  assert.ok(Math.abs(r.dmg.mitigation - 0.4) < 1e-9);
  const mean = (pos) => { let s = 0; for (let seed = 1; seed <= 120; seed++) { const x = makeWorld({ seed }); const g = ground(x, pos); g.strike(x.fighters[0], 'hammer', 'head'); s += g.resolveAction(x.fighters[0]).dmg.taken; } return s / 120; };
  assert.ok(mean(G.FULL_MOUNT) > mean(G.GUARD) * 1.8);
});

test('transitions: top pass changes the position and counts a pass; a failed attempt gives the opponent a free action', () => {
  const w = makeWorld({ tunables: sure });
  const bout = ground(w, G.HALF_GUARD);
  const [a, b] = w.fighters;
  a.cooldowns.ground = 0;
  assert.ok(bout.transition(a, G.SIDE_CONTROL));
  assert.equal(bout.position, G.SIDE_CONTROL);
  assert.equal(w.stats.get('a', 'passes.landed'), 1);
  assert.equal(eventsOf(w, 'ground_position').at(-1).reason, 'pass');
  assert.equal(bout.transition(a, G.FULL_MOUNT), false, 'cadence: one attempt per 90 ticks');
  assert.ok(a.cooldowns.ground > 80);

  const w2 = makeWorld({ tunables: never });
  const b2 = ground(w2, G.HALF_GUARD);
  const [x, y] = w2.fighters;
  x.cooldowns.ground = 0; y.cooldowns.ground = 77;
  assert.equal(b2.transition(x, G.SIDE_CONTROL), false);
  assert.equal(b2.position, G.HALF_GUARD);
  assert.equal(y.cooldowns.ground, 0, 'free action for the bottom fighter');
  assert.equal(w2.stats.get('a', 'passes.failed'), 1);
  assert.equal(w2.stats.get('b', 'passes.denied'), 1);
});

test('passes_successful increments only on top-improving transitions (escapes and sweeps are not passes)', () => {
  const w = makeWorld({ tunables: sure });
  const bout = ground(w, G.SIDE_CONTROL);
  const [a, b] = w.fighters;
  b.cooldowns.ground = 0;
  assert.ok(bout.transition(b, G.HALF_GUARD), 'bottom escape');
  assert.equal(w.stats.get('b', 'passes.landed'), 0);
  assert.equal(w.stats.get('a', 'passes.landed'), 0);
  assert.equal(bout.position, G.HALF_GUARD); assert.equal(bout.top, a);

  b.cooldowns.ground = 0;
  assert.ok(bout.transition(b, G.HALF_GUARD), 'half guard sweep (swap)');
  assert.equal(bout.top, b); assert.equal(bout.bottom, a);
  assert.equal(b.groundRole, 'dom'); assert.equal(a.groundRole, 'sub');
  assert.equal(w.stats.get('b', 'sweeps.landed'), 1);
  assert.equal(w.stats.get('b', 'passes.landed'), 0);
});

test('optional transitions need the fighter flag; back mount from side control needs a turtled opponent', () => {
  const w = makeWorld({ tunables: sure, a: { groundcontrol: 90 }, b: {} });
  const bout = ground(w, G.SIDE_CONTROL);
  const [a] = w.fighters;
  assert.ok(flagEnabled(a, 'crucifix'));
  assert.ok(bout.edgesFor(a).some((e) => e.to === G.CRUCIFIX));
  a.spec.groundFlags = [];
  assert.ok(!bout.edgesFor(a).some((e) => e.to === G.CRUCIFIX));
  assert.ok(!bout.edgesFor(a).some((e) => e.to === G.BACK_MOUNT));
  assert.ok(bout.turtleUp(w.fighters[1]));
  assert.ok(bout.edgesFor(a).some((e) => e.to === G.BACK_MOUNT));
  assert.equal(w.fighters[1].floorPosture, 'turtle');
});

test('posture control breaks the top fighter\'s posture for 45 ticks, then it recovers', () => {
  let broke = false;
  for (let seed = 1; seed < 60 && !broke; seed++) {
    const w = makeWorld({ seed, b: { groundcontrol: 90 } });
    const bout = ground(w, G.GUARD);
    w.fighters[1].cooldowns.ground = 0;
    if (bout.postureControl(w.fighters[1])) {
      broke = true; assert.equal(bout.topPosture, 'broken');
      for (let i = 0; i < 44; i++) stepBout(w, bout);
      assert.equal(bout.topPosture, 'broken');
      stepBout(w, bout); stepBout(w, bout);
      assert.equal(bout.topPosture, 'upright');
    }
  }
  assert.ok(broke);
});

test('get-up: success restores stand-up at the get-up gap; failure is counted', () => {
  let ok = false, failed = false;
  for (let seed = 1; seed < 100 && !(ok && failed); seed++) {
    const w = makeWorld({ seed, b: { movement: 90, groundcontrol: 70 } });
    const bout = ground(w, G.HALF_GUARD);
    const [a, b] = w.fighters;
    b.cooldowns.ground = 0;
    if (bout.getUp(b)) {
      ok = true;
      assert.equal(a.mode, Mode.STANDUP); assert.equal(b.mode, Mode.STANDUP); assert.equal(b.bout, null);
      assert.ok(Math.abs(w.gap(a, b) - w.tun.ground.getUpGap) < 1e-6);
      assert.equal(b.failedGetups, 0);
    } else { failed = true; assert.equal(b.failedGetups, 1); assert.equal(b.mode, Mode.GROUND); }
  }
  assert.ok(ok && failed);
});

test('referee: 5 s without action warns, 10 s stands the fighters up in the middle', () => {
  const w = makeWorld();
  const bout = ground(w, G.GUARD);
  w.fighters[0].pos = { x: 3, y: 1 };
  let n = 0;
  while (!bout.finished && n < 2000) { stepBout(w, bout); n++; }
  const refs = eventsOf(w, 'referee');
  assert.deepEqual(refs.map((e) => e.kind), ['low_action', 'stand_up']);
  assert.equal(refs[0].tick, 300); assert.equal(refs[1].tick, 600);
  const [a, b] = w.fighters;
  assert.equal(a.mode, Mode.STANDUP);
  assert.ok(Math.abs(w.gap(a, b) - w.tun.ground.standUpGap) < 1e-6);
  assert.equal(a.pos.y, 0);
});

test('a strike or a transition attempt resets the idle clock', () => {
  const w = makeWorld();
  const bout = ground(w, G.GUARD);
  for (let i = 0; i < 280; i++) stepBout(w, bout);
  bout.strike(w.fighters[0], 'hammer', 'head');
  bout.resolveAction(w.fighters[0]);
  for (let i = 0; i < 280; i++) stepBout(w, bout);
  assert.ok(!bout.finished);
  assert.equal(eventsOf(w, 'referee').length, 0);
});

test('ground dominance: time on top in a held position (hold >= 0.15) accrues; guard does not', () => {
  const w = makeWorld();
  const bout = ground(w, G.SIDE_CONTROL);
  const [a, b] = w.fighters;
  assert.deepEqual(bout.timeKeys(a), ['time.ground.top', 'time.ground.dominant']);
  assert.deepEqual(bout.timeKeys(b), ['time.ground.bottom']);
  assert.ok(bout.dominant);
  const g2 = ground(makeWorld(), G.GUARD);
  assert.deepEqual(g2.timeKeys(g2.top), ['time.ground.top'], 'guard (hold 0) is not a dominant status');
  assert.ok(!g2.dominant);
});

test('legalActions are consistent with the graph; submissions respect position and role', () => {
  const w = makeWorld();
  const bout = ground(w, G.GUARD);
  const [a, b] = w.fighters;
  a.cooldowns.ground = b.cooldowns.ground = 0; a.cooldowns.submission = b.cooldowns.submission = 0;
  const top = bout.legalActions(a), bot = bout.legalActions(b);
  assert.ok(top.some((x) => x.kind === 'strike') && top.some((x) => x.kind === 'transition'));
  assert.ok(bot.some((x) => x.kind === 'getup') && bot.some((x) => x.kind === 'submission' && x.name === 'armbar'), 'armbar from the bottom of guard');
  assert.ok(top.some((x) => x.kind === 'submission' && x.name === 'heel_hook'));
  assert.ok(!top.some((x) => x.kind === 'submission' && x.name === 'armbar'));
  assert.equal(bout.startSubmission(a, 'armbar'), false, 'not available from the top of guard');
  b.stunned = true; b.status = { ...b.status, helpless: true, ticks: 30 };
  assert.deepEqual(bout.legalActions(b), []);
});

test('fixed seed → identical ground exchange', () => {
  const run = (seed) => {
    const w = makeWorld({ seed, a: { groundpassing: 70 }, b: { groundcontrol: 60 } });
    const bout = ground(w, G.GUARD);
    for (let i = 0; i < 1500 && !bout.finished; i++) {
      for (const f of w.fighters) {
        if (i % 20 !== 0 || f.busy()) continue;
        const legal = bout.legalActions(f).filter((x) => x.kind !== 'submission' && x.kind !== 'release');
        if (legal.length) bout.applyIntent(f, { move: { x: 0, y: 0 }, guard: 'none', grapple: legal[(i * 7 + f.index) % legal.length] });
      }
      for (const f of w.fighters) if (f.action) { f.action.tick += 1; if (f.action.tick === f.action.frames.startup) bout.resolveAction(f); if (f.action.tick > 40) f.action = null; }
      if (w.fighters[0].mode !== Mode.GROUND) break;
      stepBout(w, bout);
    }
    return JSON.stringify([w.bus.log.map((e) => [e.type, e.tick, e.to ?? e.outcome ?? null]), w.stateHash()]);
  };
  assert.equal(run(5), run(5));
});
