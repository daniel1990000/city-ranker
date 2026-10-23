// Move definitions + context-matched selection (docs/04, docs/17 §6). A move is pure data.

import { Limb, Side, Slot, Target, Contact, Power } from '../core/taxonomy.js';

/**
 * Move schema (see docs/18):
 * { id, label, mode:'standup'|'clinch'|'ground', limb:'punch'|'kick', side:'lead'|'back', slot, target, type, kind, contact, power,
 *   frames:{startup,active,recovery}, reach, minReach?, wedgeDeg, advance, damage:{base,range}, stamina, eventMult?, critChance?,
 *   blockHeight:'high'|'low', tags:[], cancel:{out:[[a,b]], into:[tags]} }
 */
export function validateMove(m) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(`${m.id ?? '?'}: ${msg}`); };
  need(typeof m.id === 'string' && m.id.length > 0, 'id required');
  need(Object.values(Limb).includes(m.limb), 'bad limb');
  need(Object.values(Side).includes(m.side), 'bad side');
  need(Object.values(Slot).includes(m.slot), 'bad slot');
  need(Object.values(Target).includes(m.target), 'bad target');
  need(Object.values(Power).includes(m.power), 'bad power');
  need(Object.values(Contact).includes(m.contact), 'bad contact');
  const f = m.frames ?? {};
  need(f.startup >= 1 && f.active >= 1 && f.recovery >= 1, 'frames must be >= 1');
  need(m.reach > 0, 'reach > 0');
  need(m.damage && m.damage.base > 0, 'damage.base > 0');
  need(['high', 'low'].includes(m.blockHeight), 'blockHeight high|low');
  const total = f.startup + f.active + f.recovery;
  for (const w of m.cancel?.out ?? []) need(w[0] >= 0 && w[1] <= total && w[0] < w[1], `cancel window ${w} outside move`);
  return errs;
}

export class MoveBook {
  constructor(moves) {
    this.moves = new Map();
    this.byKey = new Map();
    for (const m of moves) {
      const errs = validateMove(m);
      if (errs.length) throw new Error(`invalid move: ${errs.join('; ')}`);
      this.moves.set(m.id, m);
      const key = `${m.mode ?? 'standup'}|${m.limb}|${m.side}|${m.slot}|${m.target}`;
      if (!this.byKey.has(key)) this.byKey.set(key, []);
      this.byKey.get(key).push(m);
    }
  }
  get(id) { return this.moves.get(id) ?? null; }
  all() { return [...this.moves.values()]; }

  /**
   * Context-matched selection: exact (mode,limb,side,slot,target) → relax slot → relax target → relax side.
   * `power` (light|medium|heavy) filters when possible. `allowed` = fighter loadout (set of ids) or null.
   */
  select({ mode = 'standup', limb, side, slot = 'basic', target, power, allowed = null, rng = null }) {
    const tryKeys = [
      [slot, target, side], ['basic', target, side], [slot, target, side === 'lead' ? 'back' : 'lead'], ['basic', target, side === 'lead' ? 'back' : 'lead'],
    ];
    for (const [s, t, sd] of tryKeys) {
      let list = this.byKey.get(`${mode}|${limb}|${sd}|${s}|${t}`);
      if (!list) continue;
      if (allowed) list = list.filter((m) => allowed.has(m.id));
      if (list.length === 0) continue;
      const byPower = power ? list.filter((m) => m.power === power) : list;
      const pool = byPower.length ? byPower : list;
      return rng ? pool[rng.int(pool.length)] : pool[0];
    }
    return null;
  }

  /** moves of a mode usable from a given tag (combo chaining) */
  chainable(fromMove, mode = 'standup') {
    const into = new Set(fromMove.cancel?.into ?? []);
    return this.all().filter((m) => (m.mode ?? 'standup') === mode && (m.tags ?? []).some((t) => into.has(t)));
  }
}

/** Is `tick` (ticks since the action started) inside a cancel-out window of `move`? */
export function inCancelWindow(move, tick) {
  return (move.cancel?.out ?? []).some(([a, b]) => tick >= a && tick < b);
}
