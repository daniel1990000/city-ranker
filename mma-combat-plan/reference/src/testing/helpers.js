// Small helpers for unit tests, demos and the next team's own tests: build a World with crafted fighters and step a bout.

import { World } from '../sim/world.js';

/** A fighter spec from a few ratings (everything else defaults to 50). */
export function spec(id, ratings = {}, meta = {}) {
  return { id, name: id, ...meta, ratings };
}

/**
 * Two fighters, centre-octagon, recording events. `a` / `b` are ratings objects or full spec overrides ({ratings, style, human…}).
 * Pass `tunables` for partial overrides.
 */
export function makeWorld({ a = {}, b = {}, seed = 1, tunables, record = true, aMeta = {}, bMeta = {} } = {}) {
  const w = new World({ seed, tunables, record, fighters: [spec('a', a, aMeta), spec('b', b, bMeta)] });
  return w;
}

/** Advance the world clock one tick and update a bout (the FightSim does this in the real loop). */
export function stepBout(world, bout, intents = null) {
  world.tick += 1;
  if (intents) for (const f of world.fighters) if (intents[f.id]) bout.applyIntent(f, intents[f.id]);
  return bout.update();
}

/** Run until the bout finishes or `max` ticks pass. Returns the number of ticks run. */
export function runBout(world, bout, max = 2000, intents = null) {
  let n = 0;
  while (!bout.finished && n < max) { stepBout(world, bout, intents); n += 1; }
  return n;
}

export const eventsOf = (world, type) => world.bus.log.filter((e) => e.type === type);

/** Put the fighters `centreGap` metres apart (centre to centre) on the x axis, facing each other. */
export function faceOff(world, centreGap = 1.0) {
  const [a, b] = world.fighters;
  a.pos = { x: -centreGap / 2, y: 0 }; b.pos = { x: centreGap / 2, y: 0 };
  a.facing = 0; b.facing = Math.PI;
}
