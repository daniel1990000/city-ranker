import test from 'node:test';
import assert from 'node:assert/strict';
import { TakedownBout, takedownProbability, canStartShot, startShot, chooseShotType, moveFamily, landingFor, LANDING, applySlam } from '../src/combat/takedown.js';
import { GroundPosition as G, Mode, TakedownDenial as D, CLINCH_TAKEDOWNS, STANDUP_TAKEDOWNS } from '../src/core/taxonomy.js';
import { Rng } from '../src/core/rng.js';
import { mergeTunables } from '../src/core/tunables.js';
import { makeWorld, faceOff, stepBout, runBout, eventsOf } from '../src/testing/helpers.js';

const shoot = (w, o = {}) => { faceOff(w, 1.2); const [a, b] = w.fighters; return startShot(w, a, b, o); };

test('p_land: monotone in rating delta, rises with cage and stamina advantage, falls with sprawl input, bounded [0.05, 0.95]', () => {
  const w = makeWorld();
  const [a, b] = w.fighters;
  const tun = mergeTunables();
  const p = (o = {}, ta = 50, td = 50) => { a.ratings.takedown = ta; b.ratings.takedowndefense = td; return takedownProbability(a, b, tun, o); };
  let prev = -1;
  for (let ta = 0; ta <= 100; ta += 10) { const x = p({}, ta); assert.ok(x >= prev); prev = x; }
  prev = 2;
  for (let td = 0; td <= 100; td += 10) { const x = p({}, 50, td); assert.ok(x <= prev); prev = x; }
  assert.ok(p({ cage: true }) > p({}));
  assert.ok(p({ sprawling: true }) < p({}));
  assert.ok(p({ size: 'minor' }) > p({ size: 'major' }));
  a.stamina = 100; b.stamina = 20; const rested = p({});
  a.stamina = 20; b.stamina = 100; const tired = p({});
  assert.ok(rested > tired);
  a.stamina = b.stamina = 100;
  for (const ta of [0, 100]) for (const td of [0, 100]) for (const cage of [false, true]) {
    const x = p({ cage, sprawling: !cage }, ta, td);
    assert.ok(x >= 0.05 - 1e-12 && x <= 0.95 + 1e-12);
  }
  // clinch variant: throws depend on clinchthrows; the sub is worse off; whizzer hurts
  const c = (o) => takedownProbability(a, b, tun, { origin: 'clinch', type: 'hip_throw_high', ...o });
  a.ratings.clinchthrows = 90; const hi = c({}); a.ratings.clinchthrows = 10; const lo = c({});
  assert.ok(hi > lo);
  assert.ok(c({ role: 'sub' }) < c({ role: 'dom' }));
  assert.ok(c({ whizzer: true }) < c({}));
});

test('shot legality: range, stamina, cooldown, mode', () => {
  const w = makeWorld();
  const [a, b] = w.fighters;
  faceOff(w, 3.0);
  assert.equal(canStartShot(w, a, b).reason, 'range');
  faceOff(w, 1.2);
  assert.ok(canStartShot(w, a, b).ok);
  a.stamina = 3; assert.equal(canStartShot(w, a, b).reason, 'stamina'); a.stamina = 100;
  a.cooldowns.takedown = 5; assert.equal(canStartShot(w, a, b).reason, 'cooldown'); a.cooldowns.takedown = 0;
  b.mode = Mode.CLINCH; assert.equal(canStartShot(w, a, b).reason, 'mode'); b.mode = Mode.STANDUP;
  assert.equal(startShot(w, a, b, { dir: 'bwd', size: 'major' }).bout.type, STANDUP_TAKEDOWNS.bwd.major);
  assert.equal(chooseShotType({ style: 'freestyle_wrestler' }, 'fwd', 'major'), 'doubleleg_high');
  assert.equal(chooseShotType({ style: 'boxer' }, 'fwd', 'minor'), 'singleleg_low');
});

test('Phase I: a strike that lands on the shooter denies the shot (countered_*) and staggers on a heavy hit', () => {
  for (const [limb, tags, kind, expect] of [['punch', ['jab'], 'punch', D.COUNTER_PUNCH], ['kick', ['legkick'], 'kick', D.COUNTER_KICK], ['kick', ['knee'], 'knee', D.COUNTER_KNEE]]) {
    const w = makeWorld();
    const r = shoot(w);
    const [a, b] = w.fighters;
    const bout = r.bout;
    for (let i = 0; i < 5; i++) stepBout(w, bout);
    assert.equal(bout.phase, 1); assert.ok(bout.committed);
    assert.ok(bout.onStruck(b, { limb, tags, kind }, 'heavy'));
    assert.equal(bout.result, 'denied'); assert.equal(bout.denial, expect);
    assert.equal(a.mode, Mode.STANDUP); assert.equal(b.mode, Mode.STANDUP); assert.equal(a.bout, null);
    assert.equal(a.status.event, 'wobbled_shot');
    assert.equal(eventsOf(w, 'takedown').at(-1).denial, expect);
  }
  // not by the shooter's own hits; not after Phase I
  const w = makeWorld(); const r = shoot(w);
  assert.equal(r.bout.onStruck(w.fighters[0], { limb: 'punch', tags: [] }, 'light'), false);
});

