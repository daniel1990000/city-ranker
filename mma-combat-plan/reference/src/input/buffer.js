// Input buffer (docs/14 §2): a 30-tick ring of timestamped inputs. Strikes pressed during recovery are remembered for up to
// 6 ticks and fire at the first cancel window; defensive presses blocked by a lock are remembered for 4 ticks.

export const BUFFER_TICKS = 30;
export const STRIKE_BUFFER_TICKS = 6;
export const DEFENSE_BUFFER_TICKS = 4;

export class InputBuffer {
  constructor(size = BUFFER_TICKS) { this.size = size; this.items = []; }

  push(tick, kind, payload = true) {
    this.items.push({ tick, kind, payload });
    this.#trim(tick);
  }

  #trim(tick) {
    while (this.items.length && tick - this.items[0].tick >= this.size) this.items.shift();
  }

  /** newest entry of `kind` no older than `maxAge` ticks, or null (does not remove it) */
  latest(kind, tick, maxAge = this.size) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (tick - it.tick > maxAge) return null;
      if (it.kind === kind) return it;
    }
    return null;
  }

  /** newest live entry of `kind`, removing it and every older entry of that kind (duplicates of one press) */
  consume(kind, tick, maxAge = this.size) {
    const hit = this.latest(kind, tick, maxAge);
    if (!hit) return null;
    this.items = this.items.filter((it) => it.kind !== kind || it.tick > hit.tick);
    return hit.payload;
  }

  drop(kind) { this.items = this.items.filter((it) => it.kind !== kind); }
  clear() { this.items.length = 0; }
}
