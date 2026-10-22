// A phone clock flipped months forward and back must not hand out a fresh season with a fresh daily xp cap
// (bug hunt, October 2026: six flips in one day gave 12 tier claims instead of 2).
import { describe, expect, it } from 'vitest';
import { freshSave, sanitize } from '../src/meta/save';
import { addSeasonXp, ensureSeason, seasonXpLeftToday } from '../src/meta/season';
import { TUNING } from '../src/meta/tuning';
import '../src/meta/career';
import '../src/meta/packs';

const OCT = Date.UTC(2026, 9, 22, 12);
const FEB = Date.UTC(2027, 1, 22, 12);

describe('season and the phone clock', () => {
  it('flipping the clock across months keeps the day-s fight xp cap', () => {
    const save = sanitize(freshSave());
    ensureSeason(save, OCT);
    let earned = 0;
    for (let flip = 0; flip < 6; flip++) {
      for (let i = 0; i < 20; i++) addSeasonXp(save, 150, OCT, 'fight');
      earned += save.season.xp;
      ensureSeason(save, FEB);
      ensureSeason(save, OCT);
    }
    // all the fight xp earned in this one real day, across every re-created season, stays within one day's cap
    expect(earned).toBeLessThanOrEqual(TUNING.seasonDayXpCap);
    expect(seasonXpLeftToday(save, OCT)).toBe(0);
  });
});
