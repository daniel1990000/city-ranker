import { rewardTime } from './clock';
import type { SaveData } from './save';
import { TUNING } from './tuning';
import { dayNumber } from './days';
import { addCash, addGems } from './wallet';

/**
 * The monthly season: earn xp from fights, climb 20 tiers, claim rewards on a free track and a premium track.
 * The premium track is the month's Season Pass (bought each month; the Starter Pack includes the month it was bought
 * in). Fight xp is capped per fight and per day, so the track takes about three weeks of regular play for anyone,
 * whatever their skill; daily rewards and events add xp on top. At the turn of the month every reward earned but not
 * claimed is paid out automatically.
 *
 * This file is the mechanics. What each tier gives (fighters, gear, packs, cosmetics) is the content code's: it
 * calls `setSeasonContent` once at start-up. Until then a built-in track of cash and gems is used.
 */
export const TIERS = 20;
export const TIER_XP = 500;
/** the first month the game ran seasons: a date before it (a phone clock reset to 1970) is never believed */
export const FIRST_SEASON = '2026-10';

/** A content item a tier can give. `kind` and `id` mean whatever the content code says (fighter, gear, pack...). */
export interface SeasonItem {
  kind: string;
  id: string;
  /** shown on the track */
  name: string;
}

export interface SeasonReward {
  cash: number;
  gems: number;
  item?: SeasonItem;
  /** cash paid instead of an item the player already owns */
  dup?: number;
}

