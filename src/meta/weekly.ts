import type { SaveData } from './save';

/**
 * The weekly tournament's calendar: the same bracket for everyone for a week (Monday to Sunday, UTC), seeded by the
 * week, with a Google Play Games leaderboard. This file is the generic part: which week it is, the week's seed, and
 * the player's record for the week (`save.weekly`), reset when the week turns over. The bracket, opponents and
 * prizes are the content code's (it can keep bracket state in its own progress slot, keyed by `save.weekly.id`).
 */

/** the first tournament week: a date before it (a phone clock reset to 1970) is never believed */
export const FIRST_WEEK = '2026-W42';

/** ISO week id such as "2026-W42" (UTC). */
export function weekId(now = Date.now()): string {
  const d = new Date(now);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Deterministic 32-bit seed for a week id (FNV-1a), the same on every phone. Never 0. */
export function weekSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h = (h ^ 0x5bd1e995) >>> 0;
  return h === 0 ? 0x1234567 : h;
}

/** When the current week ends (next Monday 00:00 UTC), in ms. */
export function weekEndsAt(now = Date.now()): number {
  const d = new Date(now);
  const day = d.getUTCDay() || 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (8 - day));
}

function weekIndex(id: string): number {
  const m = /^(\d{4})-W(\d{2})$/.exec(id);
  return m ? Number(m[1]) * 53 + Number(m[2]) : 0;
}

/** Start a fresh weekly record when the week changes. Returns true if it rolled over. */
export function ensureWeek(save: SaveData, now = Date.now()): boolean {
  const id = weekId(now);
  // ids are zero-padded ("2026-W42"): only move forward, so flipping the date can't pay the weekly prizes again;
  // a saved week far ahead (more than 8 weeks: a clock that was wrong) gives way to the real one
  const back = !!save.weekly.id && id < save.weekly.id;
  if (save.weekly.id === id || (back && (id < FIRST_WEEK || weekIndex(save.weekly.id) - weekIndex(id) <= 8))) return false;
  save.weekly = { id, entries: 0, best: 0, claimed: [] };
  return true;
}

/** Record a tournament result for this week; returns whether it is the week's new best. */
export function recordWeekly(save: SaveData, score: number, now = Date.now()): boolean {
  ensureWeek(save, now);
  save.weekly.entries++;
  const s = Math.max(0, Math.floor(Number.isFinite(score) ? score : 0));
  if (s <= save.weekly.best) return false;
  save.weekly.best = s;
  return true;
}

/** Mark a weekly prize tier as claimed; false if it already was (each tier pays once a week). */
export function claimWeeklyTier(save: SaveData, tier: number, now = Date.now()): boolean {
  ensureWeek(save, now);
  if (!Number.isInteger(tier) || tier < 0 || tier > 99 || save.weekly.claimed.includes(tier)) return false;
  save.weekly.claimed.push(tier);
  return true;
}

export function weekDaysLeft(now = Date.now()): number {
  return Math.max(0, Math.ceil((weekEndsAt(now) - now) / 86400000));
}
