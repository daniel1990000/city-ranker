// Re-simulate a recorded fight from its seed + intent log and check the state hashes (docs/16 §4, docs/17 §7).
// Re-running from tick 0 is cheap (a full 3-round fight simulates in well under a second), so `upTo` gives "scrub to any tick".

import { FightSim } from './fight-sim.js';
import { ReplayFeeder } from './replay.js';

/**
 * @returns {{sim: FightSim, ok: boolean, mismatch: null|{tick,expected,got}, checked: number}}
 *   ok = every checkpoint up to the point reached matched, and (for a full replay) the final result is identical.
 */
export function playReplay(data, { upTo = Infinity, stopOnMismatch = true } = {}) {
  const controllers = Object.fromEntries(data.fighters.map((f) => [f.id, false]));
  const sim = new FightSim({ seed: data.seed, fighters: data.fighters, tunables: data.tunables, rounds: data.rounds, roundSeconds: data.roundSeconds, restSeconds: data.restSeconds, controllers });
  const feeder = new ReplayFeeder(data);
  const expected = new Map(data.checkpoints.map((c) => [c.tick, c.hash]));
  let mismatch = null, checked = 0, seen = 0;
  while (!sim.over && sim.tick < upTo) {
    sim.step(feeder.at(sim.tick + 1));
    while (seen < sim.hashes.length) {
      const h = sim.hashes[seen++];
      if (!expected.has(h.tick)) continue;
      checked += 1;
      if (expected.get(h.tick) !== h.hash && !mismatch) mismatch = { tick: h.tick, expected: expected.get(h.tick), got: h.hash };
    }
    if (mismatch && stopOnMismatch) break;
  }
  let ok = !mismatch;
  if (ok && upTo === Infinity && data.result) ok = sim.over && sim.result.result === data.result.result && sim.result.winner === data.result.winner && sim.world.tick === data.ticks;
  return { sim, ok, mismatch, checked };
}
