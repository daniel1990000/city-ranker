// World: the shared container every system reads and writes (docs/17 §2). Holds tunables, named RNG streams, the event
// bus, stats, the octagon, the move book and the two fighters. Systems take `world` instead of a long argument list, which
// also keeps each paired-state module testable in isolation (build a World, put fighters in a state, call the module).

import { RngStreams } from '../core/rng.js';
import { mergeTunables } from '../core/tunables.js';
import { hashNumbers, vDist } from '../core/math.js';
import { EventBus, EventType } from './events.js';
import { StatsTracker } from './stats.js';
import { Octagon } from './cage.js';
import { MoveBook } from '../combat/moves.js';
import { Fighter, placeFighters } from '../combat/fighter.js';
import { applyHealthEvent } from '../combat/health-events.js';
import { buildDefaultMoves } from '../data/default-moves.js';
import { DEFAULT_FIGHTERS } from '../data/default-fighters.js';

export class World {
  /**
   * @param {object} o  seed, tunables (partial override), fighters (two specs; defaults to the first two bundled fighters),
   *   moves (defaults to the bundled move book), record (keep the full event log), cageAcrossFlats (metres)
   */
  constructor({ seed = 1, tunables = {}, fighters = [DEFAULT_FIGHTERS[0], DEFAULT_FIGHTERS[1]], moves, record = false, cageAcrossFlats } = {}) {
    if (fighters.length !== 2) throw new Error('World needs exactly two fighters');
    this.seed = seed >>> 0;
    this.tun = mergeTunables(tunables);
    this.streams = new RngStreams(this.seed);
    this.bus = new EventBus({ record });
    this.cage = new Octagon(cageAcrossFlats);
    this.moveBook = new MoveBook(moves ?? buildDefaultMoves());
    this.fighters = fighters.map((spec, i) => new Fighter(spec, this.tun, i));
    if (this.fighters[0].id === this.fighters[1].id) throw new Error('fighter ids must differ');
    this.stats = new StatsTracker(this.bus, this.fighters.map((f) => f.id));
    this.tick = 0;
    this.round = 1;
    this.stats.startRound(1);
    placeFighters(this.fighters[0], this.fighters[1]);
  }

  rng(name) { return this.streams.get(name); }
  opp(f) { return this.fighters[1 - f.index]; }
  byId(id) { return this.fighters.find((f) => f.id === id) ?? null; }

  /** edge-to-edge distance between two fighters (what `clinch.range` / `takedown.shotRange` are measured in) */
  gap(a, b) { return Math.max(0, vDist(a.pos, b.pos) - a.radius - b.radius); }

  emit(type, payload = {}) {
    this.bus.context.tick = this.tick;
    this.bus.context.round = this.round;
    return this.bus.emit(type, payload);
  }

  /** Apply a health event's lasting effects and announce it. Mode changes (knockdown → floor) are the sim's job. */
  healthEvent(def, att, event, region) {
    applyHealthEvent(def, event, region, this.tun);
    const source = att ? att.id : null;
    this.emit(EventType.HEALTH_EVENT, { fighter: def.id, event, region, source });
    if (event === 'knockdown') this.emit(EventType.KNOCKDOWN, { fighter: def.id, by: source, region });
  }

  /** Referee "reset to middle": both fighters stand centre-octagon facing each other, `gap` metres apart (edge to edge). */
  resetToMiddle(gap = 1.2) {
    const [a, b] = this.fighters;
    const d = a.radius + b.radius + gap;
    a.pos = { x: -d / 2, y: 0 }; b.pos = { x: d / 2, y: 0 };
    a.facing = 0; b.facing = Math.PI;
    for (const f of this.fighters) f.vel = { x: 0, y: 0 };
  }

  /** FNV hash of everything that must match between two runs of the same fight (docs/17 §7). */
  stateHash() {
    const nums = [this.tick, this.round];
    for (const f of this.fighters) nums.push(...f.hashNumbers());
    for (const s of Object.values(this.streams.snapshot())) nums.push(s);
    return hashNumbers(nums);
  }
}

export { EventType };