export interface SeasonContent {
  /** "Iron Month", "Fight Night Season"... for the season id "2026-10" */
  name(seasonId: string): string;
  free(tier: number, seasonId: string): SeasonReward;
  premium(tier: number, seasonId: string): SeasonReward;
  /** whether the player already has the item (then `dupCash` is paid instead) */
  owns(save: SaveData, item: SeasonItem): boolean;
  /** give the item */
  give(save: SaveData, item: SeasonItem): void;
  /** cash for an item already owned */
  dupCash(item: SeasonItem): number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const tierCash = (tier: number) => (tier % 5 === 0 ? 1000 + tier * 100 : 200 + tier * 50);

/** The built-in track: cash every tier, gems every 5th, double on the premium track plus a gem prize at the top. */
export const DEFAULT_SEASON_CONTENT: SeasonContent = {
  name: (id) => `${MONTHS[Number(id.split('-')[1]) - 1] ?? 'This'} Season`,
  free: (tier) => ({ cash: tierCash(tier), gems: tier % 5 === 0 ? 10 : 0 }),
  premium: (tier) => ({ cash: tierCash(tier) * 2, gems: (tier % 5 === 0 ? 30 : 5) + (tier === TIERS ? 200 : 0) }),
  owns: () => false,
  give: () => {},
  dupCash: () => 0,
};

let content: SeasonContent = DEFAULT_SEASON_CONTENT;

/** Plug in the real track (content code, at start-up). */
export function setSeasonContent(c: SeasonContent): void {
  content = c;
}

/** UTC calendar month id such as "2026-10". */
export function seasonId(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthIndex(id: string): number {
  const [y, m] = id.split('-').map(Number);
  return Number.isFinite(y) && Number.isFinite(m) ? y * 12 + m : 0;
}
export function seasonName(now = Date.now()): string {
  return content.name(seasonId(now));
}
export function seasonEndsAt(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
export function seasonDaysLeft(now = Date.now()): number {
  return Math.max(0, Math.ceil((seasonEndsAt(now) - now) / 86400000));
}

export function tierOf(xp: number): number {
  return Math.min(TIERS, Math.floor(Math.max(0, xp) / TIER_XP));
}

/** The free / premium reward of a tier, as the content defines it, for the season `id`. */
export function freeReward(tier: number, id: string): SeasonReward {
  return content.free(tier, id);
}
export function premiumReward(tier: number, id: string): SeasonReward {
  return content.premium(tier, id);
}

/** The reward as this player would get it: an item already owned shows (and pays) as cash. */
export function asReceived(save: SaveData, r: SeasonReward): SeasonReward {
  if (r.item && content.owns(save, r.item)) return { cash: r.cash, gems: r.gems, dup: content.dupCash(r.item) };
  return r;
}

/** Whether the premium track of the season `id` is unlocked (the current season by default). */
export function isPremium(save: SaveData, now = Date.now(), id = seasonId(now)): boolean {
  return !!save.seasonPass && save.seasonPass === id;
}

function grant(save: SaveData, reward: SeasonReward): SeasonReward {
  const r = asReceived(save, reward);
  addCash(save, r.cash + (r.dup ?? 0));
  addGems(save, r.gems);
  if (r.item) content.give(save, r.item);
  return r;
}

/**
 * Start the season for `now` if the month changed. Rewards already earned but not claimed are paid out
 * automatically, so nobody loses anything at the turn of the month. Returns what was paid (for a toast).
 */
export function ensureSeason(save: SaveData, now = Date.now()): { rolled: boolean; cash: number; gems: number; items: SeasonItem[] } {
  const id = seasonId(now);
  const s = save.season;
  const none = { rolled: false, cash: 0, gems: 0, items: [] as SeasonItem[] };
  // a clock set back never resets the season (that would let tiers be claimed twice), and a date before the game
  // existed is never believed. Only a saved season months ahead of a sane date gives way: the phone's clock was
  // wrong when it was saved.
  const back = !!s.id && id < s.id;
  if (s.id === id || (back && (id < FIRST_SEASON || monthIndex(s.id) - monthIndex(id) <= 2))) return none;
  const paid = { rolled: true, cash: 0, gems: 0, items: [] as SeasonItem[] };
  if (s.id) {
    const got = tierOf(s.xp);
    const add = (r: SeasonReward) => {
      paid.cash += r.cash + (r.dup ?? 0);
      paid.gems += r.gems;
      if (r.item && !r.dup) paid.items.push(r.item);
    };
    for (let t = 1; t <= got; t++) {
      if (!s.free.includes(t)) add(grant(save, freeReward(t, s.id)));
      if (isPremium(save, now, s.id) && !s.prem.includes(t)) add(grant(save, premiumReward(t, s.id)));
    }
  }
  save.season = { id, xp: 0, free: [], prem: [], day: -1, dayXp: 0 };
  return paid;
}

/** Fight xp still allowed today. */
export function seasonXpLeftToday(save: SaveData, now = Date.now()): number {
  const day = dayNumber(rewardTime(now));
  return Math.max(0, TUNING.seasonDayXpCap - (save.season.day === day ? save.season.dayXp : 0));
}

/** Xp one fight may give: the content's amount, capped per fight (the daily cap is applied by addSeasonXp). */
export function fightXp(amount: number): number {
  return Math.max(0, Math.min(TUNING.seasonFightXpCap, Math.round(Number.isFinite(amount) ? amount : 0)));
}

/**
 * Add xp; returns the tiers newly reached. Xp from fights counts against the daily cap; bonuses (daily reward,
 * events, achievements) don't.
 */
export function addSeasonXp(save: SaveData, xp: number, now = Date.now(), source: 'fight' | 'bonus' = 'bonus'): number {
  ensureSeason(save, now);
  let add = Math.max(0, Math.round(Number.isFinite(xp) ? xp : 0));
  if (source === 'fight') {
    const day = dayNumber(rewardTime(now));
    if (day > save.season.day) {
      save.season.day = day;
      save.season.dayXp = 0;
    }
    add = Math.max(0, Math.min(fightXp(add), TUNING.seasonDayXpCap - save.season.dayXp));
    save.season.dayXp += add;
  }
  const before = tierOf(save.season.xp);
  save.season.xp = Math.min(TIERS * TIER_XP + 5000, save.season.xp + add);
  return tierOf(save.season.xp) - before;
}

/** Claim one tier on one track. Returns the reward or null when not claimable. */
export function claimTier(save: SaveData, track: 'free' | 'prem', tier: number, now = Date.now()): SeasonReward | null {
  ensureSeason(save, now);
  const s = save.season;
  if (!Number.isInteger(tier) || tier < 1 || tier > TIERS || tier > tierOf(s.xp)) return null;
  const list = track === 'free' ? s.free : s.prem;
  if (list.includes(tier)) return null;
  if (track === 'prem' && !isPremium(save, now)) return null;
  const r = track === 'free' ? freeReward(tier, s.id) : premiumReward(tier, s.id);
  list.push(tier);
  return grant(save, r);
}

/** How many rewards could be claimed right now (for the badge). */
export function claimable(save: SaveData, now = Date.now()): number {
  const s = save.season.id === seasonId(now) ? save.season : { xp: 0, free: [] as number[], prem: [] as number[] };
  const got = tierOf(s.xp);
  const prem = isPremium(save, now);
  let n = 0;
  for (let t = 1; t <= got; t++) {
    if (!s.free.includes(t)) n++;
    if (prem && !s.prem.includes(t)) n++;
  }
  return n;
}
