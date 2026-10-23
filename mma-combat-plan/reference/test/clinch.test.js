import test from 'node:test';
import assert from 'node:assert/strict';
import { ClinchBout, CLINCH_TRANSITIONS, attemptClinch, canAttemptClinch, clinchEntryProbability, domProbability, getAvailableTakedowns, chooseClinchType } from '../src/combat/clinch.js';
import { CLINCH_TAKEDOWNS, ClinchPosition as P, Mode } from '../src/core/taxonomy.js';
import { takedownProbability } from '../src/combat/takedown.js';
import { makeWorld, faceOff, stepBout, runBout, eventsOf } from '../src/testing/helpers.js';
import { mergeTunables } from '../src/core/tunables.js';

const near = (w) => faceOff(w, 0.7);   // centre distance 0.7 → edge gap 0.14 < clinch range 0.30

function clinched(w, position = P.OVER_UNDER, domIndex = 0) {
  near(w);
  const [a, b] = w.fighters;
  return new ClinchBout(w, domIndex === 0 ? a : b, domIndex === 0 ? b : a, position);
}

test('entry probability rises with clinchcontrol spread, falls with striking/guarding, and stays inside its bounds', () => {
  const tun = mergeTunables();
  const w = makeWorld();
  const [a, b] = w.fighters;
  const at = (ra, rb, o) => { a.ratings.clinchcontrol = ra; b.ratings.clinchcontrol = rb; return clinchEntryProbability(a, b, tun, o); };
  assert.ok(at(30, 70) < at(50, 50) && at(50, 50) < at(70, 30));
  assert.ok(at(50, 50, { defenderStriking: true }) < at(50, 50));
  assert.ok(at(50, 50, { defenderGuardHigh: true }) < at(50, 50));
  for (let ra = 0; ra <= 100; ra += 10) for (let rb = 0; rb <= 100; rb += 10) {
    const p = at(ra, rb, { defenderStriking: true, defenderGuardHigh: true });
    assert.ok(p >= tun.clinch.entryMin - 1e-12 && p <= tun.clinch.entryMax + 1e-12);
  }
  assert.ok(at(100, 0) === tun.clinch.entryMax || at(100, 0) <= tun.clinch.entryMax);
});

test('observed entry rate follows the formula', () => {
  const N = 1500;
  for (const [ra, rb] of [[70, 30], [30, 70]]) {
    let ok = 0, expect = 0;
    for (let seed = 1; seed <= N; seed++) {
      const w = makeWorld({ seed, a: { clinchcontrol: ra }, b: { clinchcontrol: rb } });
      near(w);
      const [a, b] = w.fighters;
      expect = clinchEntryProbability(a, b, w.tun, { defenderStriking: false, defenderGuardHigh: false });
      if (attemptClinch(w, a, b).outcome === 'success') ok++;
    }
    assert.ok(Math.abs(ok / N - expect) < 0.04, `${ra}v${rb}: ${ok / N} vs ${expect}`);
  }
});

test('roles follow the rating spread, not who initiated', () => {
  const N = 1500;
  for (const [ra, rb] of [[70, 30], [30, 70], [50, 50]]) {
    let attDom = 0, n = 0, expect = 0;
    for (let seed = 1; seed <= N; seed++) {
      const w = makeWorld({ seed, a: { clinchcontrol: ra }, b: { clinchcontrol: rb } });
      near(w);
      const [a, b] = w.fighters;
      b.status = { ...b.status, helpless: true, ticks: 100 };         // guaranteed entry so we can sample roles
      const r = attemptClinch(w, a, b);
      assert.equal(r.outcome, 'success');
      expect = domProbability(a, b, w.tun);
      n++; if (r.bout.dom === a) attDom++;
    }
    assert.ok(Math.abs(attDom / n - expect) < 0.04, `${ra}v${rb}: ${attDom / n} vs ${expect}`);
  }
});

test('attempt outcomes: missed when out of range, illegal (null) when busy / cooling down, denied gives the defender a counter window', () => {
  const w = makeWorld();
  const [a, b] = w.fighters;
  faceOff(w, 2.0);
  assert.equal(attemptClinch(w, a, b).outcome, 'missed');
  assert.equal(attemptClinch(w, a, b).outcome, null, 'cooldown after an attempt');
  assert.equal(canAttemptClinch(w, a, b).reason, 'cooldown');
  a.cooldowns.clinch = 0; a.action = {};
  assert.equal(canAttemptClinch(w, a, b).reason, 'busy');
  a.action = null;
  b.mode = Mode.CLINCH;
  assert.equal(canAttemptClinch(w, a, b).reason, 'mode');
  b.mode = Mode.STANDUP;
  // find a seed that is denied
  let denied = false;
  for (let seed = 1; seed < 200 && !denied; seed++) {
    const x = makeWorld({ seed, a: { clinchcontrol: 20 }, b: { clinchcontrol: 80 } });
    near(x);
    const r = attemptClinch(x, x.fighters[0], x.fighters[1]);
    if (r.outcome === 'denied') { denied = true; assert.ok(x.fighters[1].counterWindow > 0); assert.equal(x.fighters[0].mode, Mode.STANDUP); }
  }
  assert.ok(denied);
});

