// The game's own reminders (opt-in, scheduled on the phone by platform/notify.ts): the free pack is ready again,
// and a fighter's training has finished.

import { dayNumber } from '../meta/days';
import { rewardTime } from '../meta/clock';
import { rosterFighter } from '../meta/roster';
import type { SaveData } from '../meta/save';
import { addReminderSource, CONTENT_IDS, type Reminder } from '../platform/notify';

const FREE_PACK = CONTENT_IDS.first;
const TRAIN_FIRST = CONTENT_IDS.first + 1;

/** What the game reminds about (pure: unit tested). */
export function gameReminders(save: SaveData, now: number): Reminder[] {
  const out: Reminder[] = [];
  // claimed today: remind tomorrow evening (the pack is ready from midnight)
  if (save.progress.packs.freeDay >= dayNumber(rewardTime(now))) {
    const at = new Date(now);
    at.setDate(at.getDate() + 1);
    at.setHours(18, 0, 0, 0);
    out.push({ id: FREE_PACK, title: 'Your free pack is ready', body: 'Open today’s free fighter pack.', at });
  }
  // training timers run on the reward clock: take its offset off to get the phone's time
  let id = TRAIN_FIRST;
  for (const [key, t] of Object.entries(save.timers)) {
    if (!key.startsWith('train:') || id > CONTENT_IDS.last) continue;
    const f = rosterFighter(key.slice(6));
    if (!f) continue;
    out.push({ id: id++, title: 'Training finished', body: `${f.name} is ready: the new stats are in.`, at: new Date(t.at - save.clock.offset) });
  }
  return out;
}

addReminderSource(gameReminders);
