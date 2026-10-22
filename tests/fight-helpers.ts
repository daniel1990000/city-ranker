// Test fighters for the fight simulation tests and the balance simulation.
import type { Archetype, FighterSpec, FighterStats } from '../src/game/fight/types';

const BASE: Record<Archetype, FighterStats> = {
  brawler: { power: 72, speed: 52, chin: 66, cardio: 52, striking: 62, kicking: 40, wrestling: 42, grappling: 40, submissions: 34, defense: 45 },
  boxer: { power: 58, speed: 70, chin: 55, cardio: 60, striking: 74, kicking: 36, wrestling: 40, grappling: 38, submissions: 32, defense: 62 },
  kicker: { power: 58, speed: 64, chin: 52, cardio: 60, striking: 52, kicking: 76, wrestling: 40, grappling: 42, submissions: 38, defense: 56 },
  wrestler: { power: 56, speed: 56, chin: 60, cardio: 70, striking: 48, kicking: 38, wrestling: 78, grappling: 62, submissions: 46, defense: 52 },
  grappler: { power: 50, speed: 56, chin: 58, cardio: 66, striking: 46, kicking: 42, wrestling: 66, grappling: 76, submissions: 78, defense: 50 },
};

/** A fighter of `archetype` with every stat shifted by `bonus` (clamped 1..100). */
export function testFighter(archetype: Archetype, bonus = 0, id = archetype): FighterSpec {
  const stats = { ...BASE[archetype] };
  for (const k of Object.keys(stats) as (keyof FighterStats)[]) stats[k] = Math.max(1, Math.min(100, stats[k] + bonus));
  return { id, name: `Test ${archetype}`, nickname: '', division: 'mLight', archetype, rarity: 'common', stats, lookSeed: 1, lookHints: { sex: 'm' } };
}

export const ARCHETYPES: Archetype[] = ['brawler', 'boxer', 'kicker', 'wrestler', 'grappler'];

import { GROUND } from '../src/game/fight/ground';
import type { Controller, FightInput, FightView, MoveId, Side } from '../src/game/fight/types';
import { NO_INPUT } from '../src/game/fight/types';

/**
 * A button-masher with a person's reflexes: walks in and throws power punches nonstop, never defends standing;
 * reads ground arrows in half a second, taps 6.7 times a second in a submission, sprawls late.
 */
export class Masher implements Controller {
  private n = 0;
  next(v: FightView, side: Side): FightInput {
    void side;
    const out: FightInput = { ...NO_INPUT };
    if (v.phase !== 'fight') return out;
    if (v.me.action === 'downed') {
      out.tap = v.tick % 8 === 0;
      return out;
    }
    const g = v.ground;
    if (g) {
      if (g.sub) {
        out.tap = v.tick % 9 === 0;
        return out;
      }
      if (g.scramble) {
        if (GROUND.scrambleWindow - g.scramble.ticksLeft === 30) out.ground = g.scramble.dir;
        return out;
      }
      if (g.meTop) out.tap = v.tick % 12 === 0;
      else if (v.tick % 60 === 0) out.ground = 'up';
      return out;
    }
    if (v.takedown && !v.takedown.mine) {
      if (v.takedown.ticksLeft < 8) out.shoot = true;
      return out;
    }
    if (v.dist > 1050) {
      out.move = 1;
      return out;
    }
    const seq: MoveId[] = ['cross', 'hookL', 'hookR', 'uppercut', 'jab', 'cross'];
    out.strike = seq[this.n++ % seq.length] as FightInput['strike'];
    return out;
  }
}

/** A one-trick bot: walks in and throws only `strike`, otherwise plays like the Masher (ground, sprawls, getting up). */
export class SpamBot implements Controller {
  private readonly human = new Masher();
  constructor(
    private readonly strike: FightInput['strike'],
    private readonly range = 1050,
  ) {}
  next(v: FightView, side: Side): FightInput {
    if (v.phase !== 'fight' || v.ground || v.takedown || v.me.action === 'downed') return this.human.next(v, side);
    const out: FightInput = { ...NO_INPUT };
    if (v.dist > this.range) out.move = 1;
    else out.strike = this.strike;
    return out;
  }
}
