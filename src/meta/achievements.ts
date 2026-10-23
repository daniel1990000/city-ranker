// Achievements: one-time goals with a small cash / gem reward each, mirrored to Play Games achievements
// (platform/games.ts syncAchievements, ids in platform/config.ts CONFIG.games.achievements).
//
// The rules here are pure: `checkAchievements` looks at the save (and, after a fight, at what happened in it) and
// says which achievements are newly earned; `awardAchievements` marks them in `save.achievements` and pays each one
// exactly once (an id already in the save is never paid again, whatever the caller passes). app/game.ts calls them
// after fights, pack openings, star-ups, the daily login and the season track.
//
// Paid things never count: a fighter that only a fixed-price bundle gave (meta/fighters.ts `bundle: 'card'`) is left
// out of the collection goals, so a refund can't leave a paid-for reward behind.

import type { DivisionId, FightResult, MoveId, RoundStats } from '../game/fight/types';
import { DIVISION_IDS, isDivision } from './divisions';
import { BUNDLE_FIGHTERS, MAX_STARS } from './fighters';
import { ROSTER } from './roster';
import { obj } from './sanitize';
import { registerProgressSlot, type SaveData } from './save';
import { tierOf } from './season';
import type { PackId } from './packs';
import { defineTunables } from './tuning';
import { addCash, addGems } from './wallet';

/** What one finished fight looked like from the player's side (fighter 0). Built by `fightFacts`. */
export interface FightFacts {
  won: boolean;
  draw: boolean;
  method: FightResult['method'];
  /** the finishing blow of a KO / TKO */
  by: MoveId | 'pound' | null;
  division: DivisionId;
  /** a career fight (not a quick fight) */
  career: boolean;
  /** strikes the player landed, takedowns scored, knockdowns scored */
  landed: number;
  takedowns: number;
  knockdowns: number;
  /** times the player was knocked down */
  knockedDown: number;
  /** rounds where the player landed at least FLAWLESS_LANDED strikes and took no damage at all */
  flawlessRounds: number;
}

/** Strikes to land in a round without taking any damage for it to count as flawless. */
export const FLAWLESS_LANDED = 10;

/**
 * The facts of a fight from its result and the per-round stats (FightState.stats: [player, opponent] per round).
 * Without round stats (an old caller) the counts are 0, so nothing that needs them is earned.
 */
export function fightFacts(result: Pick<FightResult, 'winner' | 'method' | 'by'>, rounds: readonly (readonly [RoundStats, RoundStats])[] | undefined, division: DivisionId, career: boolean): FightFacts {
  const f: FightFacts = {
    won: result.winner === 0,
    draw: result.winner === null,
    method: result.method,
    by: result.by,
    division,
    career,
    landed: 0,
    takedowns: 0,
    knockdowns: 0,
    knockedDown: 0,
    flawlessRounds: 0,
  };
  for (const [me, them] of rounds ?? []) {
    f.landed += me.landed;
    f.takedowns += me.takedowns;
    f.knockdowns += me.knockdowns;
    f.knockedDown += them.knockdowns;
    if (me.landed >= FLAWLESS_LANDED && them.headDmg + them.bodyDmg + them.legDmg === 0) f.flawlessRounds++;
  }
  return f;
}

export interface AchievementDef {
  id: string;
  name: string;
  /** how to earn it, shown on the achievements screen */
  text: string;
  /** built-in reward (before ACHIEVEMENT_TUNING.achievementPct) */
  cash: number;
  gems: number;
  /** a pack to open, for the hardest ones (packs rather than more gems keep gem bundles worth buying) */
  pack?: PackId;
  /** progress toward it for the screen (have / need), when it is a count */
  progress?: (save: SaveData) => [number, number];
  /** earned from the save alone (checked any time) */
  state?: (save: SaveData) => boolean;
  /** earned by one fight */
  fight?: (f: FightFacts, save: SaveData) => boolean;
}

/** Remote-tunable: every achievement's cash and gems, as a percentage of the built-in amounts. */
export const ACHIEVEMENT_TUNING = defineTunables({ achievementPct: { def: 100, min: 50, max: 300 } });

/** Progress kept only for achievements: the divisions the player has won a fight in (any mode). */
export interface FeatsState {
  v: 1;
  divWins: DivisionId[];
}

declare module './save' {
  interface ProgressSlots {
    feats: FeatsState;
  }
}

export function freshFeats(): FeatsState {
  return { v: 1, divWins: [] };
}

