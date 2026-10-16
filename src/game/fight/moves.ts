// Frame data for every standing attack. Times are ticks at 60 Hz, distances millimetres, damage and stamina on the
// 0..10000 meter scale. docs/FIGHT-DESIGN.md explains the numbers; tests/fight-*.test.ts pin the behaviour.

import type { Archetype, MoveId, Special, Strike, Zone } from './types';

/** How a move travels: decides which evasions beat it. */
export type MoveKind = 'straight' | 'hook' | 'upper' | 'kick' | 'lowKick' | 'lunge' | 'spin';

export interface MoveData {
  id: MoveId;
  zone: Zone;
  kind: MoveKind;
  /** Ticks before the first active frame. */
  startup: number;
  active: number;
  recovery: number;
  /** Reach from centre to centre (mm) at the first active frame. */
  reach: number;
  /** Forward travel during startup (mm). */
  lunge: number;
  /** Stamina cost before the cardio factor. */
  cost: number;
  /** Base damage before power, stamina, counter and chin. */
  dmg: number;
  /** Ticks the target is stuck in a hit reaction / block reaction. */
  hitstun: number;
  blockstun: number;
  /** Share of the damage that gets through a block (per mille). 0 for unblockable. */
  chip: number;
  /** Can a high guard stop it at all? Low kicks go under it. */
  blockable: boolean;
  /** Which stat makes it faster and more accurate. */
  skill: 'striking' | 'kicking';
}

const M = (d: MoveData): MoveData => d;

export const MOVES: Record<MoveId, MoveData> = {
  jab: M({ id: 'jab', zone: 'head', kind: 'straight', startup: 6, active: 3, recovery: 10, reach: 1150, lunge: 80, cost: 220, dmg: 330, hitstun: 12, blockstun: 8, chip: 150, blockable: true, skill: 'striking' }),
  cross: M({ id: 'cross', zone: 'head', kind: 'straight', startup: 10, active: 3, recovery: 15, reach: 1200, lunge: 130, cost: 480, dmg: 760, hitstun: 18, blockstun: 11, chip: 200, blockable: true, skill: 'striking' }),
  hookL: M({ id: 'hookL', zone: 'head', kind: 'hook', startup: 11, active: 3, recovery: 16, reach: 960, lunge: 90, cost: 520, dmg: 860, hitstun: 20, blockstun: 12, chip: 220, blockable: true, skill: 'striking' }),
  hookR: M({ id: 'hookR', zone: 'head', kind: 'hook', startup: 12, active: 3, recovery: 17, reach: 960, lunge: 100, cost: 580, dmg: 960, hitstun: 21, blockstun: 12, chip: 220, blockable: true, skill: 'striking' }),
  uppercut: M({ id: 'uppercut', zone: 'head', kind: 'upper', startup: 12, active: 3, recovery: 19, reach: 820, lunge: 110, cost: 580, dmg: 1000, hitstun: 22, blockstun: 12, chip: 260, blockable: true, skill: 'striking' }),
  bodyShot: M({ id: 'bodyShot', zone: 'body', kind: 'hook', startup: 10, active: 3, recovery: 15, reach: 900, lunge: 100, cost: 460, dmg: 880, hitstun: 18, blockstun: 10, chip: 300, blockable: true, skill: 'striking' }),
  lowKick: M({ id: 'lowKick', zone: 'legs', kind: 'lowKick', startup: 12, active: 3, recovery: 17, reach: 1250, lunge: 60, cost: 560, dmg: 780, hitstun: 14, blockstun: 10, chip: 0, blockable: false, skill: 'kicking' }),
  bodyKick: M({ id: 'bodyKick', zone: 'body', kind: 'kick', startup: 15, active: 4, recovery: 21, reach: 1320, lunge: 80, cost: 860, dmg: 1250, hitstun: 22, blockstun: 14, chip: 350, blockable: true, skill: 'kicking' }),
  headKick: M({ id: 'headKick', zone: 'head', kind: 'kick', startup: 20, active: 4, recovery: 25, reach: 1360, lunge: 80, cost: 1200, dmg: 1600, hitstun: 30, blockstun: 16, chip: 300, blockable: true, skill: 'kicking' }),
  superman: M({ id: 'superman', zone: 'head', kind: 'lunge', startup: 16, active: 4, recovery: 22, reach: 1250, lunge: 520, cost: 900, dmg: 1600, hitstun: 26, blockstun: 14, chip: 300, blockable: true, skill: 'striking' }),
  flyingKnee: M({ id: 'flyingKnee', zone: 'head', kind: 'lunge', startup: 18, active: 4, recovery: 24, reach: 1050, lunge: 640, cost: 1100, dmg: 2000, hitstun: 30, blockstun: 16, chip: 350, blockable: true, skill: 'kicking' }),
  spinBackfist: M({ id: 'spinBackfist', zone: 'head', kind: 'spin', startup: 15, active: 4, recovery: 22, reach: 1150, lunge: 120, cost: 900, dmg: 1500, hitstun: 26, blockstun: 14, chip: 300, blockable: true, skill: 'striking' }),
};

export const STRIKES: readonly Strike[] = ['jab', 'cross', 'hookL', 'hookR', 'uppercut', 'bodyShot', 'lowKick', 'bodyKick', 'headKick'];
export const SPECIALS: readonly Special[] = ['superman', 'flyingKnee', 'spinBackfist'];

export const SIGNATURE_BY_ARCHETYPE: Record<Archetype, Special> = {
  brawler: 'superman',
  boxer: 'spinBackfist',
  kicker: 'flyingKnee',
  wrestler: 'superman',
  grappler: 'flyingKnee',
};

/** Is `move` a special? */
export function isSpecial(move: MoveId): move is Special {
  return move === 'superman' || move === 'flyingKnee' || move === 'spinBackfist';
}

/**
 * Does an evasion beat this move? Slips beat straight punches and lunges, and the hook from the side you slip
 * away from (slip left = duck under their right hook); uppercuts, kicks and spins catch slips. A sway back beats
 * every head shot except the lunges, which chase you.
 */
export function evades(evade: 'left' | 'right' | 'back', move: MoveId): boolean {
  const d = MOVES[move];
  if (evade === 'back') return d.zone === 'head' && d.kind !== 'lunge';
  if (d.kind === 'straight' || d.kind === 'lunge') return true;
  if (d.kind === 'hook' && d.zone === 'head') return evade === 'left' ? move === 'hookR' : move === 'hookL';
  return false;
}

// ---- combos ---------------------------------------------------------------------------------------------------

/** Ticks shaved off a strike's startup per step in a combo chain (min startup stays 4). */
export const CHAIN_SPEEDUP = 2;
/** Longest chain that still speeds up. */
export const CHAIN_MAX = 4;
/** Ticks of recovery that must pass before a landed or blocked strike can be cancelled into the next one. */
export const CANCEL_AFTER = 4;
/** Ticks after a strike ends during which a new strike still counts as the next link of the chain. */
export const CHAIN_GRACE = 10;

/** Evasion timing (ticks). */
export const EVADE = {
  slipLength: 16,
  swayLength: 18,
  /** First and last action tick (inclusive) the evasion protects. */
  from: 2,
  to: 10,
  /** Ticks at the start of the protection that count as a perfect evade. */
  perfectTo: 6,
  counterWindow: 42,
  cost: 260,
  swayRetreat: 160,
} as const;
