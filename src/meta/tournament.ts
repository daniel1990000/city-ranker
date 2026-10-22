// The weekly tournament: an 8-fighter single-elimination bracket (quarter-final, semi-final, final) that is the same
// for everyone in a week (seeded by the week, meta/weekly.ts), in a division chosen by the week. The player fights
// with their own fighter for that division, or a loaner at a fixed level when they have none, so every free player
// can enter. One free entry a day plus one more for a rewarded video. Each win scores points (integer, from the fight
// result only: the win, the finish, how quick it was and how little damage was taken; later rounds count for more),
// the run's total goes to a Play Games leaderboard, and the week's best total unlocks prize tiers, each claimable
// once a week. Pure functions of the save and the times passed in; saved in the 'tournament' progress slot.

import type { Archetype, DivisionId, FighterSpec, FightResult, FightRules, Rarity } from '../game/fight/types';
import { division, DIVISION_IDS } from './divisions';
import { toFightSpec } from './fighters';
import { generateName } from './names';
import type { PackId } from './packs';
import { baseStats, overall, rosterOf } from './roster';
import { bool, int, obj, oneOf, str } from './sanitize';
import { registerProgressSlot, type SaveData } from './save';
import { defineTunables } from './tuning';
import { claimWeeklyTier, ensureWeek, weekSeed } from './weekly';

export const ROUNDS = 3;
export const ROUND_NAMES = ['Quarter-final', 'Semi-final', 'Final'] as const;
/** Free entries a day, and extra entries a day for a rewarded video ("Watch ad: extra entry"). */
export const FREE_ENTRIES = 1;
export const AD_ENTRIES = 1;
/** The loaner's level (stars 1, no training) for players without a fighter in the week's division. */
export const LOANER_LEVEL = 12;

export type TourMethod = FightResult['method'];

export interface TourFight {
  /** W win, L loss, D draw */
  r: 'W' | 'L' | 'D';
  m: TourMethod;
  /** this fight's points */
  sc: number;
}

export interface TourRun {
  /** fights won so far: 0..3 (3 = tournament champion) */
  round: number;
  /** points so far (the fights' points plus the champion bonus) */
  score: number;
  /** the fighter who entered: an owned fighter, or the week's loaner */
  fighter: string;
  loaner: boolean;
  /** knocked out of the bracket (a loss or a draw) */
  out: boolean;
  /** a fight was started and has no result yet: if the app closes, it counts as a loss */
  live: boolean;
  fights: TourFight[];
}

export interface TournamentState {
  v: 1;
  /** the week (meta/weekly.ts id) this state belongs to; another week starts clean */
  week: string;
  /** reward-clock day that `used` and `extra` count for */
  day: number;
  /** entries started that day */
  used: number;
  /** extra entries from rewarded videos that day */
  extra: number;
  run: TourRun | null;
  /** most fights won in one run this week (for the menus) */
  bestRound: number;
}

declare module './save' {
  interface ProgressSlots {
    tournament: TournamentState;
  }
}

export function freshTournament(): TournamentState {
  return { v: 1, week: '', day: -1, used: 0, extra: 0, run: null, bestRound: 0 };
}

const METHODS: readonly TourMethod[] = ['KO', 'TKO', 'SUB', 'DEC'];

/** Any stored value -> a valid tournament state (idempotent; a missing slot in an old save starts fresh). */
export function sanitizeTournament(raw: unknown): TournamentState {
  const o = obj(raw);
  const out = freshTournament();
  const week = str(o.week, '', 10);
  out.week = /^\d{4}-W\d{2}$/.test(week) ? week : '';
  out.day = int(o.day, -1, -1, 1e7);
  out.used = int(o.used, 0, 0, FREE_ENTRIES + AD_ENTRIES);
  out.extra = int(o.extra, 0, 0, AD_ENTRIES);
  out.bestRound = int(o.bestRound, 0, 0, ROUNDS);
  const r = obj(o.run);
  if (out.week && typeof r.fighter === 'string' && r.fighter.length > 0) {
    const fights = (Array.isArray(r.fights) ? r.fights : []).slice(0, ROUNDS).map(x => {
      const f = obj(x);
      return { r: oneOf(f.r, ['W', 'L', 'D'] as const, 'L'), m: oneOf(f.m, METHODS, 'DEC'), sc: int(f.sc, 0, 0, 100000) };
    });
    const round = int(r.round, 0, 0, ROUNDS);
    out.run = {
      round,
      score: int(r.score, 0, 0, 1_000_000),
      fighter: str(r.fighter, '', 64),
      loaner: bool(r.loaner, false),
      out: round < ROUNDS && bool(r.out, false),
      live: round < ROUNDS && !bool(r.out, false) && bool(r.live, false),
      fights,
    };
  }
  return out;
}

