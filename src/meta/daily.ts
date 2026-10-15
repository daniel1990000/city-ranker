import type { SaveData } from './save';
import { rewardTime } from './clock';
import { dayNumber } from './days';

/**
 * The daily login streak: one claim per local calendar day, a 7-day cycle that keeps counting while the player comes
 * back on consecutive days and starts again at day 1 after a missed day. Runs on the reward clock, so a clock moved
 * forward and back can't claim the same day twice.
 *
 * This is the mechanics; what each day of the cycle pays is the content code's (it calls `claimDaily` and pays
 * for the day it returns).
 */
export const DAILY_CYCLE = 7;

export interface DailyStatus {
  /** today's claim is still open */
  available: boolean;
  /** the day of the 7-day cycle (1..7) that is claimable today, or was claimed last */
  day: number;
  /** consecutive days, counting today's claim if it is still open */
  streak: number;
}

export function dailyStatus(save: SaveData, now = Date.now()): DailyStatus {
  const today = dayNumber(rewardTime(now));
  // `>`, not `!==`: a reward claimed on a later day (a clock moved forward, then back) is not available again
  const available = today > save.daily.lastDay;
  const continuing = save.daily.lastDay === today - 1;
  const streak = available ? (continuing ? save.daily.streak + 1 : 1) : Math.max(1, save.daily.streak);
  return { available, day: ((streak - 1) % DAILY_CYCLE) + 1, streak };
}

/** Claim today. Returns the cycle day claimed (1..7), or 0 when today was already claimed. */
export function claimDaily(save: SaveData, now = Date.now()): number {
  const st = dailyStatus(save, now);
  if (!st.available) return 0;
  save.daily.lastDay = dayNumber(rewardTime(now));
  save.daily.streak = st.streak;
  return st.day;
}
