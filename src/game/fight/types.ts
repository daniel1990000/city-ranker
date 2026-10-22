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
  /**
   * The fighter's signature special (thrown when `special` is pressed with a full meter). Optional: defaults by
   * archetype (SIGNATURE_BY_ARCHETYPE in moves.ts).
   */
  signature?: Special;
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
  /** Optional showboat (edge-triggered): a risky second of taunting that fills the special meter. */
  taunt?: boolean;
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
  /** Doubled over from a body shot: can't attack or block for a moment. */
  | 'hurtBody'
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

// =================================================================================================================
// Simulation contract, grown by the fight builder. Everything below is the shape of the deterministic fight in
// src/game/fight/sim.ts. Units: time in ticks (60 per second), positions in millimetres, every meter 0..10000.
// All numbers in the state are integers, so the state is plain JSON and the same on every device.
// =================================================================================================================

/** The standing attacks: the nine strikes and the three specials. */
export type MoveId = Strike | Special;

/** What a hit lands on. Each move hits exactly one zone (see MOVES in moves.ts). */
export type Zone = 'head' | 'body' | 'legs';

/** Meter maximum (stamina, damage per zone, hurt, special, guard, submission progress). */
export const METER_MAX = 10000;

export interface FightRules {
  /** 3, or 5 for title fights. */
  rounds: number;
  /** Ticks per round (default 90 s = 5400). */
  roundTicks: number;
  /** Ticks between rounds: fighters go back to their corners; the partial recovery applies at the next bell. */
  breakTicks: number;
  /** Ticks before the first bell (walkout pose, touch gloves). Inputs are ignored. */
  introTicks: number;
  /** Title fight: only changes the default round count (5). */
  title: boolean;
}

/** What createFight takes. `rules` may be partial; missing fields come from DEFAULT_RULES. */
export interface FightSetup {
  seed: number;
  a: FighterSpec;
  b: FighterSpec;
  rules?: Partial<FightRules>;
}

/** `intro` before the first bell, `fight` while a round runs, `break` between rounds, `ended` after the result. */
export type FightPhase = 'intro' | 'fight' | 'break' | 'ended';

export type GroundPos = 'guard' | 'mount';

export type SubKind = 'armbar' | 'choke';

/** What a ground scramble decides: top passes guard to mount, bottom escapes mount to guard, or stands up. */
export type ScramblePurpose = 'advance' | 'escape' | 'standUp';

/**
 * What the HUD should ask this fighter to do right now (null = nothing):
 * - `sprawl`: the opponent is shooting a takedown; press shoot to sprawl before the window closes.
 * - `scramble`: a ground scramble; input `dir` before the other fighter does (both fighters see the same arrow).
 * - `mash`: a submission tug-of-war; tap fast.
 * - `getUp`: knocked down; tap to get up sooner.
 */
export type PromptKind = 'sprawl' | 'scramble' | 'mash' | 'getUp';

export interface FighterPrompt {
  kind: PromptKind;
  /** The direction to input (scramble only). */
  dir: GroundDir | null;
  ticksLeft: number;
  window: number;
  /** True for the fighter who started it (the shooter, the scrambler, the submitter). */
  attacking: boolean;
}

/** Per fighter, per round: what the judges look at (and the post-fight stats screen shows). */
export interface RoundStats {
  /** Strikes thrown and landed (blocked ones count as thrown, not landed). Ground-and-pound included. */
  thrown: number;
  landed: number;
  /** Landed strikes other than the jab (the "significant" shots). */
  power: number;
  /** Strikes this fighter blocked or evaded. */
  defended: number;
  /** Damage dealt, per zone. */
  headDmg: number;
  bodyDmg: number;
  legDmg: number;
  knockdowns: number;
  takedowns: number;
  tdAttempts: number;
  /** Ticks spent on top on the ground. */
  controlTicks: number;
  subAttempts: number;
}

export interface FighterState {
  /** Centre of the fighter in mm (one axis; the wall stops it at |x| = 3600). On the ground both share the anchor. */
  x: number;
  /** +1 faces +x. Fighter 0 always faces +1, fighter 1 always -1 (they never swap sides). */
  facing: 1 | -1;
  /** The clip the renderer plays (clip name = action id). */
  action: ActionId;
  /** Ticks since `action` started (0 on its first tick). */
  actionTick: number;
  /** Total ticks of the action, 0 when it loops until something else happens (idle, walk, block, ground holds). */
  actionLength: number;
  /** Attacks: the action tick of the first active frame (the renderer scales the clip so its impact lands here); -1 otherwise. */
  actionImpact: number;

