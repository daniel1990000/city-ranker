import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { rewardTime } from '../meta/clock';
import type { SaveData } from '../meta/save';
import { dayNumber } from '../meta/days';
import { seasonEndsAt, seasonId, tierOf, TIERS } from '../meta/season';
import { weekEndsAt } from '../meta/weekly';

/**
 * Opt-in reminders (Android only, all scheduled on the phone: nothing is sent anywhere). Off until the player turns
 * them on. Fixed ids, so scheduling again replaces the old ones.
 *
 * Other parts of the game add their own (training finished, free pack ready) with `addReminderSource`, using ids
 * in CONTENT_IDS.
 */
const IDS = { streak: 102, season: 103, weekly: 104 };
/** ids content reminders may use */
export const CONTENT_IDS = { first: 200, last: 263 } as const;
/** status-bar icon: android/app/src/main/res/drawable/ic_stat_ck.xml (kept from shrinking by res/raw/keep.xml) */
const SMALL_ICON = 'ic_stat_ck';
const supported = () => Capacitor.isNativePlatform();

export interface Reminder {
  id: number;
  title: string;
  body: string;
  at: Date;
}

const sources: ((save: SaveData, now: number) => Reminder[])[] = [];

/** Add reminders from another part of the game. Its ids must lie in CONTENT_IDS (others are dropped). */
export function addReminderSource(fn: (save: SaveData, now: number) => Reminder[]): void {
  sources.push(fn);
}

export async function requestReminderPermission(): Promise<boolean> {
  if (!supported()) return false;
  try {
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === 'granted') return true;
    const r = await LocalNotifications.requestPermissions();
    return r.display === 'granted';
  } catch {
    return false;
  }
}

/** The next time the local clock reads `hour`:00 that is at least `minMs` from now. */
function nextAt(hour: number, now: number, minMs: number): Date {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  while (d.getTime() < now + minMs) d.setDate(d.getDate() + 1);
  return d;
}

function tomorrowAt(hour: number, now: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** What to remind about, given the save (pure: unit tested). */
export function plannedReminders(save: SaveData, now = Date.now()): Reminder[] {
  const out: Reminder[] = [];
  if (save.daily.lastDay >= 0) {
    const claimedToday = save.daily.lastDay >= dayNumber(rewardTime(now));
    const streak = claimedToday ? save.daily.streak : 0;
    out.push({
      id: IDS.streak,
      title: streak >= 2 ? `Keep your ${streak}-day streak!` : 'Daily reward waiting',
      body: 'Claim today’s reward before midnight.',
      at: claimedToday ? tomorrowAt(19, now) : nextAt(20, now, 3600_000),
    });
  }
  const left = seasonEndsAt(now) - now;
  if (save.season.id === seasonId(now) && save.season.xp > 0 && left > 2 * 86400_000 && tierOf(save.season.xp) < TIERS) {
    const at = new Date(seasonEndsAt(now) - 2 * 86400_000);
    at.setUTCHours(12, 0, 0, 0);
    out.push({ id: IDS.season, title: 'Season ends in 2 days', body: 'Finish your tiers and claim your rewards.', at });
  }
  if (save.weekly.id) out.push({ id: IDS.weekly, title: 'New weekly tournament', body: 'A fresh bracket, the same for everyone. Fight your way to the top.', at: new Date(weekEndsAt(now) + 9 * 3600_000) });
  for (const fn of sources) {
    try {
      for (const r of fn(save, now)) if (Number.isInteger(r.id) && r.id >= CONTENT_IDS.first && r.id <= CONTENT_IDS.last) out.push(r);
    } catch {
      /* a broken source loses its reminders, not everyone's */
    }
  }
  const seen = new Set<number>();
  return out.filter((r) => r.at.getTime() > now + 30_000 && !seen.has(r.id) && !!seen.add(r.id));
}

function allIds(): { id: number }[] {
  const ids = Object.values(IDS).map((id) => ({ id }));
  for (let id = CONTENT_IDS.first; id <= CONTENT_IDS.last; id++) ids.push({ id });
  return ids;
}

/** Replace all scheduled reminders (call when the app goes to the background). */
export async function scheduleReminders(save: SaveData, now = Date.now()): Promise<void> {
  if (!supported()) return;
  try {
    await LocalNotifications.cancel({ notifications: allIds() });
    if (!save.settings.reminders) return;
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return;
    const list = plannedReminders(save, now);
    if (!list.length) return;
    await LocalNotifications.schedule({
      notifications: list.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: { at: r.at, allowWhileIdle: false }, smallIcon: SMALL_ICON })),
    });
  } catch {
    /* reminders are a nicety */
  }
}

export async function cancelReminders(): Promise<void> {
  if (!supported()) return;
  try {
    await LocalNotifications.cancel({ notifications: allIds() });
  } catch {
    /* ignore */
  }
}
