// The player's fighters: which roster fighters they own, and each one's level, stars, shards and training.
// `toFightSpec` turns an owned fighter into the final FighterSpec the simulation sees (a pure function, so a server
// could compute it later). Saved in the 'fighters' progress slot.

import type { FighterSpec, FighterStats, Rarity } from '../game/fight/types';
import { int, obj, record } from './sanitize';
import { registerProgressSlot } from './save';
import { rosterFighter, ROSTER, type RosterFighter } from './roster';

export const STAT_KEYS: readonly (keyof FighterStats)[] = ['power', 'speed', 'chin', 'cardio', 'striking', 'kicking', 'wrestling', 'grappling', 'submissions', 'defense'];

export const MAX_LEVEL = 30;
export const MAX_STARS = 5;

export interface OwnedFighter {
  level: number;
  xp: number;
  /** 1..5: star ups from duplicate shards. */
  stars: number;
  shards: number;
  /** Training points per stat. */
  train: Partial<Record<keyof FighterStats, number>>;
}

export interface FightersState {
  v: 1;
  owned: Record<string, OwnedFighter>;
  /** The fighter the player last picked per division (career and quick fights default to it). */
  picked: Record<string, string>;
}

declare module './save' {
  interface ProgressSlots {
    fighters: FightersState;
  }
}

/** Shards a duplicate card gives. */
export const DUPLICATE_SHARDS: Record<Rarity, number> = { common: 10, rare: 20, epic: 40, legend: 80 };
/** Shards to reach stars 2, 3, 4, 5. */
export const STAR_COST = [0, 0, 30, 60, 120, 240];
/** Most training points per stat, by rarity: better fighters can be developed further. */
export const TRAIN_CAP: Record<Rarity, number> = { common: 8, rare: 10, epic: 12, legend: 14 };

export function freshFighters(): FightersState {
  return { v: 1, owned: {}, picked: {} };
}

function sanitizeOwned(raw: unknown): OwnedFighter | undefined {
  const o = obj(raw);
  const train: Partial<Record<keyof FighterStats, number>> = {};
  const t = obj(o.train);
  for (const k of STAT_KEYS) {
    const v = int(t[k], 0, 0, 20);
    if (v > 0) train[k] = v;
  }
  return {
    level: int(o.level, 1, 1, MAX_LEVEL),
    xp: int(o.xp, 0, 0, 10_000_000),
    stars: int(o.stars, 1, 1, MAX_STARS),
    shards: int(o.shards, 0, 0, 1_000_000),
    train,
  };
}

export function sanitizeFighters(raw: unknown): FightersState {
  const o = obj(raw);
  const owned = record(o.owned, (v, key) => (rosterFighter(key) ? sanitizeOwned(v) : undefined), 100);
  const picked = record(o.picked, (v, key) => (typeof v === 'string' && owned[v] && rosterFighter(v)?.division === key ? v : undefined), 12);
  return { v: 1, owned, picked };
}

registerProgressSlot('fighters', { fresh: freshFighters, sanitize: sanitizeFighters });

// ---- levels ---------------------------------------------------------------------------------------------------

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(120 * Math.pow(level, 1.45));
}

/** Add XP; returns how many levels were gained. */
export function addXp(f: OwnedFighter, xp: number): number {
  let gained = 0;
  f.xp += Math.max(0, Math.floor(xp));
  while (f.level < MAX_LEVEL && f.xp >= xpToNext(f.level)) {
    f.xp -= xpToNext(f.level);
    f.level++;
    gained++;
  }
  if (f.level >= MAX_LEVEL) f.xp = 0;
  return gained;
}

// ---- training ---------------------------------------------------------------------------------------------------

/** Cash for the next training point in a stat. */
export function trainCost(points: number): number {
  return Math.round(400 * Math.pow(points + 1, 1.5) / 10) * 10;
}

/** Minutes the next point takes (skippable with gems or a rewarded ad). */
export function trainMinutes(points: number): number {
  return points < 2 ? 0 : Math.min(240, 5 * points * points);
}

export function canTrain(f: OwnedFighter, base: RosterFighter, stat: keyof FighterStats): boolean {
  const pts = f.train[stat] ?? 0;
  return pts < TRAIN_CAP[base.rarity] && toStats(f, base)[stat] < 100;
}

// ---- the spec the simulation sees ---------------------------------------------------------------------------------

/** Stats after level, stars and training (integers 1..100). */
export function toStats(f: OwnedFighter, base: RosterFighter): FighterStats {
  const out = { ...base.stats };
  const lv = Math.floor((f.level - 1) / 3); // +1 every 3 levels: up to +9
  const st = (f.stars - 1) * 2; // up to +8
  for (const k of STAT_KEYS) out[k] = Math.max(1, Math.min(100, out[k] + lv + st + (f.train[k] ?? 0)));
  return out;
}

export function toFightSpec(f: OwnedFighter, base: RosterFighter): FighterSpec {
  return {
    id: base.id,
    name: base.name,
    nickname: base.nickname,
    division: base.division,
    archetype: base.archetype,
    rarity: base.rarity,
    stats: toStats(f, base),
    lookSeed: base.lookSeed,
    lookHints: base.lookHints,
  };
}

// ---- owning ----------------------------------------------------------------------------------------------------

export interface CardResult {
  id: string;
  /** New fighter, or a duplicate turned into shards. */
  isNew: boolean;
  shards: number;
}

/** Give a fighter card: a new fighter, or shards for one already owned. */
export function giveCard(state: FightersState, id: string): CardResult {
  const base = rosterFighter(id);
  if (!base) return { id, isNew: false, shards: 0 };
  const have = state.owned[id];
  if (!have) {
    state.owned[id] = { level: 1, xp: 0, stars: 1, shards: 0, train: {} };
    if (!state.picked[base.division]) state.picked[base.division] = id;
    return { id, isNew: true, shards: 0 };
  }
  const s = DUPLICATE_SHARDS[base.rarity];
  have.shards += s;
  return { id, isNew: false, shards: s };
}

export function canStarUp(f: OwnedFighter): boolean {
  return f.stars < MAX_STARS && f.shards >= STAR_COST[f.stars + 1];
}

export function starUp(f: OwnedFighter): boolean {
  if (!canStarUp(f)) return false;
  f.shards -= STAR_COST[f.stars + 1];
  f.stars++;
  return true;
}

/** The free starter: the common lightweight boxer, so the first fight is a fair, readable stand-up battle. */
export const STARTER_ID = ROSTER.find(f => f.division === 'mLight' && f.rarity === 'common' && f.archetype === 'boxer')?.id ?? ROSTER[0].id;