  // ---- the attack in progress (internal timing; the renderer only needs the action fields above)
  /** Standing attack in progress (also set during its recovery), else null. */
  move: MoveId | null;
  /** Startup/active/recovery ticks of this instance after speed, fatigue and combo adjustments. */
  moveStartup: number;
  moveActive: number;
  moveRecovery: number;
  /** 0 = not resolved yet, 1 = hit, 2 = blocked, 3 = evaded, 4 = whiffed. */
  moveResult: number;
  /** The attack carries a counter bonus (thrown inside a perfect-evade counter window). */
  moveCounter: boolean;
  /** Position in a combo chain (0 = opener). */
  moveChain: number;
  /** Lunge still to travel (mm) during this attack's startup. */
  moveLunge: number;

  // ---- input buffer (a strike, special or evade pressed while busy is kept for a few ticks)
  bufMove: MoveId | null;
  bufEvade: Evade | null;
  bufTicks: number;

  // ---- meters (0..10000)
  stamina: number;
  /** Stamina cannot regenerate above this (body damage and the rounds lower it). */
  staminaCap: number;
  head: number;
  body: number;
  legs: number;
  /** Short-term wobble: head hits fill it, it drains over time; full = stunned. */
  hurt: number;
  /** Ticks of stun left (wobbly, slow, weak guard). */
  stunTicks: number;
  /** Guard integrity: blocked heavy shots chip it; at 0 the guard breaks. */
  guard: number;
  /** Special meter: full (10000) = the signature special is ready. */
  special: number;

  /** Ticks left of the counter window after a perfect evade (the next strike is a counter). */
  counterTicks: number;
  /** Ticks left of a broken guard (cannot block). */
  guardBrokenTicks: number;
  /** Knocked down: ticks left before getting up by themselves (tapping shortens it). */
  downTicks: number;
  /** Strikes taken while stunned or downed without answering; the referee stops the fight at the limit. */
  unanswered: number;
  /** Knockdowns suffered in this fight. */
  knockdowns: number;
  /** Knockdowns from leg kicks (the second one is a TKO). */
  legKnockdowns: number;
  /** Stamina hit zero recently (gassed): shown on the HUD. */
  gassed: boolean;
  /** Ground: ticks before this fighter may start another scramble or submission. */
  groundCooldown: number;
  /** Clean hits taken in the current string (a gap of COMBO_GAP ticks ends it) and ticks left in the string. */
  comboHits: number;
  comboTicks: number;
  /** Shelled up after a long string: hits on the guard are blocked while this runs and the fighter isn't busy. */
  coverTicks: number;
  /** Pressed sprawl while the opponent's shot was still coming in (counts as the earliest possible sprawl). */
  sprawlReady: boolean;
  /** Already went "hurt" in this zone this round (each happens once a round): bit 1 body, bit 2 legs. */
  hurtFlags: number;
  /** The last strike started and how many times in a row it has been repeated (predictable = slower, weaker). */
  lastMove: MoveId | null;
  repeats: number;

  /** What the HUD should prompt this fighter to do, or null. */
  prompt: FighterPrompt | null;
}

/** A ground scramble in progress (see ground.ts). */
export interface ScrambleState {
  initiator: Side;
  purpose: ScramblePurpose;
  dir: GroundDir;
  tick: number;
  window: number;
  /** Tick (within the scramble, after the stat handicap) when each side answered correctly; -1 = not yet. */
  arrive: [number, number];
  /** A wrong direction locks that side out of this scramble (no mashing every direction). */
  locked: [boolean, boolean];
}

/** A submission tug-of-war in progress. progress 10000 = tap out, 0 = escape. */
export interface SubState {
  atk: Side;
  kind: SubKind;
  progress: number;
  tick: number;
  /** Highest progress reached: only a hold that got deep counts as an attempt for the judges. */
  peak: number;
}