registerProgressSlot('tournament', { fresh: freshTournament, sanitize: sanitizeTournament });

// ---- the bracket ---------------------------------------------------------------------------------------------------

function mix(...n: number[]): number {
  let h = 2166136261;
  for (const x of n) h = Math.imul(h ^ (x | 0), 16777619) >>> 0;
  return h;
}

/** The week's division. */
export function weekDivision(week: string): DivisionId {
  return DIVISION_IDS[weekSeed(week) % DIVISION_IDS.length];
}

const ARCHS: Archetype[] = ['brawler', 'boxer', 'kicker', 'wrestler', 'grappler'];
/**
 * The field by bracket slot (slot 0 is the player): rarity and stat offset. The player meets slot 1 in the
 * quarter-final, the winner of 2 v 3 in the semi-final and the winner of the other half in the final, so the
 * opponents get stronger round by round.
 */
const FIELD: readonly { rarity: Rarity; off: number }[] = [
  { rarity: 'rare', off: 0 },
  { rarity: 'rare', off: 3 },
  { rarity: 'epic', off: -2 },
  { rarity: 'epic', off: 0 },
  { rarity: 'rare', off: 6 },
  { rarity: 'epic', off: 3 },
  { rarity: 'legend', off: -3 },
];
/** AI difficulty by round. */
export const ROUND_DIFFICULTY = [480, 640, 800] as const;
/** Quarter- and semi-finals: 3 rounds of 75 s; the final: 5 rounds of 60 s. */
export function roundRules(round: number): Partial<FightRules> {
  return round >= ROUNDS - 1 ? { rounds: 5, roundTicks: 60 * 60, title: true } : { rounds: 3, roundTicks: 75 * 60 };
}

export interface Bracket {
  week: string;
  seed: number;
  div: DivisionId;
  /** the 7 opponents, by slot 1..7 (index 0 = slot 1) */
  field: FighterSpec[];
  /** the other matches' winners, decided by the week's seed: quarter-finals [2v3, 4v5, 6v7], then the other semi */
  winners: { qf: [number, number, number]; sf: number };
}

/** The week's bracket: the same on every phone. */
export function bracket(week: string): Bracket {
  const seed = weekSeed(week);
  const div = weekDivision(week);
  const sex = division(div).sex;
  const field = FIELD.map((f, i) => {
    const s0 = mix(seed, i + 1, 31);
    const arch = ARCHS[s0 % ARCHS.length];
    const stats = baseStats(arch, f.rarity, div, s0);
    for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] = Math.max(1, Math.min(99, stats[k] + f.off));
    const n = generateName(s0, sex);
    return {
      id: `wt-${week}-${i + 1}`,
      name: n.name,
      nickname: n.nickname,
      division: div,
      archetype: arch,
      rarity: f.rarity,
      stats,
      lookSeed: s0 % 100000,
      lookHints: { sex, beard: s0 % 3 === 0, tattoos: s0 % 4 === 1 },
    } satisfies FighterSpec;
  });
  // the other matches: the better rated fighter, with a seeded upset now and then
  const rating = (slot: number, round: number) => overall(field[slot - 1].stats) + (mix(seed, slot, round, 7) % 9) - 4;
  const win = (a: number, b: number, round: number) => (rating(a, round) >= rating(b, round) ? a : b);
  const qf: [number, number, number] = [win(2, 3, 0), win(4, 5, 0), win(6, 7, 0)];
  return { week, seed, div, field, winners: { qf, sf: win(qf[1], qf[2], 1) } };
}

/** The bracket slot the player meets in a round (0 quarter-final, 1 semi-final, 2 final). */
export function opponentSlot(b: Bracket, round: number): number {
  return round <= 0 ? 1 : round === 1 ? b.winners.qf[0] : b.winners.sf;
}

export interface TourStep {
  week: string;
  round: number;
  label: string;
  opponent: FighterSpec;
  difficulty: number;
  rules: Partial<FightRules>;
  /** the fight's seed (simulation + venue) */
  seed: number;
}

/** The player's next fight in the current run, or null when there is none to fight. */
export function nextTourStep(t: TournamentState): TourStep | null {
  const r = t.run;
  if (!r || r.out || r.round >= ROUNDS || !t.week) return null;
  const b = bracket(t.week);
  return {
    week: t.week,
    round: r.round,
    label: `Weekly tournament · ${ROUND_NAMES[r.round]}`,
    opponent: b.field[opponentSlot(b, r.round) - 1],
    difficulty: ROUND_DIFFICULTY[r.round],
    rules: roundRules(r.round),
    seed: mix(b.seed, r.round, 911),
  };
}

