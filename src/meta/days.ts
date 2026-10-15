/**
 * Calendar days for daily things (login streak, daily fight card, daily free pack, per-day caps).
 *
 * A "day" is the player's local calendar day, numbered as days since 1970: the daily reward turns over at the
 * player's own midnight, not at midnight UTC. Pass a reward-clock time (meta/clock.ts `rewardTime()`), never the
 * raw phone time, for anything that pays out, so winding the clock back can't reopen a day.
 */
export const DAY_MS = 86400000;

export function dayNumber(now = Date.now()): number {
  const d = new Date(now);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Milliseconds until the next local midnight (for "new fights in 3h 12m"). */
export function msUntilTomorrow(now = Date.now()): number {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
  return Math.max(0, next - now);
}