export interface GroundState {
  pos: GroundPos;
  top: Side;
  /** The shared anchor (mm). Both fighters' x equal it while on the ground. */
  x: number;
  /** World direction of the anchor's +x: the top fighter faces it. */
  dir: 1 | -1;
  /** Ticks on the ground in this exchange. */
  tick: number;
  /** Ticks without progress (landed ground-and-pound, scramble, submission); the referee stands them up at the limit. */
  idle: number;
  scramble: ScrambleState | null;
  sub: SubState | null;
}

/** A takedown shot that made contact and waits for the sprawl window to close. */
export interface TakedownState {
  atk: Side;
  /** Ticks since contact. */
  tick: number;
  window: number;
  /** Tick (since the shot started) the defender pressed sprawl, or -1. */
  sprawlAt: number;
  /** The shot caught a kick: no sprawl possible. */
  caughtKick: boolean;
}

export type FinishMethod = 'KO' | 'TKO' | 'SUB' | 'DEC';

export type DecisionKind = 'unanimous' | 'split' | 'majority' | 'draw';

/** Why the referee stopped it (TKO): strikes standing, ground-and-pound, leg kicks or body shots. */
/** Why the referee stopped it ('forfeit': the fighter retired, e.g. the player quit from the pause menu). */
export type StoppageKind = 'strikes' | 'ground' | 'legs' | 'body' | 'forfeit';

/** One judge's card: 10-point-must scores per round [fighter 0, fighter 1] and the totals. */
export interface JudgeCard {
  rounds: [number, number][];
  total: [number, number];
}

export interface FightResult {
  /** null = draw. */
  winner: Side | null;
  method: FinishMethod;
  /** KO/TKO: the finishing blow ('pound' = ground-and-pound), when there was one. */
  by: MoveId | 'pound' | null;
  stoppage: StoppageKind | null;
  sub: SubKind | null;
  decision: DecisionKind | null;
  /** Round of the finish (1-based) and ticks into that round. */
  round: number;
  roundTick: number;
  totalTicks: number;
  /** The three judges' cards (filled for every result, so a stats screen can show them even after a finish). */
  cards: JudgeCard[];
}

export interface FightState {
  /** State format version (bump when the shape changes; replays carry it). */
  v: number;
  tick: number;
  phase: FightPhase;
  phaseTick: number;
  /** 1-based round number. */
  round: number;
  /** Ticks left in the current round. */
  clock: number;
  /** Seeded integer RNG (mulberry32 state). */
  rng: number;
  fighters: [FighterState, FighterState];
  ground: GroundState | null;
  takedown: TakedownState | null;
  /** Per round: [fighter 0, fighter 1] stats; index 0 = round 1. */
  stats: [RoundStats, RoundStats][];
  /** Each judge's leaning (seeded): per mille weights for striking and grappling, and a tie-break nudge. */
  judges: { striking: number; grappling: number; nudge: number }[];
  result: FightResult | null;
}

/** Strength class of a landed hit, for camera shake, sound and hit reactions. */
export type HitStrength = 'light' | 'medium' | 'heavy';

/**
 * What happened this tick, for the renderer, audio and HUD (drainEvents). `side` is the fighter the event is
 * about: the attacker for strikes, the one who went down for knockdowns, the defender for sprawls and evades.
 */
