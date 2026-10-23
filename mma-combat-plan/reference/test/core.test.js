import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng, RngStreams, lcgStep, mul32, healthEventDice, hashString } from '../src/core/rng.js';
import { locoSpeedByAngle, LeashFilter, greaterThanWithHysteresis, rangeToRatio, approachFilter, pingPong, wrapPi } from '../src/core/math.js';
import { Statechart } from '../src/core/statechart.js';
import { mergeTunables, DEFAULT_TUNABLES } from '../src/core/tunables.js';

test('Rng is deterministic and streams are independent', () => {
  const a = new Rng(42), b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const s1 = new RngStreams(7), s2 = new RngStreams(7);
  s1.get('hit').next(); s1.get('hit').next();
  assert.equal(s1.get('ai').next(), s2.get('ai').next(), 'drawing from "hit" must not perturb "ai"');
  const r = new Rng(1);
  for (let i = 0; i < 10000; i++) { const v = r.next(); assert.ok(v >= 0 && v < 1); }
});

test('Rng snapshot/restore round-trips', () => {
  const r = new Rng(9); r.next(); r.next();
  const snap = r.snapshot(); const x = r.next(); r.restore(snap);
  assert.equal(r.next(), x);
});

test('mul32 matches BigInt 64-bit product', () => {
  const rnd = new Rng(5);
  for (let i = 0; i < 2000; i++) {
    const a = (rnd.next() * 4294967296) >>> 0, b = (rnd.next() * 4294967296) >>> 0;
    const { hi, lo } = mul32(a, b);
    const big = BigInt(a) * BigInt(b);
    assert.equal(BigInt(hi) * (1n << 32n) + BigInt(lo), big);
  }
});

test('lcgStep reproduces the reference recurrence (bits 16..47 of s*A+C)', () => {
  const s = 123456789;
  const big = BigInt(s) * 1103515245n + 12345n;
  const expectedState = Number(big & 0xffffffffn);
  const expectedOut = Number((big >> 16n) & 0xffffffffn);
  const r = lcgStep(s);
  assert.equal(r.state, expectedState);
  assert.ok(Math.abs(r.value - expectedOut / 4294967296) < 1e-15);
});

test('healthEventDice is a pure function of (seed, event) and decorrelates events', () => {
  const a = healthEventDice(1234, 2), b = healthEventDice(1234, 2), c = healthEventDice(1234, 3);
  assert.deepEqual(a, b);
  assert.notEqual(a.r1, c.r1);
  for (let seed = -50; seed < 50; seed++) { const d = healthEventDice(seed * 7919, 4); assert.ok(d.r1 >= 0 && d.r1 < 1 && d.r2 >= 0 && d.r2 < 1); }
});

