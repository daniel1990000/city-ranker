import type { SaveData } from './save';
import { rewardTime } from './clock';

/**
 * Timers that pay out when they finish: training sessions, the daily free pack, a "come back in 4 h" offer.
 * They run on the reward clock (meta/clock.ts), so moving the phone's clock back and forth can't finish one twice,
 * and they live in `save.timers` so the clock can cap them if it ever has to let a wrong clock go.
 *
 * Ids are free-form (`train:alex`, `freepack`), up to 40 characters; at most 64 timers run at once.
 */
const MAX_LEN = 30 * 86400000;
const MAX_TIMERS = 64;

/** Start (or restart) a timer that finishes `ms` from now. Returns false if the id or length is not allowed. */
export function startTimer(save: SaveData, id: string, ms: number, now = Date.now()): boolean {
  if (!id || id.length > 40 || !Number.isFinite(ms) || ms < 0 || ms > MAX_LEN) return false;
  if (!(id in save.timers) && Object.keys(save.timers).length >= MAX_TIMERS) return false;
  save.timers[id] = { at: rewardTime(now) + ms, len: ms };
  return true;
}

/** Milliseconds left (0 when finished); null when no such timer runs. */
export function timerLeft(save: SaveData, id: string, now = Date.now()): number | null {
  const t = save.timers[id];
  if (!t) return null;
  return Math.max(0, t.at - rewardTime(now));
}

/** Whether a timer exists and has finished. */
export function timerDone(save: SaveData, id: string, now = Date.now()): boolean {
  return timerLeft(save, id, now) === 0;
}

/** Remove a timer (after paying it out). Returns whether it was there. */
export function clearTimer(save: SaveData, id: string): boolean {
  if (!(id in save.timers)) return false;
  delete save.timers[id];
  return true;
}

/** Finish a running timer now (a rewarded video or gems skip it). Returns false when there is nothing to skip. */
export function skipTimer(save: SaveData, id: string, now = Date.now()): boolean {
  const t = save.timers[id];
  if (!t) return false;
  const rt = rewardTime(now);
  if (t.at <= rt) return false;
  t.at = rt;
  return true;
}
