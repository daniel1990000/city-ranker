// Public entry point of the fight simulation.

export * from './types';
export { createFight, stepFight, snapshot, restore, hashState, drainEvents, viewFor, signatureOf, DEFAULT_RULES, SIM_VERSION } from './sim';
export type { Fight } from './sim';
export { AIController, humanLikeBot } from './ai';
export type { AIOptions } from './ai';
export { ReplayRecorder, ReplayController, runReplay, encodeInput, decodeInput, REPLAY_VERSION } from './replay';
export { MOVES, STRIKES, SPECIALS, SIGNATURE_BY_ARCHETYPE } from './moves';
export { GROUND } from './ground';

import { type Fight, createFight, stepFight, viewFor } from './sim';
import type { Controller, FighterSpec, FightInput, FightRules, FightResult } from './types';

/** Run a whole fight headless between two controllers (tests, balance, the auto-resolve of a skipped fight). */
export function runFight(
  seed: number,
  a: FighterSpec,
  b: FighterSpec,
  ca: Controller,
  cb: Controller,
  rules?: Partial<FightRules>,
  onTick?: (f: Fight, inputs: [FightInput, FightInput]) => void,
): { fight: Fight; result: FightResult } {
  const f = createFight({ seed, a, b, rules });
  const limit = (f.rules.introTicks + (f.rules.roundTicks + f.rules.breakTicks) * f.rules.rounds) + 600;
  for (let t = 0; t < limit && !f.state.result; t++) {
    const inputs: [FightInput, FightInput] = [ca.next(viewFor(f, 0), 0), cb.next(viewFor(f, 1), 1)];
    onTick?.(f, inputs);
    stepFight(f, inputs);
    f.events.length = 0;
  }
  if (!f.state.result) throw new Error('fight did not end');
  return { fight: f, result: f.state.result };
}
