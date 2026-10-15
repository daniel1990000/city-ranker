// Shared fight types: the contract between the simulation, the controllers (touch, AI, replay, later network),
// the renderer and the game data. See docs/ARCHITECTURE.md (contract 1 and 3). Grow these types, don't rename.

export const TICK_HZ = 60;

export type Side = 0 | 1;

export type DivisionId = 'mLight' | 'mWelter' | 'mMiddle' | 'mHeavy' | 'wStraw' | 'wBantam';

export type Archetype = 'brawler' | 'boxer' | 'kicker' | 'wrestler' | 'grappler';

export type Rarity = 'common' | 'rare' | 'epic' | 'legend';

/** Every stat is an integer 1..100. */
export interface FighterStats {
  power: number;
  speed: number;
  chin: number;
  cardio: number;
  striking: number;
  kicking: number;
  wrestling: number;
  grappling: number;
  submissions: number;
  defense: number;
}

/** Hints for the look generator (src/render/fighter): the roster never needs hand-made art. */
export interface LookHints {
  sex: 'm' | 'f';
  build?: 'lean' | 'athletic' | 'muscular' | 'heavy';
  skin?: 'light' | 'tan' | 'brown' | 'dark';
  hair?: string;
  beard?: boolean;
  tattoos?: boolean;
}

/** The final, fully-upgraded fighter the simulation sees. Plain JSON. */
export interface FighterSpec {
  id: string;
  name: string;
  nickname: string;
  division: DivisionId;
  archetype: Archetype;
  rarity: Rarity;
  stats: FighterStats;
  lookSeed: number;
  lookHints: LookHints;
}

export type Strike =
  | 'jab'
  | 'cross'
  | 'hookL'
  | 'hookR'
  | 'uppercut'
  | 'bodyShot'
  | 'lowKick'
  | 'bodyKick'
  | 'headKick';

export type Special = 'superman' | 'flyingKnee' | 'spinBackfist';

export type Evade = 'left' | 'right' | 'back';

export type GroundDir = 'up' | 'down' | 'left' | 'right';

/** One fighter's input for one tick. Edge-triggered fields (strike, special, shoot, tap) mean "this tick". */
export interface FightInput {
  strike: Strike | null;
  special: boolean;
  block: boolean;
  evade: Evade | null;
  /** +1 toward the opponent, -1 away, 0 still. */
  move: -1 | 0 | 1;
  shoot: boolean;
  ground: GroundDir | null;
  tap: boolean;
}

export const NO_INPUT: Readonly<FightInput> = Object.freeze({
  strike: null,
  special: false,
  block: false,
  evade: null,
  move: 0,
  shoot: false,
  ground: null,
  tap: false,
});

/** Clip name = action id (docs/ARCHITECTURE.md, "ActionId list"). */
export type StandingAction =
  | 'idle'
  | 'walkFwd'
  | 'walkBack'
  | Strike
  | Special
  | 'block'
  | 'blockHit'
  | 'slipL'
  | 'slipR'
  | 'swayBack'
  | 'hitHeadL'
  | 'hitHeadR'
  | 'hitHeadHeavy'
  | 'hitBody'
  | 'hitLeg'
  | 'stunned'
  | 'knockdown'
  | 'downed'
  | 'getUp'
  | 'shoot'
  | 'sprawl'
  | 'takedownTop'
  | 'takedownBottom'
  | 'taunt'
  | 'victory'
  | 'defeat'
  | 'walkout';

export type GroundAction =
  | 'gndGuardTop'
  | 'gndGuardBottom'
  | 'gndMountTop'
  | 'gndMountBottom'
  | 'gndPound'
  | 'gndPoundHit'
  | 'gndBlock'
  | 'gndAdvance'
  | 'gndEscape'
  | 'gndStandUp'
  | 'subChokeAtk'
  | 'subChokeDef'
  | 'subArmbarAtk'
  | 'subArmbarDef'
  | 'tapOut';

export type ActionId = StandingAction | GroundAction;
