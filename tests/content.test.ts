// Content: the roster, progression, the career ladder and packs.
import { describe, expect, it } from 'vitest';
import { ROSTER, rosterOf, overall } from '../src/meta/roster';
import { DIVISION_IDS } from '../src/meta/divisions';
import { addXp, freshFighters, giveCard, sanitizeFighters, starUp, toFightSpec, xpToNext, STARTER_ID, STAR_COST, MAX_LEVEL } from '../src/meta/fighters';
import { applyCareerResult, careerReward, freshCareer, nextStep, sanitizeCareer, FIGHTS_PER_TIER, TIERS } from '../src/meta/career';
import { freshPacks, oddsText, PACKS, rollPack, sanitizePacks, pityLeft } from '../src/meta/packs';
import { generateName, NAME_POOLS } from '../src/meta/names';

/** Surnames and names of well-known real fighters and boxers: no roster or generated name may use them. */
const FAMOUS = [
  'jones', 'nurmagomedov', 'khabib', 'mcgregor', 'adesanya', 'ngannou', 'usman', 'poirier', 'holloway', 'volkanovski',
  'pereira', 'shevchenko', 'nunes', 'rousey', 'namajunas', 'weili', 'covington', 'masvidal', 'gaethje', 'makhachev',
  'aspinall', 'miocic', 'cormier', 'st-pierre', 'lesnar', 'emelianenko', 'liddell', 'couture', 'silva', 'diaz', 'chimaev',
  'topuria', "o'malley", 'sterling', 'dvalishvili', 'pantoja', 'figueiredo', 'blachowicz', 'prochazka', 'ankalaev',
  'strickland', 'whittaker', 'du plessis', 'grasso', 'holm', 'tate', 'zhang', 'oliveira', 'chandler', 'tyson', 'ali',
  'mayweather', 'pacquiao', 'fury', 'joshua', 'usyk', 'canelo', 'alvarez', 'volkov', 'ruiz', 'mbeki', 'lewis', 'holyfield',
];

