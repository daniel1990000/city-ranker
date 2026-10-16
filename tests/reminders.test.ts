// Opt-in reminders: what gets planned from the save.
import { describe, expect, it } from 'vitest';
import { freshSave, sanitize } from '../src/meta/save';
import '../src/meta/fighters';
import '../src/meta/career';
import '../src/meta/packs';
import '../src/meta/record';
import { dayNumber } from '../src/meta/days';
import { STARTER_ID } from '../src/meta/fighters';
import { plannedReminders } from '../src/platform/notify';
import { gameReminders } from '../src/app/reminders';

const NOW = new Date(2026, 9, 16, 15, 0, 0).getTime();

describe('reminders', () => {
  it('free pack: reminds tomorrow evening only once today\'s pack was claimed', () => {
    const s = sanitize(freshSave());
    expect(gameReminders(s, NOW).length).toBe(0);
    s.progress.packs.freeDay = dayNumber(NOW);
    const [r] = gameReminders(s, NOW);
    expect(r.title).toMatch(/free pack/i);
    expect(new Date(r.at).getDate()).toBe(17);
    expect(new Date(r.at).getHours()).toBe(18);
  });

  it('training: one per running timer, on the phone\'s clock', () => {
    const s = sanitize(freshSave());
    s.timers[`train:${STARTER_ID}`] = { at: NOW + 3600_000 + 5000, len: 3600_000 };
    s.clock.offset = 5000;
    const r = gameReminders(s, NOW);
    expect(r).toHaveLength(1);
    expect(r[0].at.getTime()).toBe(NOW + 3600_000);
  });

  it('the plan includes the game\'s reminders and no weekly-tournament one (there is none)', () => {
    const s = sanitize(freshSave());
    s.progress.packs.freeDay = dayNumber(NOW);
    s.weekly.id = '2026-W42';
    const all = plannedReminders(s, NOW);
    expect(all.some(r => /free pack/i.test(r.title))).toBe(true);
    expect(all.some(r => /weekly/i.test(r.title))).toBe(false);
  });
});