export function sanitizeFeats(raw: unknown): FeatsState {
  const r = obj(raw);
  const list: unknown[] = Array.isArray(r.divWins) ? r.divWins : [];
  return { v: 1, divWins: DIVISION_IDS.filter(d => list.includes(d)) };
}

registerProgressSlot('feats', { fresh: freshFeats, sanitize: sanitizeFeats, maxBytes: 1024 });

/** Fighters the player owns for good (a fighter only a bundle gave is left out: a refund takes it back). */
export function ownedCount(save: SaveData): number {
  const f = save.progress.fighters;
  const bundleOnly = new Set(Object.entries(f.bundle).filter(([, how]) => how === 'card').map(([b]) => BUNDLE_FIGHTERS[b]));
  return ROSTER.filter(r => f.owned[r.id] && !bundleOnly.has(r.id)).length;
}

const careerDivs = (s: SaveData) => DIVISION_IDS.map(d => s.progress.career.div[d]);
const packsOpened = (s: SaveData) => {
  const o = s.progress.packs.opened;
  return o.standard + o.premium + o.elite;
};
const count = (have: number, need: number): [number, number] => [Math.min(have, need), need];
const isKo = (f: FightFacts) => f.method === 'KO' || f.method === 'TKO';

/** Reward sizes: quick early hits, about one a week, and the big moments (docs/ECONOMY.md). */
const EASY = { cash: 500, gems: 5 };
const MEDIUM = { cash: 1500, gems: 20 };
const HARD = { cash: 2500, gems: 50 };

/**
 * Every achievement, in screen order. Ids are permanent (saves and Play Games use them): never rename one.
 * Totals: ACHIEVEMENT_TOTALS (a test keeps the gems at 600 or less).
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'firstWin', name: 'Welcome to the Cage', text: 'Win your first fight', ...EASY, state: s => s.wins >= 1, progress: s => count(s.wins, 1) },
  { id: 'firstKo', name: 'Lights Out', text: 'Win by KO or TKO', ...EASY, state: s => s.progress.record.kos >= 1, fight: f => f.won && isKo(f) },
  { id: 'firstSub', name: 'Tap Tap', text: 'Win by submission', ...EASY, state: s => s.progress.record.subs >= 1, fight: f => f.won && f.method === 'SUB' },
  { id: 'firstDecision', name: 'Went the Distance', text: "Win on the judges' cards", ...EASY, fight: f => f.won && f.method === 'DEC' },
  { id: 'wins5', name: 'On a Roll', text: 'Win 5 fights', ...EASY, state: s => s.wins >= 5, progress: s => count(s.wins, 5) },
  { id: 'packs10', name: 'Pack Rat', text: 'Open 10 packs', ...EASY, state: s => packsOpened(s) >= 10, progress: s => count(packsOpened(s), 10) },
  { id: 'streak7', name: 'Regular', text: 'Log in 7 days in a row', ...EASY, state: s => s.daily.streak >= 7, progress: s => count(s.daily.streak, 7) },
  { id: 'headKickKo', name: 'Highlight Reel', text: 'Finish a fight with a head kick', ...MEDIUM, fight: f => f.won && isKo(f) && f.by === 'headKick' },
  { id: 'flawless', name: 'Untouchable', text: `Land ${FLAWLESS_LANDED} strikes in a round without taking any damage`, ...MEDIUM, fight: f => f.flawlessRounds > 0 },
  { id: 'comeback', name: 'Back off the Canvas', text: 'Get knocked down and still win the fight', ...MEDIUM, fight: f => f.won && f.knockedDown > 0 },
  { id: 'wins25', name: 'Contender', text: 'Win 25 fights', ...MEDIUM, state: s => s.wins >= 25, progress: s => count(s.wins, 25) },
  { id: 'kos10', name: 'Knockout Artist', text: 'Win 10 fights by KO or TKO', ...MEDIUM, state: s => s.progress.record.kos >= 10, progress: s => count(s.progress.record.kos, 10) },
  { id: 'own10', name: 'Fight Camp', text: 'Own 10 fighters', ...MEDIUM, state: s => ownedCount(s) >= 10, progress: s => count(ownedCount(s), 10) },
  { id: 'season10', name: 'Halfway Up', text: 'Reach tier 10 of a season', ...MEDIUM, state: s => tierOf(s.season.xp) >= 10 },
  { id: 'firstTitle', name: 'Champion', text: 'Win a title in any division', ...MEDIUM, state: s => careerDivs(s).some(c => c.titles >= 1) },
  { id: 'defend3', name: 'Long Reign', text: 'Defend a title 3 times', ...HARD, state: s => careerDivs(s).some(c => c.defenses >= 3), progress: s => count(Math.max(0, ...careerDivs(s).map(c => c.defenses)), 3) },
  { id: 'allDivisions', name: 'Every Weight', text: 'Win a fight in all six divisions', ...HARD, state: s => s.progress.feats.divWins.length >= DIVISION_IDS.length, progress: s => count(s.progress.feats.divWins.length, DIVISION_IDS.length) },
  { id: 'own25', name: 'Gym Owner', text: 'Own 25 fighters', ...HARD, state: s => ownedCount(s) >= 25, progress: s => count(ownedCount(s), 25) },
  { id: 'fiveStar', name: 'Five Stars', text: 'Raise a fighter to 5 stars', ...HARD, state: s => Object.values(s.progress.fighters.owned).some(o => o.stars >= MAX_STARS) },
  { id: 'wins100', name: 'Veteran', text: 'Win 100 fights', ...HARD, pack: 'premium', state: s => s.wins >= 100, progress: s => count(s.wins, 100) },
  { id: 'ownAll', name: 'Full Roster', text: `Own all ${ROSTER.length} fighters`, cash: 4000, gems: 100, pack: 'premium', state: s => ownedCount(s) >= ROSTER.length, progress: s => count(ownedCount(s), ROSTER.length) },
];

export const ACHIEVEMENT_IDS: readonly string[] = ACHIEVEMENTS.map(a => a.id);

/** Everything all achievements pay together at the built-in amounts (docs/ECONOMY.md). */
export const ACHIEVEMENT_TOTALS = ACHIEVEMENTS.reduce((t, a) => ({ cash: t.cash + a.cash, gems: t.gems + a.gems, packs: t.packs + (a.pack ? 1 : 0) }), { cash: 0, gems: 0, packs: 0 });