describe('roster', () => {
  it('has 48 fighters, 8 per division, 3 common / 3 rare / 1 epic / 1 legend each', () => {
    expect(ROSTER.length).toBe(48);
    for (const d of DIVISION_IDS) {
      const f = rosterOf(d);
      expect(f.length, d).toBe(8);
      const by = (r: string) => f.filter(x => x.rarity === r).length;
      expect([by('common'), by('rare'), by('epic'), by('legend')], d).toEqual([3, 3, 1, 1]);
      for (const x of f) expect(x.lookHints.sex).toBe(d.startsWith('w') ? 'f' : 'm');
    }
  });

  it('ids and names are unique, and no name belongs to a famous real fighter', () => {
    expect(new Set(ROSTER.map(f => f.id)).size).toBe(ROSTER.length);
    expect(new Set(ROSTER.map(f => f.name)).size).toBe(ROSTER.length);
    for (const f of ROSTER) {
      const n = f.name.toLowerCase();
      for (const bad of FAMOUS) expect(n.split(' ').includes(bad) || n.includes(` ${bad}`), `${f.name} ~ ${bad}`).toBe(false);
    }
    for (const last of NAME_POOLS.LAST) expect(FAMOUS.includes(last.toLowerCase()), last).toBe(false);
  });

  it('better rarity means better overall; stats stay in 1..99', () => {
    const avg = (r: string) => {
      const xs = ROSTER.filter(f => f.rarity === r).map(f => overall(f.stats));
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(avg('rare')).toBeGreaterThan(avg('common'));
    expect(avg('epic')).toBeGreaterThan(avg('rare'));
    expect(avg('legend')).toBeGreaterThan(avg('epic'));
    for (const f of ROSTER) for (const v of Object.values(f.stats)) expect(v >= 1 && v <= 99).toBe(true);
  });

  it('generated names are deterministic', () => {
    expect(generateName(5, 'm')).toEqual(generateName(5, 'm'));
  });
});

describe('fighters', () => {
  it('a new card owns the fighter; a duplicate gives shards; shards buy stars', () => {
    const s = freshFighters();
    expect(giveCard(s, STARTER_ID).isNew).toBe(true);
    const dup = giveCard(s, STARTER_ID);
    expect(dup.isNew).toBe(false);
    expect(dup.shards).toBeGreaterThan(0);
    const f = s.owned[STARTER_ID];
    f.shards = STAR_COST[2];
    expect(starUp(f)).toBe(true);
    expect(f.stars).toBe(2);
    expect(f.shards).toBe(0);
  });

  it('levels and stars raise the stats the simulation sees, within 1..100', () => {
    const s = freshFighters();
    giveCard(s, STARTER_ID);
    const base = ROSTER.find(f => f.id === STARTER_ID)!;
    const before = toFightSpec(s.owned[STARTER_ID], base).stats.power;
    addXp(s.owned[STARTER_ID], 1e7);
    expect(s.owned[STARTER_ID].level).toBe(MAX_LEVEL);
    s.owned[STARTER_ID].stars = 5;
    s.owned[STARTER_ID].train = { power: 8 };
    const after = toFightSpec(s.owned[STARTER_ID], base).stats.power;
    expect(after).toBeGreaterThan(before + 15);
    for (const v of Object.values(toFightSpec(s.owned[STARTER_ID], base).stats)) expect(v).toBeLessThanOrEqual(100);
  });

  it('xp curve grows', () => {
    expect(xpToNext(10)).toBeGreaterThan(xpToNext(2));
  });
});

describe('career', () => {
  it('walks every tier, the boss, the title and defences', () => {
    const c = freshCareer();
    let steps = 0;
    while (!c.div.mLight.belt && steps < 100) {
      const st = nextStep(c, 'mLight', STARTER_ID);
      expect(st.opponent.division).toBe('mLight');
      expect(st.opponent.id).not.toBe(STARTER_ID);
      applyCareerResult(c, st, true, false, 'DEC');
      steps++;
    }
    expect(steps).toBe(TIERS * FIGHTS_PER_TIER + 1);
    const d = nextStep(c, 'mLight', STARTER_ID);
    expect(d.kind).toBe('defense');
    expect(d.rules.rounds).toBe(5);
  });

  it('a loss keeps you on the same step; opponents and difficulty grow with the tier', () => {
    const c = freshCareer();
    const s0 = nextStep(c, 'mWelter', 'x');
    applyCareerResult(c, s0, false, false, 'KO');
    expect(nextStep(c, 'mWelter', 'x').fight).toBe(0);
    c.div.mWelter.tier = 4;
    const s4 = nextStep(c, 'mWelter', 'x');
    expect(s4.difficulty).toBeGreaterThan(s0.difficulty);
    expect(overall(s4.opponent.stats)).toBeGreaterThan(overall(s0.opponent.stats));
  });

  it('bosses pay gems and a pack; finishes pay more', () => {
    const c = freshCareer();
    c.div.mLight.fight = FIGHTS_PER_TIER - 1;
    const boss = nextStep(c, 'mLight', 'x');
    expect(boss.kind).toBe('boss');
    const r = careerReward(boss, true, false, 'KO');
    expect(r.gems).toBeGreaterThan(0);
    expect(r.pack).not.toBeNull();
    const fight = nextStep(freshCareer(), 'mLight', 'x');
    expect(careerReward(fight, true, false, 'KO').cash).toBeGreaterThan(careerReward(fight, true, false, 'DEC').cash);
    expect(careerReward(fight, false, false, 'DEC').cash).toBeGreaterThan(0);
  });
});

describe('packs', () => {
  it('odds add up to 100 % and are shown as text', () => {
    for (const p of Object.values(PACKS)) {
      expect(Object.values(p.odds).reduce((a, b) => a + b, 0)).toBe(1000);
      expect(oddsText(p.id).length).toBeGreaterThan(2);
    }
  });

  it('observed rarities match the stated odds', () => {
    const s = freshPacks();
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legend: 0 };
    const N = 6000;
    for (let i = 0; i < N; i++) {
      s.pity.premium = 0; // measure raw odds without the guarantee
      for (const c of rollPack(s, 'premium', i * 7919 + 1).cards) counts[c.rarity]++;
    }
    const total = N * PACKS.premium.cards;
    for (const r of ['common', 'rare', 'epic', 'legend'] as const) {
      expect(Math.abs(counts[r] / total - PACKS.premium.odds[r] / 1000), r).toBeLessThan(0.02);
    }
  });

  it('the pity guarantee always delivers within its window', () => {
    for (const id of ['premium', 'elite'] as const) {
      const s = freshPacks();
      const p = PACKS[id].pity!;
      let since = 0;
      for (let i = 0; i < 3000; i++) {
        const r = rollPack(s, id, i * 31 + 5);
        const hit = r.cards.some(c => ['common', 'rare', 'epic', 'legend'].indexOf(c.rarity) >= ['common', 'rare', 'epic', 'legend'].indexOf(p.at));
        since = hit ? 0 : since + 1;
        expect(since).toBeLessThan(p.within);
      }
      expect(pityLeft(s, id)).toBeGreaterThan(0);
    }
  });

  it('rolls are deterministic', () => {
    expect(rollPack(freshPacks(), 'elite', 42)).toEqual(rollPack(freshPacks(), 'elite', 42));
  });
});

describe('sanitisers survive garbage', () => {
  const junk: unknown[] = [undefined, null, 0, 'x', [], [1, 2], { owned: 5 }, { owned: { nobody: {} } }, { div: { mLight: { tier: 99, fight: -4 } } }, { pity: { premium: 'a' } }, { owned: { [STARTER_ID]: { level: 9999, stars: -3 } } }];
  it('never throws and always returns valid, idempotent data', () => {
    for (const j of junk) {
      const f = sanitizeFighters(j);
      expect(sanitizeFighters(JSON.parse(JSON.stringify(f)))).toEqual(f);
      for (const o of Object.values(f.owned)) {
        expect(o.level).toBeGreaterThanOrEqual(1);
        expect(o.stars).toBeLessThanOrEqual(5);
      }
      const c = sanitizeCareer(j);
      expect(sanitizeCareer(JSON.parse(JSON.stringify(c)))).toEqual(c);
      for (const d of Object.values(c.div)) expect(d.tier).toBeLessThanOrEqual(TIERS);
      const p = sanitizePacks(j);
      expect(sanitizePacks(JSON.parse(JSON.stringify(p)))).toEqual(p);
    }
  });
});
