import test from 'node:test';
import assert from 'node:assert/strict';
import { FightSim } from '../src/sim/fight-sim.js';
import { playReplay } from '../src/sim/replayer.js';
import { ReplayFeeder } from '../src/sim/replay.js';
import { emptyIntent } from '../src/input/intent.js';
import { DEFAULT_FIGHTERS } from '../src/data/default-fighters.js';

const record = (seed, o = {}) => {
  const sim = new FightSim({ seed, rounds: 2, roundSeconds: 60, fighters: [DEFAULT_FIGHTERS[seed % 8], DEFAULT_FIGHTERS[(seed + 3) % 8]], replay: true, ...o });
  sim.run();
  return { sim, data: sim.recorder.export() };
};

test('record → replay reproduces the fight exactly: same hashes at every checkpoint, same result, same length', () => {
  for (const seed of [1, 2, 3, 4]) {
    const { sim, data } = record(seed);
    const back = JSON.parse(JSON.stringify(data));                 // the replay is plain JSON
    const r = playReplay(back);
    assert.ok(r.ok, `seed ${seed}: ${JSON.stringify(r.mismatch)}`);
    assert.equal(r.mismatch, null);
    assert.equal(r.checked, data.checkpoints.length);
    assert.equal(r.sim.world.tick, sim.world.tick);
    assert.equal(r.sim.world.stateHash(), sim.world.stateHash());
    assert.deepEqual({ ...r.sim.result, cards: undefined }, { ...sim.result, cards: undefined });
  }
});

test('scrubbing: replaying up to tick N lands on the original state at N', () => {
  const { sim, data } = record(7);
  const target = data.checkpoints[Math.floor(data.checkpoints.length / 2)];
  const r = playReplay(data, { upTo: target.tick });
  assert.ok(r.ok);
  assert.equal(r.sim.world.tick, target.tick);
  assert.equal(r.sim.world.stateHash(), target.hash);
  assert.ok(sim.over && !r.sim.over);
});

test('tampering with the log is detected at (or soon after) the changed tick', () => {
  const { data } = record(5);
  const strikes = data.log.filter((e) => e.intent.strike);
  assert.ok(strikes.length > 3);
  const victim = strikes[Math.floor(strikes.length / 2)];
  const bad = JSON.parse(JSON.stringify(data));
  const e = bad.log.find((x) => x.tick === victim.tick && x.id === victim.id);
  delete e.intent.strike;
  const r = playReplay(bad);
  assert.equal(r.ok, false);
  assert.ok(r.mismatch && r.mismatch.tick >= victim.tick, `${JSON.stringify(r.mismatch)} vs ${victim.tick}`);
  assert.ok(r.mismatch.tick - victim.tick < 600, 'diverges soon after');
  const wrongSeed = playReplay({ ...data, seed: data.seed + 1 });
  assert.equal(wrongSeed.ok, false);
});

test('the log is compact: run-length intents, far fewer entries than fighter-ticks', () => {
  const { sim, data } = record(2);
  assert.ok(data.log.length < sim.world.tick * 2 * 0.35, `${data.log.length} entries for ${sim.world.tick * 2} fighter-ticks`);
  assert.equal(data.checkpoints.length, Math.floor(sim.world.tick / 30));
  assert.ok(JSON.stringify(data.log).length < 60 * sim.world.tick);
  assert.equal(data.schema, 'mma.replay');
});

test('feeder: holds each fighter\'s last frame until the next change, starts idle', () => {
  const f = new ReplayFeeder({ log: [{ tick: 3, id: 'a', intent: { guard: 'high' } }, { tick: 6, id: 'a', intent: {} }, { tick: 4, id: 'b', intent: { parry: true } }].sort((x, y) => x.tick - y.tick) });
  assert.equal(f.at(1).a.guard, 'none');
  assert.equal(f.at(3).a.guard, 'high'); assert.equal(f.at(5).a.guard, 'high');
  assert.equal(f.at(6).a.guard, 'none');
  assert.equal(f.at(5).b.parry, true);
  assert.equal(f.at(10).b.parry, true, 'a held frame persists until replaced');
});

test('external (human / netplay) intents are recorded and replayed like AI intents', () => {
  const mk = () => new FightSim({ seed: 9, rounds: 1, roundSeconds: 30, fighters: [DEFAULT_FIGHTERS[0], DEFAULT_FIGHTERS[1]], controllers: { f_striker: false }, replay: true });
  const sim = mk();
  const script = (t) => ({ ...emptyIntent(), move: { x: t % 90 < 45 ? 1 : -1, y: 0.2 }, guard: t % 40 < 10 ? 'high' : 'none', strike: t % 50 === 0 ? { moveId: 'lead_jab_head', limb: 'punch', side: 'lead', slot: 'basic', target: 'head' } : null });
  while (!sim.over) sim.step({ f_striker: script(sim.world.tick + 1) });
  const data = sim.recorder.export();
  const r = playReplay(data);
  assert.ok(r.ok, JSON.stringify(r.mismatch));
  assert.equal(r.sim.world.stateHash(), sim.world.stateHash());
});

test('a long multi-round fight replays in well under a second per simulated minute', () => {
  const sim = new FightSim({ seed: 12, rounds: 3, fighters: [DEFAULT_FIGHTERS[1], DEFAULT_FIGHTERS[6]], replay: true });
  sim.run();
  const data = sim.recorder.export();
  const t0 = performance.now();
  const r = playReplay(data);
  const ms = performance.now() - t0;
  assert.ok(r.ok);
  const minutes = sim.world.tick / 3600;
  assert.ok(ms / Math.max(minutes, 0.1) < 1000, `${(ms / minutes).toFixed(0)} ms per simulated minute`);
});