test('a retreating defender makes the shot miss; the shooter eats a recovery penalty', () => {
  const w = makeWorld();
  const r = shoot(w);
  const [a, b] = w.fighters;
  const bout = r.bout;
  while (!bout.finished) { b.pos = { x: b.pos.x + 0.06, y: 0 }; stepBout(w, bout); }   // faster than a real retreat (~0.018 m/tick) to test the rule
  assert.equal(bout.result, 'missed'); assert.equal(bout.denial, D.MISSED);
  assert.equal(a.mode, Mode.STANDUP);
  assert.ok(a.action && a.action.frames.recovery === w.tun.takedown.recoveryMiss, 'punish window');
});

test('denied by sprawl: attacker ends in `sprawl` with the defender on top; against the fence it becomes a cage clinch', () => {
  const never = { takedown: { base: 0, pMin: 0, pMax: 0 } };
  const w = makeWorld({ tunables: never });
  const r = shoot(w);
  runBout(w, r.bout);
  const [a, b] = w.fighters;
  assert.equal(r.bout.denial, D.SPRAWL);
  assert.equal(a.mode, Mode.GROUND); assert.equal(a.bout.kind, 'ground');
  assert.equal(a.bout.position, G.SPRAWL); assert.equal(a.bout.top, b); assert.equal(a.bout.bottom, a);

  const w2 = makeWorld({ tunables: never });
  const [x, y] = w2.fighters;
  const n = w2.cage.normals[0];                                            // defender 0.30 m from wall 0, attacker 1.2 m further in
  y.pos = { x: n.x * (w2.cage.apothem - 0.30), y: n.y * (w2.cage.apothem - 0.30) };
  x.pos = { x: y.pos.x - n.x * 1.2, y: y.pos.y - n.y * 1.2 };
  const r2 = startShot(w2, x, y, {});
  runBout(w2, r2.bout);
  assert.equal(r2.bout.denial, D.SPRAWL_CAGE);
  assert.equal(x.bout.kind, 'clinch'); assert.equal(x.bout.dom, x); assert.ok(y.backAgainstCage && x.fenceDominance);
});

test('landing: attacker on top at the table position (major); minor is a scramble that either fighter can win', () => {
  const always = { takedown: { base: 1, pMin: 1, pMax: 1 } };
  const w = makeWorld({ tunables: always });
  const r = shoot(w, { size: 'major' });
  runBout(w, r.bout);
  const [a, b] = w.fighters;
  assert.equal(r.bout.result, 'success');
  assert.equal(a.bout.top, a); assert.equal(a.bout.position, landingFor('singleleg_high', 'major'));
  assert.equal(eventsOf(w, 'takedown').at(-1).result, 'success');

  const tops = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const x = makeWorld({ seed, tunables: always });
    const rr = shoot(x, { size: 'minor' });
    runBout(x, rr.bout);
    assert.equal(rr.bout.result, 'success');
    assert.equal(x.fighters[0].bout.position, LANDING.leg.minor);
    tops.add(x.fighters[0].bout.top.id);
  }
  assert.equal(tops.size, 2, 'both fighters win some scrambles');
  for (const fam of Object.values(LANDING)) for (const pos of Object.values(fam)) assert.ok(Object.values(G).includes(pos));
});

test('move families cover the whole clinch table; slams only for throws and suplexes', () => {
  for (const pos of Object.values(CLINCH_TAKEDOWNS)) for (const moves of Object.values(pos)) for (const m of moves) assert.ok(LANDING[moveFamily(m)], m);
  const w = makeWorld();
  const [a, b] = w.fighters;
  const before = b.pools.body.cur;
  const r = applySlam(w, a, b, 'suplex_high');
  assert.ok(r.taken >= b.pools.body.max * 0.02 - 1e-9 && r.taken <= b.pools.body.max * 0.05 + 1e-9);
  assert.ok(b.pools.body.cur < before);
});

