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
