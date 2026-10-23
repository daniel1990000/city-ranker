import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, EventType } from '../src/sim/events.js';
import { StatsTracker } from '../src/sim/stats.js';
import { FightSim } from '../src/sim/fight-sim.js';
import { DEFAULT_FIGHTERS } from '../src/data/default-fighters.js';
import { pairing } from '../src/sim/batch.js';

test('bus: ordered delivery, typed handlers before wildcard, envelope keys cannot be shadowed by payloads', () => {
  const bus = new EventBus({ record: true });
  const seen = [];
  bus.on('*', (e) => seen.push(`*:${e.type}`));
  bus.on('strike', (e) => seen.push(`strike:${e.n}`));
  bus.context.tick = 7; bus.context.round = 2;
  bus.emit('strike', { n: 1 }); bus.emit('clinch_start', {}); bus.emit('strike', { n: 2 });
  assert.deepEqual(seen, ['strike:1', '*:strike', '*:clinch_start', 'strike:2', '*:strike']);
  const e = bus.emit('takedown', { type: 'singleleg_high', tick: 999, round: 9, move: 'x' });
  assert.equal(e.type, 'takedown'); assert.equal(e.tick, 7); assert.equal(e.round, 2); assert.equal(e.move, 'x');
  assert.equal(bus.log.length, 4);
  assert.ok(bus.log.every((x) => x.tick === 7));
});

test('bus: unsubscribing during dispatch is safe; listeners added during dispatch start with the next emit', () => {
  const bus = new EventBus();
  const calls = [];
  let off2;
  bus.on('x', () => { calls.push('a'); off2(); bus.on('x', () => calls.push('late')); });
  off2 = bus.on('x', () => calls.push('b'));
  bus.emit('x');
  assert.deepEqual(calls, ['a', 'b'], 'b still ran in this dispatch (snapshot), late did not');
  calls.length = 0;
  bus.emit('x');
  assert.deepEqual(calls, ['a', 'late'], 'b is gone; the handler added last time now runs');
});

test('EventType names are unique and cover the documented vocabulary', () => {
  const values = Object.values(EventType);
  assert.equal(new Set(values).size, values.length);
  for (const t of ['strike', 'health_event', 'knockdown', 'clinch_start', 'takedown', 'ground_position', 'submission', 'referee', 'round_start', 'stoppage', 'decision']) assert.ok(values.includes(t), t);
});

test('stats: counters per fight and per round, marks, ticksSince, snapshot', () => {
  const bus = new EventBus();
  const st = new StatsTracker(bus, ['a', 'b']);
  st.startRound(1);
  st.inc('a', 'k', 2); st.inc('a', 'k', 3, 2);
  assert.equal(st.get('a', 'k'), 5); assert.equal(st.get('a', 'k', 1), 2); assert.equal(st.get('a', 'k', 2), 3); assert.equal(st.get('b', 'k'), 0);
  st.mark('a', 'hit', 100);
  assert.equal(st.ticksSince('a', 'hit', 160), 60); assert.equal(st.ticksSince('a', 'nope', 160), Infinity);
  const snap = st.snapshot();
  assert.equal(snap.totals.a.k, 5); assert.equal(snap.rounds[2].a.k, 3);
  st.startRound(3);
  assert.equal(st.strikesReceivedThisRound('a'), 0);
  bus.context = { tick: 1, round: 3 };
  bus.emit('strike', { attacker: 'b', defender: 'a', outcome: 'hit', target: 'head', limb: 'punch', mode: 'standup', taken: 5, significant: true, tier: 'light' });
  assert.equal(st.strikesReceivedThisRound('a'), 1);
  st.startRound(4);
  assert.equal(st.strikesReceivedThisRound('a'), 0, 'reset each round');
});

test('stats reconcile over whole fights: landed + blocked + avoided = thrown; per-mode splits and per-round sums equal totals; time buckets add up', () => {
  for (let i = 0; i < 6; i++) {
    const [fa, fb] = pairing(DEFAULT_FIGHTERS, i * 5);
    const sim = new FightSim({ seed: 70 + i, rounds: 2, roundSeconds: 120, fighters: [fa, fb] });
    sim.run();
    const st = sim.world.stats;
    for (const f of sim.world.fighters) {
      const g = (k, r) => st.get(f.id, k, r);
      const thrown = g('strikes.thrown');
      assert.equal(thrown, g('strikes.landed') + g('strikes.blocked') + g('strikes.avoided'), `${f.id} thrown = landed + blocked + avoided`);
      assert.equal(thrown, g('strikes.thrown.standup') + g('strikes.thrown.clinch') + g('strikes.thrown.ground'), 'per-mode thrown');
      assert.equal(g('strikes.landed'), g('strikes.landed.head') + g('strikes.landed.body') + g('strikes.landed.leg'), 'per-target landed');
      for (const key of ['strikes.thrown', 'strikes.landed', 'time.standup', 'damage.dealt']) {
        let sum = 0; for (let r = 1; r <= 2; r++) sum += g(key, r);
        assert.ok(Math.abs(sum - g(key)) < 1e-6, `${key}: rounds ${sum} vs total ${g(key)}`);
      }
      assert.ok(g('strikes.sig.landed') <= g('strikes.landed'));
      const time = ['time.standup', 'time.clinch.dom', 'time.clinch.sub', 'time.ground.top', 'time.ground.bottom', 'time.takedown', 'time.submission.attacker', 'time.submission.defender', 'time.down'].reduce((s, k) => s + g(k), 0);
      assert.ok(Math.abs(time - sim.world.tick) <= 1, `${f.id}: time buckets ${time} vs ticks ${sim.world.tick}`);
    }
    // what one fighter lands, the other absorbs
    const [A, B] = sim.world.fighters;
    assert.ok(Math.abs(st.get(A.id, 'damage.dealt') - st.get(B.id, 'damage.taken')) <= st.get(A.id, 'damage.blocked') * 1 + st.get(B.id, 'damage.taken') + 1e-6);
    assert.equal(st.get(A.id, 'strikes.landed'), st.get(B.id, 'strikes.absorbed'));
  }
});