test('takedown table: exactly the observed matrix; thai/dom is only trips; sub positions that are dom-only are empty', () => {
  for (const pos of Object.values(P)) for (const role of ['dom', 'sub']) assert.deepEqual(getAvailableTakedowns(pos, role), [...CLINCH_TAKEDOWNS[pos][role]]);
  assert.deepEqual(getAvailableTakedowns(P.THAI, 'dom'), ['inside_trip', 'outside_trip']);
  assert.equal(getAvailableTakedowns(P.OVER_UNDER, 'sub').length, 12);
  assert.equal(getAvailableTakedowns(P.DOUBLE_UNDER, 'sub').length, 0);
  assert.equal(getAvailableTakedowns(P.BACK_CLINCH, 'dom').length, 2);
  // transitions graph is closed and every position has an exit
  for (const [pos, outs] of Object.entries(CLINCH_TRANSITIONS)) { assert.ok(outs.length > 0); for (const o of outs) assert.ok(CLINCH_TRANSITIONS[o], `${pos} -> ${o}`); }
});

test('entry type follows style: plum for Thai, double-under for wrestlers, hint respected only if allowed', () => {
  const w = makeWorld({ aMeta: { style: 'muay_thai' }, bMeta: { style: 'freestyle_wrestler' } });
  const [a, b] = w.fighters;
  assert.equal(chooseClinchType(a), P.THAI);
  assert.equal(chooseClinchType(b), P.DOUBLE_UNDER);
  assert.equal(chooseClinchType(a, P.SINGLE_COLLAR), P.SINGLE_COLLAR);
  assert.equal(chooseClinchType(b, P.THAI), P.DOUBLE_UNDER, 'wrestlers may not plum');
});

test('break: positions reset to the break gap, roles/flags cleared, modes restored', () => {
  const w = makeWorld();
  const bout = clinched(w);
  const [a, b] = w.fighters;
  assert.equal(a.mode, Mode.CLINCH); assert.equal(a.groundRole, 'dom'); assert.equal(b.groundRole, 'sub');
  bout.end('released');
  assert.equal(a.mode, Mode.STANDUP); assert.equal(b.mode, Mode.STANDUP);
  assert.equal(a.groundRole, null); assert.equal(a.bout, null);
  const gap = w.gap(a, b);
  assert.ok(Math.abs(gap - w.tun.clinch.breakGap) < 1e-6, `gap ${gap}`);
  assert.equal(eventsOf(w, 'clinch_break').length, 1);
  bout.end('again');                                   // idempotent
  assert.equal(eventsOf(w, 'clinch_break').length, 1);
});

test('stamina drains faster for the sub; plum costs the dom more', () => {
  const w = makeWorld();
  const bout = clinched(w);
  const [a, b] = w.fighters;
  const sa = a.stamina, sb = b.stamina;
  for (let i = 0; i < 120; i++) stepBout(w, bout);
  assert.ok(sb - b.stamina > sa - a.stamina, 'sub resists, spends more');
  const w2 = makeWorld(), plum = clinched(w2, P.THAI);
  const base = w2.fighters[0].stamina;
  for (let i = 0; i < 120; i++) stepBout(w2, plum);
  assert.ok(base - w2.fighters[0].stamina > sa - a.stamina, 'plum dom spends more than over-under dom');
});

test('referee: warning, then break, after the tunable idle times without a damaging action; a strike resets the clock', () => {
  const w = makeWorld();
  const bout = clinched(w);
  let n = 0;
  while (!bout.finished && n < 2000) { stepBout(w, bout); n++; }
  const refs = eventsOf(w, 'referee');
  assert.deepEqual(refs.map((e) => e.kind), ['low_action', 'break']);
  assert.equal(refs[0].tick, w.tun.clinch.lowActionWarnSeconds * 60); assert.equal(refs[1].tick, w.tun.clinch.breakSeconds * 60);
  assert.equal(eventsOf(w, 'clinch_break')[0].reason, 'referee_break');

  const w2 = makeWorld();
  const b2 = clinched(w2);
  for (let i = 0; i < 250; i++) stepBout(w2, b2);
  assert.ok(b2.strike(w2.fighters[0], 'knee', 'body'));
  while (w2.fighters[0].action && !w2.fighters[0].action.resolved) { w2.fighters[0].action.tick += 1; if (w2.fighters[0].action.tick >= w2.fighters[0].action.frames.startup) b2.resolveAction(w2.fighters[0]); }
  assert.equal(b2.idleTicks, 0);
});