/** The week's loaner: a rare fighter of the week's division at LOANER_LEVEL (stars 1, no training). */
export function loanerFor(week: string): FighterSpec {
  const div = weekDivision(week);
  const list = rosterOf(div);
  const rares = list.filter(f => f.rarity === 'rare');
  const pool = rares.length ? rares : list;
  const base = pool[weekSeed(week) % pool.length];
  return toFightSpec({ level: LOANER_LEVEL, xp: 0, stars: 1, shards: 0, train: {} }, base);
}

// ---- scoring -------------------------------------------------------------------------------------------------------

/** Points for a finish by method (a decision win gets none). */
export const METHOD_POINTS: Record<TourMethod, number> = { KO: 500, TKO: 400, SUB: 450, DEC: 0 };
/** A finish at the first bell would get this many speed points, falling to 0 at the final bell. */
export const SPEED_POINTS = 800;
/** Up to this many points for damage avoided: minus one point per DAMAGE_STEP of damage taken. */
export const DEFENCE_POINTS = 600;
export const DAMAGE_STEP = 75;
/** Bonus for winning the final. */
export const CHAMPION_POINTS = 1500;

export interface TourFightInput {
  won: boolean;
  method: TourMethod;
  /** fight length and the longest it could have been, in simulation ticks */
  ticks: number;
  maxTicks: number;
  /** damage the player took (sum of the opponent's head, body and leg damage dealt) */
  damageTaken: number;
  /** 0 quarter-final, 1 semi-final, 2 final */
  round: number;
}

/**
 * One tournament fight's points (whole numbers, from the fight result only, so they can be checked from a replay):
 * 0 for a loss or a draw; a win scores 1000, plus a finish bonus, plus speed points for a quick finish, plus points
 * for damage avoided; a semi-final counts x1.25 and the final x1.5.
 */
export function tourFightScore(f: TourFightInput): number {
  if (!f.won) return 0;
  const max = Math.max(1, Math.floor(f.maxTicks));
  const ticks = Math.max(0, Math.min(max, Math.floor(f.ticks)));
  const speed = f.method === 'DEC' ? 0 : Math.floor((SPEED_POINTS * (max - ticks)) / max);
  const defence = Math.max(0, DEFENCE_POINTS - Math.floor(Math.max(0, f.damageTaken) / DAMAGE_STEP));
  const round = Math.max(0, Math.min(ROUNDS - 1, Math.floor(f.round)));
  return Math.floor(((1000 + METHOD_POINTS[f.method] + speed + defence) * (4 + round)) / 4);
}

// ---- entries -------------------------------------------------------------------------------------------------------

/**
 * Bring the state to this week and day: a new week clears the run and the week's best round; a new day gives the
 * entries back. A day before the saved one (a clock moved back) changes nothing, so entries can't be reopened.
 */
export function syncTournament(save: SaveData, today: number, now = Date.now()): TournamentState {
  ensureWeek(save, now);
  const t = save.progress.tournament;
  if (t.week !== save.weekly.id) {
    t.week = save.weekly.id;
    t.run = null;
    t.bestRound = 0;
  }
  if (today > t.day) {
    t.day = today;
    t.used = 0;
    t.extra = 0;
  }
  // a fight that was started and never finished (the app was closed mid-fight) counts as a loss
  if (t.run?.live) {
    t.run.live = false;
    t.run.out = true;
    t.run.fights.push({ r: 'L', m: 'TKO', sc: 0 });
  }
  return t;
}

/** Entries left today. */
export function entriesLeft(t: TournamentState): number {
  return Math.max(0, FREE_ENTRIES + t.extra - t.used);
}

/** A run is under way (entered, not knocked out, not finished). */
export function runActive(t: TournamentState): boolean {
  return !!t.run && !t.run.out && t.run.round < ROUNDS;
}

/** "Watch ad: extra entry" is on offer: today's entries are used up and today's extra one isn't taken. */
export function adEntryOffered(t: TournamentState): boolean {
  return !runActive(t) && entriesLeft(t) === 0 && t.extra < AD_ENTRIES;
}

/** After the rewarded video: one more entry today. */
export function grantAdEntry(t: TournamentState): boolean {
  if (t.extra >= AD_ENTRIES) return false;
  t.extra++;
  return true;
}

/** Start a run with `fighterId` (an owned fighter of the week's division, or the loaner). False when not allowed. */
export function enterTournament(save: SaveData, fighterId: string, loaner: boolean): boolean {
  const t = save.progress.tournament;
  if (!t.week || t.week !== save.weekly.id || runActive(t) || entriesLeft(t) <= 0 || !fighterId) return false;
  t.used++;
  save.weekly.entries++;
  t.run = { round: 0, score: 0, fighter: fighterId, loaner, out: false, live: false, fights: [] };
  return true;
}