test('locoSpeedByAngle: knots, midpoints, continuity at ±π', () => {
  const D = [1.0, 0.9, 0.8, 0.7, 0.5, 0.6, 0.75, 0.95];
  const Q = Math.PI / 4;
  const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} vs ${y}`);
  near(locoSpeedByAngle(0, D), D[0]);
  near(locoSpeedByAngle(Q, D), D[1]);
  near(locoSpeedByAngle(2 * Q, D), D[2]);
  near(locoSpeedByAngle(3 * Q, D), D[3]);
  near(locoSpeedByAngle(Math.PI, D), D[4]);
  near(locoSpeedByAngle(-Math.PI, D), D[4]);
  near(locoSpeedByAngle(-3 * Q, D), D[5]);
  near(locoSpeedByAngle(-2 * Q, D), D[6]);
  near(locoSpeedByAngle(-Q, D), D[7]);
  near(locoSpeedByAngle(Q / 2, D), (D[0] + D[1]) / 2);
  near(locoSpeedByAngle(-Q / 2, D), (D[7] + D[0]) / 2);
  near(locoSpeedByAngle(Math.PI - 1e-9, D), locoSpeedByAngle(-Math.PI + 1e-9, D));
});

test('LeashFilter never trails farther than radius, resets, snaps for radius<=0', () => {
  const f = new LeashFilter();
  let out = f.update({ x: 0, y: 0 }, 1);
  assert.deepEqual(out, { x: 0, y: 0 });
  out = f.update({ x: 0.5, y: 0 }, 1);
  assert.deepEqual(out, { x: 0, y: 0 }, 'inside radius → unchanged');
  out = f.update({ x: 3, y: 0 }, 1);
  assert.ok(Math.abs(out.x - 2) < 1e-12 && out.y === 0, 'dragged to exactly radius behind input');
  for (let i = 0; i < 200; i++) {
    const inp = { x: Math.sin(i) * 5, y: Math.cos(i * 1.3) * 5 };
    const o = f.update(inp, 0.8);
    assert.ok(Math.hypot(inp.x - o.x, inp.y - o.y) <= 0.8 + 1e-9);
  }
  assert.deepEqual(f.update({ x: 9, y: 9 }, 0, false), { x: 9, y: 9 });
  assert.deepEqual(f.update({ x: 1, y: 1 }, 5, true), { x: 1, y: 1 });
});

test('hysteresis, rangeToRatio, pingPong, approachFilter', () => {
  assert.equal(greaterThanWithHysteresis(0.55, 0.6, 0.4, false), false);
  assert.equal(greaterThanWithHysteresis(0.55, 0.6, 0.4, true), true);
  assert.equal(rangeToRatio(5, 0, 10), 0.5);
  assert.equal(rangeToRatio(5, 3, 3), 0);
  assert.equal(rangeToRatio(-5, 0, 10), 0);
  assert.equal(pingPong(0.25), 0.25);
  assert.ok(Math.abs(pingPong(1.25) - 0.75) < 1e-12);
  assert.ok(Math.abs(pingPong(2.25) - 0.25) < 1e-12);
  const r = approachFilter(0, 10, 2, 600, 0.01, 1 / 60);
  assert.ok(r.position > 0 && r.position < 10);
  assert.equal(approachFilter(0, 10, 2, 600, 0.01, 0).position, 0);
  assert.ok(Math.abs(wrapPi(3 * Math.PI) - -Math.PI) < 1e-9 || Math.abs(wrapPi(3 * Math.PI) - Math.PI) < 1e-9);
});

test('Statechart: hierarchy, guards, entry/exit order, raise, parallel', () => {
  const log = [];
  const sc = new Statechart({
    id: 'm', initial: 'pre',
    states: {
      pre: { entry: [() => log.push('enter pre')], exit: [() => log.push('exit pre')], on: { go: 'fight' } },
      fight: {
        initial: 'live', entry: [() => log.push('enter fight')], exit: [() => log.push('exit fight')],
        states: {
          live: { entry: [() => log.push('enter live')], exit: [() => log.push('exit live')], on: { stop: 'fight.stopped', bell: { target: 'post', guard: (c) => c.ok, actions: [() => log.push('bell action')] } } },
          stopped: { entry: [(c, p, s) => { log.push('enter stopped'); s.raise('resume'); }], on: { resume: 'fight.live' } },
        },
        on: { ko: 'post' },
      },
      post: { entry: [() => log.push('enter post')] },
    },
  }, { ok: false });
  sc.start();
  assert.deepEqual(sc.value, ['pre']);
  sc.send('go');
  assert.deepEqual(sc.value, ['fight.live']);
  assert.ok(sc.matches('fight') && sc.matches('fight.live'));
  sc.send('bell');
  assert.deepEqual(sc.value, ['fight.live'], 'guard false → no transition');
  sc.send('stop');
  assert.deepEqual(sc.value, ['fight.live'], 'raised resume returns to live');
  assert.ok(log.includes('enter stopped'));
  sc.context.ok = true; sc.send('bell');
  assert.deepEqual(sc.value, ['post']);
  assert.deepEqual(log.slice(0, 6), ['enter pre', 'exit pre', 'enter fight', 'enter live', 'exit live', 'enter stopped']);
  assert.ok(log.indexOf('exit live') < log.lastIndexOf('bell action') && log.lastIndexOf('bell action') < log.lastIndexOf('enter post'));
  // bubbling: ko is declared on the parent state
  const sc2 = new Statechart({ id: 'x', initial: 'a', states: { a: { initial: 'b', states: { b: {} }, on: { ko: 'z' } }, z: {} } }).start();
  sc2.send('ko'); assert.deepEqual(sc2.value, ['z']);
  const par = new Statechart({ id: 'p', type: 'parallel', states: { l: { initial: 'l1', states: { l1: { on: { t: 'l.l2' } }, l2: {} } }, r: { initial: 'r1', states: { r1: { on: { t: 'r.r2' } }, r2: {} } } } }).start();
  assert.deepEqual(par.value, ['l.l1', 'r.r1']);
  par.send('t'); assert.deepEqual(par.value, ['l.l2', 'r.r2']);
});

test('tunables merge is deep and non-mutating', () => {
  const t = mergeTunables({ defense: { strongBase: 0.8 } });
  assert.equal(t.defense.strongBase, 0.8);
  assert.equal(t.defense.weakBase, DEFAULT_TUNABLES.defense.weakBase);
  assert.notEqual(DEFAULT_TUNABLES.defense.strongBase, 0.8);
  assert.equal(hashString('abc'), hashString('abc'));
});
