import type { SaveData } from './save';
import { obj } from './sanitize';

/**
 * The clock that timed rewards run on (daily login reward, daily free pack, training timers, season xp cap...).
 *
 * The phone's clock can be changed by the player. Moving it forward and claiming is the same as waiting; the exploit
 * is moving it forward, claiming, then moving it back and claiming again. So the reward clock never goes backwards:
 * if the phone's clock falls behind the latest time the game has seen, the reward clock carries on from that time
 * (an offset) and the rewards stay where they were. Small corrections (network time, up to 10 minutes) are ignored.
 * A phone whose clock really was wrong gets let go after 7 days, so an honest fix never locks rewards for long.
 *
 * Season months, the weekly tournament, ad pacing and analytics use the real clock: they must match other players.
 */
export interface ClockState {
  /** latest reward time seen (ms) */
  high: number;
  /** added to the phone's clock while it is behind `high` */
  offset: number;
  /** phone time when the offset was set */
  since: number;
}

const SLACK = 10 * 60 * 1000;
const RELEASE = 7 * 86400000;

let bound: ClockState | null = null;

export function freshClock(): ClockState {
  return { high: 0, offset: 0, since: 0 };
}

/** Use this save's clock state for every reward time from now on (null: the phone's time, for tests and tools). */
export function bindClock(save: SaveData | null): void {
  bound = save ? save.clock : null;
}

/** The time rewards run on, given the phone's time. Without a bound save (tests, tools) it is the phone's time. */
export function rewardTime(real = Date.now()): number {
  const c = bound;
  if (!c) return real;
  const t = real + c.offset;
  if (t < c.high - SLACK) {
    // the clock went back: carry on from the latest time seen
    c.offset = c.high - real;
    c.since = real;
  }
  // never step back, not even within the slack (nudging the clock around midnight must not start a new day twice)
  if (t > c.high) c.high = t;
  return c.high;
}

/**
 * At launch and resume: after 7 days on a moved-back clock, believe the phone again. Rewards claimed "in the future"
 * then count as claimed today, and timers are capped, so nothing stays locked. Returns whether it let go.
 */
export function settleClock(save: SaveData, real: number, dayOf: (t: number) => number): boolean {
  const c = save.clock;
  // first launch with this save: start the reward clock at the phone's time
  if (c.high === 0) {
    c.high = real;
    unlock(save, real, dayOf);
    return false;
  }
  if (c.offset <= 0 || real - c.since < RELEASE) return false;
  c.offset = 0;
  c.since = 0;
  c.high = real;
  unlock(save, real, dayOf);
  return true;
}

/**
 * Rewards claimed "in the future" count as claimed today; every running timer is capped at its own length from now
 * (a 4 h training timer started on a clock set a year ahead finishes at most 4 h from now).
 */
export function unlock(save: SaveData, real: number, dayOf: (t: number) => number): void {
  const today = dayOf(real);
  if (save.daily.lastDay > today) save.daily.lastDay = today;
  if (save.season.day > today) save.season.day = today;
  for (const t of Object.values(save.timers)) if (t.at > real + t.len) t.at = real + t.len;
}

export function sanitizeClock(raw: unknown): ClockState {
  const r = obj(raw);
  const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0);
  // a reward time more than 2 years ahead is not a clock change, it is a corrupt or edited save
  const limit = Date.now() + 2 * 365 * 86400000;
  // a clock that far ahead is broken, not moved: start the reward clock afresh (with the one-time unlock)
  if (typeof r.high === 'number' && r.high > limit) return freshClock();
  const c = { high: n(r.high, limit), offset: n(r.offset, 2 * 365 * 86400000), since: n(r.since, limit) };
  if (!c.offset) c.since = 0;
  return c;
}

/**
 * A restored or reset save keeps this phone's reward clock, with the later of the two latest times (the offset is
 * this phone's; `rewardTime` sets a new one if the restored save has seen a later time than this phone's clock).
 */
export function keepClock(incoming: SaveData, current: SaveData): void {
  const b = current.clock;
  incoming.clock = { high: Math.max(incoming.clock.high, b.high), offset: b.offset, since: b.since };
}