test('cage pin: dom driving the pair into the fence sets fence dominance and unlocks the cage bonus; takedown hands off to a TakedownBout', () => {
  const w = makeWorld();
  const [a, b] = w.fighters;
  a.pos = { x: 3.4, y: 0 }; b.pos = { x: 3.9, y: 0 };
  const bout = new ClinchBout(w, a, b, P.OVER_UNDER);
  const wall = w.cage.nearestWall(bout.centre);
  const push = { move: { x: wall.normalOut.x, y: wall.normalOut.y }, guard: 'none', grapple: null };
  for (let i = 0; i < 80; i++) { bout.applyIntent(a, push); stepBout(w, bout); }
  assert.ok(a.fenceDominance && b.backAgainstCage, 'pinned');
  assert.ok(w.cage.inside(bout.centre, 0.2));
  const free = takedownProbability(a, b, w.tun, { origin: 'clinch', type: 'hip_throw_high', cage: false });
  const pinned = takedownProbability(a, b, w.tun, { origin: 'clinch', type: 'hip_throw_high', cage: true });
  assert.ok(pinned > free);
  a.cooldowns.clinch = 0; a.action = null;
  assert.ok(bout.takedown(a, 'hip_throw_high'));
  assert.equal(a.mode, Mode.TAKEDOWN); assert.equal(a.bout.kind, 'takedown');
  assert.equal(a.bout.cage, true);
});

test('sub escape from a pinned clinch is harder (-25 %)', () => {
  const trial = (pinned) => {
    let ok = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const w = makeWorld({ seed });
      const bout = clinched(w);
      bout.dom.fenceDominance = pinned;
      bout.sub.cooldowns.clinch = 0;
      if (bout.tryBreak(bout.sub)) ok++;
    }
    return ok / 600;
  };
  const free = trial(false), pin = trial(true);
  assert.ok(free - pin > 0.15, `free ${free} pinned ${pin}`);
});

test('plum knees to the head beat over-under knees; the plum sub cannot strike back', () => {
  const dmg = (position) => {
    let sum = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const w = makeWorld({ seed });
      const bout = clinched(w, position);
      const [a, b] = w.fighters;
      assert.ok(bout.strike(a, 'knee', 'head'));
      const before = b.pools.head.cur;
      bout.resolveAction(a);
      sum += before - b.pools.head.cur;
    }
    return sum / 200;
  };
  const plum = dmg(P.THAI), ou = dmg(P.OVER_UNDER);
  assert.ok(plum > ou * 1.4, `plum ${plum} vs over-under ${ou}`);
  const w = makeWorld();
  const bout = clinched(w, P.THAI);
  assert.equal(bout.strike(w.fighters[1], 'knee', 'body'), false);
  assert.ok(bout.legalActions(w.fighters[1]).every((x) => x.kind !== 'strike' && x.kind !== 'takedown'));
});

test('pummel: the sub that wins the contest becomes dominant; the dom changes position along the graph', () => {
  let swapped = false, moved = false;
  for (let seed = 1; seed < 80 && !(swapped && moved); seed++) {
    const w = makeWorld({ seed, b: { clinchcontrol: 90, movement: 90 }, a: { clinchcontrol: 20, movement: 20 } });
    const bout = clinched(w, P.OVER_UNDER, 0);                  // weak a is dom, strong b is sub
    const [a, b] = w.fighters;
    if (bout.pummel(b)) { assert.equal(bout.dom, b); assert.equal(b.groundRole, 'dom'); assert.equal(a.groundRole, 'sub'); swapped = true; }
    b.cooldowns.clinch = 0;
    const w2 = makeWorld({ seed, a: { clinchcontrol: 90, movement: 90 }, b: { clinchcontrol: 20, movement: 20 } });
    const b2 = clinched(w2, P.OVER_UNDER, 0);
    if (b2.pummel(w2.fighters[0], P.DOUBLE_UNDER)) { assert.equal(b2.position, P.DOUBLE_UNDER); moved = true; }
  }
  assert.ok(swapped && moved);
});

test('legalActions are all executable and deterministic under a fixed seed', () => {
  const run = (seed) => {
    const w = makeWorld({ seed });
    const bout = clinched(w);
    const [a] = w.fighters;
    const acts = bout.legalActions(a);
    assert.ok(acts.length > 5);
    for (let i = 0; i < 600 && !bout.finished; i++) {
      if (i % 40 === 0) {
        for (const f of w.fighters) {
          const legal = bout.legalActions(f);
          if (legal.length) bout.applyIntent(f, { move: { x: 0, y: 0 }, guard: 'none', grapple: legal[(i / 40 + f.index) % legal.length | 0] });
        }
      }
      // minimal action stepping: advance + resolve strikes
      for (const f of w.fighters) if (f.action) { f.action.tick += 1; if (f.action.tick === f.action.frames.startup) bout.resolveAction?.(f); if (f.action.tick > f.action.frames.startup + f.action.frames.active + f.action.frames.recovery) f.action = null; }
      if (a.mode !== Mode.CLINCH) break;
      stepBout(w, bout);
    }
    return JSON.stringify(w.bus.log.map((e) => [e.type, e.tick, e.outcome ?? e.event ?? e.reason ?? null]));
  };
  assert.equal(run(77), run(77));
  assert.notEqual(run(77), run(78));
});
