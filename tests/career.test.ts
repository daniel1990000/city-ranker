// After the title (audit F11): defences stop getting harder at a fair ceiling, super fights (one a day) between
// defences, the Legacy track, Prestige re-runs, moving up or down a weight class, and old careers loading.
import { describe, expect, it } from 'vitest';
import {
  applyCareerResult, careerReward, DEFENSE_DIFFICULTY, freshCareer, LEGACY, legacyRank, MAX_PRESTIGE, moveDivision, neighbourDivisions, nextStep, prestigeUp,
  sanitizeCareer, TIERS, weightClassStats, type CareerState,
} from '../src/meta/career';
import { overall, rosterOf } from '../src/meta/roster';

const DAY = 20000;

function champion(div: 'mLight' | 'mWelter' = 'mLight'): CareerState {
  const c = freshCareer();
  c.div[div].tier = TIERS;
  const t = nextStep(c, div, 'x', DAY);
  expect(t.kind).toBe('title');
  applyCareerResult(c, t, true, false, 'DEC');
  expect(c.div[div].belt).toBe(true);
  return c;
}

describe('title defences', () => {
  it('stop getting harder at a fair ceiling, never above the title fight', () => {
    const fresh = freshCareer();
    fresh.div.mLight.tier = TIERS;
    const title = nextStep(fresh, 'mLight', 'x');
    const c = champion();
    for (let i = 0; i < 60; i++) {
      const d = nextStep(c, 'mLight', 'x', DAY + i);
      applyCareerResult(c, d, true, false, 'DEC');
      if (d.kind === 'super') continue;
      expect(d.kind).toBe('defense');
      expect(d.difficulty).toBeLessThanOrEqual(DEFENSE_DIFFICULTY.max);
      expect(d.difficulty).toBeLessThan(title.difficulty);
      expect(overall(d.opponent.stats)).toBeLessThanOrEqual(overall(title.opponent.stats));
    }
    expect(c.div.mLight.defenses).toBeGreaterThan(20);
    // even at the top Prestige the cap holds
    c.div.mLight.prestige = MAX_PRESTIGE;
    expect(nextStep(c, 'mLight', 'x', DAY).difficulty).toBeLessThanOrEqual(DEFENSE_DIFFICULTY.cap);
  });

  it('winning a lost belt back is a fair fight, not the first title again', () => {
    const c = champion();
    const fresh = freshCareer();
    fresh.div.mLight.tier = TIERS;
    const first = nextStep(fresh, 'mLight', 'x');
    applyCareerResult(c, nextStep(c, 'mLight', 'x', DAY), false, false, 'KO');
    expect(c.div.mLight.belt).toBe(false);
    const back = nextStep(c, 'mLight', 'x', DAY);
    expect(back.kind).toBe('title');
    expect(back.firstTitle).toBe(false);
    expect(back.difficulty).toBeLessThan(first.difficulty);
  });
});

describe('super fights', () => {
  it('come after a defence, one a day per division, pay well, and never cost the belt', () => {
    const c = champion();
    const d = nextStep(c, 'mLight', 'x', DAY);
    applyCareerResult(c, d, true, false, 'DEC');
    const s = nextStep(c, 'mLight', 'x', DAY);
    expect(s.kind).toBe('super');
    expect(s.rules.title).toBeFalsy();
    const pay = careerReward(s, true, false, 'DEC');
    expect(pay.cash).toBeGreaterThan(careerReward(d, true, false, 'DEC').cash);
    expect(pay.gems).toBeGreaterThan(0);
    expect(careerReward(s, true, false, 'KO').cash).toBeGreaterThan(pay.cash);
    // lost: the belt stays, and today's super fight is spent
    applyCareerResult(c, s, false, false, 'KO');
    expect(c.div.mLight.belt).toBe(true);
    expect(nextStep(c, 'mLight', 'x', DAY).kind).toBe('defense');
    applyCareerResult(c, nextStep(c, 'mLight', 'x', DAY), true, false, 'DEC');
    expect(nextStep(c, 'mLight', 'x', DAY).kind).toBe('defense'); // still today
    expect(nextStep(c, 'mLight', 'x', DAY + 1).kind).toBe('super'); // tomorrow
    // a step made for another day is stale
    const tomorrow = nextStep(c, 'mLight', 'x', DAY + 1);
    expect(applyCareerResult(c, { ...tomorrow, day: DAY }, true, false, 'DEC')).toBe(false);
  });
});

describe('legacy', () => {
  it('each rank pays once, as the defences reach it', () => {
    const c = champion();
    const paid: number[] = [];
    for (let i = 0; i < 25; i++) {
      const d = nextStep(c, 'mLight', 'x', 1e8);
      const r = careerReward(d, true, false, 'DEC');
      paid.push(...r.legacy);
      applyCareerResult(c, d, true, false, 'DEC');
      if (d.kind === 'defense') expect(r.legacy.length).toBe(legacyRank(c.div.mLight.defenses) - legacyRank(c.div.mLight.defenses - 1));
    }
    expect(paid).toEqual(LEGACY.map((_, i) => i).filter(i => LEGACY[i].at <= c.div.mLight.defenses));
    expect(c.div.mLight.legacyPaid).toBe(legacyRank(c.div.mLight.defenses));
  });
});