test('invariant: attempted == landed + denied + missed (mixed outcomes over 300 fights)', () => {
  const tot = { attempted: 0, landed: 0, stuffed: 0, missed: 0 };
  for (let seed = 1; seed <= 300; seed++) {
    const w = makeWorld({ seed, a: { takedown: 30 + (seed % 7) * 10 }, b: { takedowndefense: 40 + (seed % 5) * 10 } });
    const r = shoot(w, { dir: seed % 2 ? 'fwd' : 'bwd', size: seed % 3 ? 'major' : 'minor' });
    const [, b] = w.fighters;
    const mode = seed % 3;
    for (let i = 0; i < 400 && !r.bout.finished; i++) {
      if (mode === 0 && i < 14) b.pos = { x: b.pos.x + 0.06, y: 0 };                           // retreat → miss
      if (mode === 1 && i === 6) r.bout.onStruck(b, { limb: 'punch', tags: [] }, 'light');   // counter
      stepBout(w, r.bout);
    }
    assert.ok(r.bout.finished);
    const A = w.fighters[0].id;
    tot.attempted += w.stats.get(A, 'takedowns.attempted'); tot.landed += w.stats.get(A, 'takedowns.landed');
    tot.stuffed += w.stats.get(A, 'takedowns.stuffed'); tot.missed += w.stats.get(A, 'takedowns.missed');
  }
  assert.equal(tot.attempted, 300);
  assert.equal(tot.attempted, tot.landed + tot.stuffed + tot.missed);
  assert.ok(tot.landed > 20 && tot.stuffed > 20 && tot.missed > 20, JSON.stringify(tot));
});

test('auto resolver: observed landing rate tracks takedownProbability', () => {
  for (const [ta, td] of [[80, 30], [30, 80]]) {
    let ok = 0, sum = 0;
    const N = 700;
    for (let seed = 1; seed <= N; seed++) {
      const w = makeWorld({ seed, a: { takedown: ta }, b: { takedowndefense: td } });
      const bout = new TakedownBout(w, w.fighters[0], w.fighters[1], { type: 'hip_throw_high', origin: 'clinch', role: 'dom' });
      faceOff(w, 0.6);
      runBout(w, bout);
      sum += bout.p; if (bout.result === 'success') ok++;
    }
    assert.ok(Math.abs(ok / N - sum / N) < 0.05, `${ta}v${td}: observed ${ok / N} expected ${sum / N}`);
  }
});

// A noisy "human" locks the meter when the needle reaches the centre of the zone, plus Gaussian timing error.
function gaussian(rng) { return Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next()); }
function humanAttackerWins(seed, defRating, sigma = 0.2) {
  const w = makeWorld({ seed, a: { takedown: 50 }, b: { takedowndefense: defRating }, aMeta: { human: true }, tunables: { takedown: { resolver: 'meter' } } });
  faceOff(w, 0.6);
  const [a, b] = w.fighters;
  const bout = new TakedownBout(w, a, b, { type: 'hip_throw_high', origin: 'clinch', role: 'dom' });
  const m = bout.meter, noise = gaussian(new Rng(seed * 7919 + 13)) * sigma;
  let pressed = false;
  for (let i = 0; i < 400 && !bout.finished; i++) {
    const press = !pressed && m.running && m.delay <= 0 && m.posDom >= m.centre - noise;
    if (press) pressed = true;
    stepBout(w, bout, { a: { prompt: { end: press } } });
  }
  assert.ok(bout.finished);
  return bout.result === 'success';
}

test('meter resolver: a better defender lowers the human attacker\'s success rate (800 duels each)', () => {
  const rate = (def) => { let ok = 0; for (let s = 1; s <= 800; s++) if (humanAttackerWins(s, def)) ok++; return ok / 800; };
  const weak = rate(10), strong = rate(90);
  assert.ok(weak - strong > 0.08, `weak ${weak} strong ${strong}`);
});

test('meter resolver: with no human involved the sim falls back to the rating roll', () => {
  const w = makeWorld({ tunables: { takedown: { resolver: 'meter' } } });
  faceOff(w, 0.6);
  const bout = new TakedownBout(w, w.fighters[0], w.fighters[1], { type: 'hip_throw_high', origin: 'clinch', role: 'dom' });
  assert.equal(bout.useMeter, false);
  runBout(w, bout);
  assert.ok(bout.p > 0);
});

test('a stuffed clinch throw returns the pair to the same clinch; abort keeps the invariant', () => {
  const w = makeWorld({ tunables: { takedown: { pMin: 0, pMax: 0 } } });
  faceOff(w, 0.6);
  const [a, b] = w.fighters;
  const bout = new TakedownBout(w, a, b, { type: 'inside_trip', origin: 'clinch', role: 'dom', position: 'single_collar' });
  runBout(w, bout);
  assert.equal(bout.result, 'denied');
  assert.equal(a.mode, Mode.CLINCH); assert.equal(a.bout.position, 'single_collar'); assert.equal(a.bout.dom, a);

  const w2 = makeWorld();
  const r = shoot(w2);
  r.bout.end();
  assert.equal(w2.stats.get('a', 'takedowns.attempted'), 1);
  assert.equal(w2.stats.get('a', 'takedowns.stuffed'), 1);
  assert.equal(w2.fighters[0].mode, Mode.STANDUP);
});