const BY_ID = new Map(ACHIEVEMENTS.map(a => [a.id, a]));

export function achievement(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

/** What an achievement pays now (built-in amounts x the remote percentage). */
export function achievementReward(a: AchievementDef): { cash: number; gems: number; pack?: PackId } {
  const pct = ACHIEVEMENT_TUNING.achievementPct / 100;
  return { cash: Math.round((a.cash * pct) / 10) * 10, gems: Math.round(a.gems * pct), pack: a.pack };
}

/** What to check: a finished fight, or nothing (the save alone: packs, stars, the daily login, the season...). */
export interface AchievementCtx {
  fight?: FightFacts;
}

/** Newly earned achievement ids (not yet in the save), in screen order. Pure: the save is not changed. */
export function checkAchievements(save: SaveData, ctx: AchievementCtx = {}): string[] {
  const out: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (save.achievements[a.id]) continue;
    if ((a.state && a.state(save)) || (ctx.fight && a.fight && a.fight(ctx.fight, save))) out.push(a.id);
  }
  return out;
}

/**
 * Mark achievements earned at `now` and pay each one's reward. An id that is unknown or already earned is skipped,
 * so nothing is ever paid twice. Returns the ones awarded now.
 */
export function awardAchievements(save: SaveData, ids: readonly string[], now = Date.now()): AchievementDef[] {
  const got: AchievementDef[] = [];
  for (const id of ids) {
    const a = BY_ID.get(id);
    if (!a || save.achievements[id]) continue;
    save.achievements[id] = Math.max(1, now);
    const r = achievementReward(a);
    addCash(save, r.cash);
    addGems(save, r.gems);
    if (r.pack) save.progress.packs.unopened[r.pack]++;
    got.push(a);
  }
  return got;
}

/** Remember the division of a won fight (for "Every Weight"). */
export function noteFight(save: SaveData, f: FightFacts): void {
  const list = save.progress.feats.divWins;
  if (f.won && isDivision(f.division) && !list.includes(f.division)) save.progress.feats.divWins = DIVISION_IDS.filter(d => d === f.division || list.includes(d));
}

/** Check and award in one step (the usual call). */
export function earnAchievements(save: SaveData, ctx: AchievementCtx = {}, now = Date.now()): AchievementDef[] {
  if (ctx.fight) noteFight(save, ctx.fight);
  return awardAchievements(save, checkAchievements(save, ctx), now);
}