describe('prestige', () => {
  it('vacates the belt and re-runs a tougher, better paid ladder, up to Prestige 5', () => {
    const c = champion();
    const before = nextStep(freshCareer(), 'mLight', 'x');
    expect(prestigeUp(c, 'mLight')).toBe(true);
    const m = c.div.mLight;
    expect(m.belt).toBe(false);
    expect([m.tier, m.fight, m.prestige, m.titles]).toEqual([0, 0, 1, 1]);
    const p1 = nextStep(c, 'mLight', 'x');
    expect(p1.difficulty).toBeGreaterThan(before.difficulty);
    expect(overall(p1.opponent.stats)).toBeGreaterThan(overall(before.opponent.stats));
    expect(careerReward(p1, true, false, 'DEC').cash).toBeGreaterThan(careerReward(before, true, false, 'DEC').cash);
    expect(prestigeUp(c, 'mLight')).toBe(false); // only a champion can
    // the Prestige title pays its prize once
    m.tier = TIERS;
    const t = nextStep(c, 'mLight', 'x');
    expect(t.prestigeTitle).toBe(true);
    const prize = careerReward(t, true, false, 'DEC');
    expect(prize.gems).toBeGreaterThan(30);
    expect(prize.pack).toBe('premium');
    applyCareerResult(c, t, true, false, 'DEC');
    applyCareerResult(c, nextStep(c, 'mLight', 'x', DAY), false, false, 'KO');
    expect(nextStep(c, 'mLight', 'x').prestigeTitle).toBe(false);
    for (let i = 0; i < 10; i++) {
      m.tier = TIERS;
      m.belt = true;
      prestigeUp(c, 'mLight');
    }
    expect(m.prestige).toBe(MAX_PRESTIGE);
    // opponents stay inside the stat range
    for (const st of [nextStep(c, 'mLight', 'x')]) for (const v of Object.values(st.opponent.stats)) expect(v).toBeLessThanOrEqual(99);
  });
});

describe('moving weight class', () => {
  it('only a champion, only to a neighbouring class of the same sex; the new ladder starts at Contender', () => {
    expect(neighbourDivisions('mLight')).toEqual(['mWelter']);
    expect(neighbourDivisions('mHeavy')).toEqual(['mMiddle']);
    expect(neighbourDivisions('wStraw')).toEqual(['wBantam']);
    const me = rosterOf('mLight')[0].id;
    const c = freshCareer();
    expect(moveDivision(c, 'mLight', 'mWelter', me)).toBe(false);
    const ch = champion();
    expect(moveDivision(ch, 'mLight', 'mHeavy', me)).toBe(false);
    expect(moveDivision(ch, 'mLight', 'wStraw', me)).toBe(false);
    expect(moveDivision(ch, 'mLight', 'mWelter', rosterOf('mWelter')[0].id)).toBe(false);
    expect(moveDivision(ch, 'mLight', 'mWelter', me)).toBe(true);
    expect(ch.div.mWelter.guest).toBe(me);
    expect(ch.div.mWelter.tier).toBe(3);
    expect(ch.div.mLight.belt).toBe(true);
    // a title there makes a two-division champion
    ch.div.mWelter.tier = TIERS;
    const t = nextStep(ch, 'mWelter', me);
    expect(t.champElsewhere).toBe(true);
    expect(careerReward(t, true, false, 'DEC').cash).toBeGreaterThan(careerReward({ ...t, champElsewhere: false }, true, false, 'DEC').cash);
    // the guest survives a reload; a bad one is dropped
    expect(sanitizeCareer(JSON.parse(JSON.stringify(ch))).div.mWelter.guest).toBe(me);
    const bad = JSON.parse(JSON.stringify(ch)) as CareerState;
    bad.div.mHeavy.guest = me;
    expect(sanitizeCareer(bad).div.mHeavy.guest).toBe('');
  });

  it('size changes the stats a little', () => {
    const s = rosterOf('mLight')[0].stats;
    const up = weightClassStats(s, 'mLight', 'mWelter');
    expect(up.power).toBeLessThan(s.power);
    const down = weightClassStats(rosterOf('mWelter')[0].stats, 'mWelter', 'mLight');
    expect(down.cardio).toBeLessThan(rosterOf('mWelter')[0].stats.cardio);
    expect(weightClassStats(s, 'mLight', 'mLight')).toEqual(s);
  });
});

describe('old careers', () => {
  it('a version 1 champion loads: its defences become the reign, its Legacy is paid at the next defence', () => {
    const v1 = { v: 1, div: { mLight: { tier: 5, fight: 0, belt: true, defenses: 4, titles: 1, wins: 60, losses: 9, draws: 0, kos: 20, subs: 3 } } };
    const c = sanitizeCareer(v1);
    const m = c.div.mLight;
    expect(c.v).toBe(2);
    expect([m.belt, m.reign, m.prestige, m.peak, m.legacyPaid, m.superDue, m.guest]).toEqual([true, 4, 0, 0, 0, false, '']);
    expect(sanitizeCareer(JSON.parse(JSON.stringify(c)))).toEqual(c);
    const d = nextStep(c, 'mLight', 'x', DAY);
    expect(d.kind).toBe('defense');
    // the 5th defence: ranks at 1, 3 and 5 defences, one pack (the best of them)
    expect(d.legacy).toEqual([0, 1, 2]);
    const r = careerReward(d, true, false, 'DEC');
    expect(r.legacy).toEqual([0, 1, 2]);
    expect(r.pack).toBe('premium');
    applyCareerResult(c, d, true, false, 'DEC');
    expect(m.legacyPaid).toBe(3);
    // junk stays in range
    const j = sanitizeCareer({ v: 2, div: { mLight: { tier: 2, prestige: 99, peak: 7, reign: 5, superDue: true, guest: 'nobody' } } }).div.mLight;
    expect([j.prestige, j.peak, j.reign, j.superDue, j.guest]).toEqual([MAX_PRESTIGE, -1, 0, false, '']);
  });
});