/** A tournament fight starts: until its result is in, closing the app counts as a loss. */
export function markLive(t: TournamentState): void {
  if (runActive(t) && t.run) t.run.live = true;
}

export interface TourOutcome {
  /** this fight's points, the run's total, and whether that total is the week's new best */
  score: number;
  total: number;
  best: boolean;
  out: boolean;
  champion: boolean;
  round: number;
}

/**
 * Record a tournament fight's result for `step` (the step the fight was started from). A stale step (another week,
 * another round) records nothing and returns null.
 */
export function applyTourResult(save: SaveData, step: TourStep, f: Omit<TourFightInput, 'round'>, draw = false): TourOutcome | null {
  const t = save.progress.tournament;
  const r = t.run;
  if (!r || r.out || r.round !== step.round || t.week !== step.week || r.round >= ROUNDS) return null;
  r.live = false;
  const score = tourFightScore({ ...f, round: step.round });
  r.fights.push({ r: f.won ? 'W' : draw ? 'D' : 'L', m: f.method, sc: score });
  if (f.won) {
    r.round++;
    r.score += score;
    if (r.round >= ROUNDS) r.score += CHAMPION_POINTS;
    t.bestRound = Math.max(t.bestRound, r.round);
  } else r.out = true;
  const best = r.score > save.weekly.best;
  if (best) save.weekly.best = r.score;
  return { score, total: r.score, best, out: r.out, champion: r.round >= ROUNDS, round: step.round };
}

// ---- prizes ---------------------------------------------------------------------------------------------------------

/** Prize amounts (remote-tunable). */
export const TOURNAMENT_TUNING = defineTunables({
  tourEnteredCash: { def: 600, min: 0, max: 10000 },
  tourT1Points: { def: 1000, min: 1, max: 50000 },
  tourT1Cash: { def: 1500, min: 0, max: 20000 },
  tourT1Gems: { def: 10, min: 0, max: 200 },
  tourT2Points: { def: 2500, min: 1, max: 50000 },
  tourT2Cash: { def: 2500, min: 0, max: 20000 },
  tourT2Gems: { def: 20, min: 0, max: 200 },
  tourT3Points: { def: 5000, min: 1, max: 50000 },
  tourT3Cash: { def: 4000, min: 0, max: 30000 },
  tourT3Gems: { def: 35, min: 0, max: 300 },
  tourT4Points: { def: 8000, min: 1, max: 50000 },
  tourT4Cash: { def: 6000, min: 0, max: 50000 },
  tourT4Gems: { def: 60, min: 0, max: 500 },
  tourT5Points: { def: 10000, min: 1, max: 50000 },
});

export interface TourTier {
  /** claimWeeklyTier index */
  tier: number;
  name: string;
  /** best score needed this week (0 with `entered`: having entered is enough) */
  points: number;
  cash: number;
  gems: number;
  pack: PackId | null;
}

/** The week's prize tiers, lowest first. */
export function tourTiers(): TourTier[] {
  const T = TOURNAMENT_TUNING;
  return [
    { tier: 0, name: 'Took part', points: 0, cash: T.tourEnteredCash, gems: 0, pack: null },
    { tier: 1, name: 'Bronze', points: T.tourT1Points, cash: T.tourT1Cash, gems: T.tourT1Gems, pack: null },
    { tier: 2, name: 'Silver', points: T.tourT2Points, cash: T.tourT2Cash, gems: T.tourT2Gems, pack: null },
    { tier: 3, name: 'Gold', points: T.tourT3Points, cash: T.tourT3Cash, gems: T.tourT3Gems, pack: null },
    { tier: 4, name: 'Platinum', points: T.tourT4Points, cash: T.tourT4Cash, gems: T.tourT4Gems, pack: 'standard' },
    { tier: 5, name: 'Perfect week', points: T.tourT5Points, cash: 0, gems: 0, pack: 'premium' },
  ];
}

/** A tier's prize can be claimed now: reached this week and not claimed yet. */
export function tierReached(save: SaveData, tier: TourTier): boolean {
  return tier.points > 0 ? save.weekly.best >= tier.points : save.weekly.entries > 0;
}

/**
 * Claim a prize tier (once a week each, meta/weekly.ts claimWeeklyTier: a clock moved back can't reopen a week).
 * Returns the prize to pay, or null.
 */
export function claimTourTier(save: SaveData, index: number, now = Date.now()): TourTier | null {
  ensureWeek(save, now);
  const tier = tourTiers().find(x => x.tier === index);
  if (!tier || !tierReached(save, tier)) return null;
  return claimWeeklyTier(save, tier.tier, now) ? tier : null;
}
