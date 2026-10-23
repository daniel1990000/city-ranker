// Replays (docs/16 §4, docs/17 §7): a fight is {seed, packs, per-tick intents}; viewing = re-simulating. Intents are stored
// run-length style (only when a fighter's frame changes) and the sim state hash is checkpointed every 30 ticks so a re-run can
// prove it is bit-identical (or report the first tick where it is not).

import { compactIntent, expandIntent } from '../input/intent.js';

export class ReplayRecorder {
  constructor(sim) {
    this.sim = sim;
    this.log = []; this.checkpoints = [];
    this.last = new Map();
  }

  record(tick, id, intent) {
    const c = compactIntent(intent), key = JSON.stringify(c);
    if (this.last.get(id) === key) return;
    this.last.set(id, key);
    this.log.push({ tick, id, intent: c });
  }

  checkpoint(tick, hash) { this.checkpoints.push({ tick, hash }); }

  export() {
    const s = this.sim, o = s.opts;
    return {
      schema: 'mma.replay', version: 1, seed: o.seed ?? 1, tunables: o.tunables ?? {}, fighters: s.world.fighters.map((f) => f.spec),
      rounds: s.rounds, roundSeconds: s.roundTicks / 60, restSeconds: s.restTicks / 60,
      log: this.log, checkpoints: this.checkpoints, result: s.result ? { ...s.result, cards: undefined } : null, ticks: s.world.tick,
    };
  }
}

/** Feeds recorded intents back into a FightSim, one tick at a time. */
export class ReplayFeeder {
  constructor(data) {
    this.byId = new Map();
    for (const e of data.log) {
      if (!this.byId.has(e.id)) this.byId.set(e.id, []);
      this.byId.get(e.id).push(e);
    }
    this.idx = new Map([...this.byId.keys()].map((k) => [k, -1]));
    this.cur = new Map();
  }

  /** intents for `tick` (the tick about to be simulated) */
  at(tick) {
    const out = {};
    for (const [id, list] of this.byId) {
      let i = this.idx.get(id);
      while (i + 1 < list.length && list[i + 1].tick <= tick) i += 1;
      this.idx.set(id, i);
      out[id] = i >= 0 ? expandIntent(list[i].intent) : expandIntent({});
    }
    return out;
  }
}