export type FightEvent =
  | { type: 'roundStart'; tick: number; round: number }
  | { type: 'roundEnd'; tick: number; round: number }
  | { type: 'strike'; tick: number; side: Side; move: MoveId | 'pound'; chain: number }
  | {
      type: 'hit';
      tick: number;
      side: Side;
      move: MoveId | 'pound';
      zone: Zone;
      /** Damage dealt (after the block, if blocked). */
      dmg: number;
      strength: HitStrength;
      /** A counter: thrown from a perfect-evade window, or caught the opponent mid-attack or moving into it. */
      counter: boolean;
      blocked: boolean;
      /** Position in the combo chain (0 = opener). */
      chain: number;
    }
  | { type: 'miss'; tick: number; side: Side; move: MoveId }
  | { type: 'evade'; tick: number; side: Side; move: MoveId; perfect: boolean }
  | { type: 'counter'; tick: number; side: Side; move: MoveId }
  | { type: 'guardBreak'; tick: number; side: Side }
  | { type: 'stun'; tick: number; side: Side }
  | { type: 'knockdown'; tick: number; side: Side; by: MoveId | 'pound' | 'legs'; severity: number }
  | { type: 'getUp'; tick: number; side: Side }
  | { type: 'pounce'; tick: number; side: Side }
  | { type: 'special'; tick: number; side: Side; move: Special }
  | { type: 'specialReady'; tick: number; side: Side }
  | { type: 'gassed'; tick: number; side: Side }
  /** A health event: `side` is hurt to the body (doubled over) or the legs (limping). */
  | { type: 'hurt'; tick: number; side: Side; zone: 'body' | 'legs' }
  /** `side` came through a stun (rocked) without going down. */
  | { type: 'recover'; tick: number; side: Side }
  /** `side` shelled up under a long string of punches. */
  | { type: 'cover'; tick: number; side: Side }
  /** `side` blocked at the last moment: no damage through, and a counter window. */
  | { type: 'parry'; tick: number; side: Side }
  /** `side` keeps throwing the same strike: it is getting slower and weaker (the HUD says "Mix it up"). */
  | { type: 'predictable'; tick: number; side: Side }
  /** `side` checked a leg kick: the kicker's shin took it. */
  | { type: 'check'; tick: number; side: Side }
  | { type: 'taunt'; tick: number; side: Side }
  | { type: 'shoot'; tick: number; side: Side }
  | { type: 'sprawl'; tick: number; side: Side; success: boolean }
  | { type: 'takedown'; tick: number; side: Side; caughtKick: boolean }
  | { type: 'scramble'; tick: number; side: Side; purpose: ScramblePurpose; dir: GroundDir }
  | { type: 'scrambleEnd'; tick: number; side: Side; purpose: ScramblePurpose; success: boolean }
  | { type: 'position'; tick: number; pos: GroundPos; top: Side }
  | { type: 'standUp'; tick: number; reason: 'ref' | 'scramble' | 'subEscape' | 'round' }
  | { type: 'subStart'; tick: number; side: Side; sub: SubKind }
  | { type: 'subEscape'; tick: number; side: Side; sub: SubKind }
  | { type: 'tapOut'; tick: number; side: Side; sub: SubKind }
  | { type: 'fightEnd'; tick: number; result: FightResult };

export type FightEventType = FightEvent['type'];

// ---- what a player can see (controllers read this, never the raw state) ---------------------------------------

/** One fighter as seen on screen and on the HUD. */
export interface FighterView {
  x: number;
  action: ActionId;
  actionTick: number;
  actionLength: number;
  actionImpact: number;
  stamina: number;
  staminaCap: number;
  head: number;
  body: number;
  legs: number;
  hurt: number;
  stunned: boolean;
  guard: number;
  guardBroken: boolean;
  special: number;
  gassed: boolean;
  downed: boolean;
  /** In a counter window after a perfect evade (the HUD flashes it). */
  counter: boolean;
  prompt: FighterPrompt | null;
}

export interface FightView {
  tick: number;
  phase: FightPhase;
  round: number;
  rounds: number;
  clock: number;
  /** Which fighter "me" is. */
  side: Side;
  me: FighterView;
  opp: FighterView;
  mySpec: FighterSpec;
  oppSpec: FighterSpec;
  /** Centre-to-centre distance (mm). */
  dist: number;
  /** Room behind each fighter before the cage wall (mm). */
  myRoom: number;
  oppRoom: number;
  ground: {
    pos: GroundPos;
    meTop: boolean;
    scramble: { purpose: ScramblePurpose; dir: GroundDir; mine: boolean; ticksLeft: number } | null;
    sub: { kind: SubKind; mine: boolean; progress: number } | null;
  } | null;
  takedown: { mine: boolean; ticksLeft: number } | null;
  result: FightResult | null;
}

/** Anything that drives a fighter: touch, AI, replay, later the network. */
export interface Controller {
  next(view: FightView, side: Side): FightInput;
}

/** A recorded fight: replaying `inputs` from `seed` gives the same hashState at every tick. */
export interface Replay {
  /** Replay format version (REPLAY_VERSION). */
  version: number;
  /** Simulation state version it was recorded with (FightState.v). */
  sim: number;
  seed: number;
  specs: [FighterSpec, FighterSpec];
  rules: FightRules;
  /** Ticks recorded. */
  ticks: number;
  /** Per fighter: run-length encoded per-tick input codes (see replay.ts). */
  inputs: [string, string];
  /** hashState after the last tick (a quick check that a replay still matches the simulation). */
  hash: number;
}
