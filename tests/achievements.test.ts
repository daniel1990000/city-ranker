// Achievements: each one is awarded and paid once only, the totals stay inside the economy budget, fight facts come
// from the round stats, bundle-only fighters never count, old saves load, and the Game awards them after fights.
import { beforeEach, describe, expect, it } from 'vitest';
import type { FightResult, RoundStats } from '../src/game/fight/types';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const { Game } = await import('../src/app/game');
const A = await import('../src/meta/achievements');
const { freshSave, sanitize } = await import('../src/meta/save');
const { BUNDLE_FIGHTERS, giveCard, syncBundles, STARTER_ID } = await import('../src/meta/fighters');
const { ROSTER } = await import('../src/meta/roster');
const { CONFIG } = await import('../src/platform/config');
const { applyTuning } = await import('../src/meta/tuning');

const NOW = Date.UTC(2026, 9, 22, 12);

function rs(p: Partial<RoundStats> = {}): RoundStats {
  return { thrown: 0, landed: 0, power: 0, defended: 0, headDmg: 0, bodyDmg: 0, legDmg: 0, knockdowns: 0, takedowns: 0, tdAttempts: 0, controlTicks: 0, subAttempts: 0, ...p };
}
function result(p: Partial<FightResult> = {}): FightResult {
  return { winner: 0, method: 'DEC', by: null, stoppage: null, sub: null, decision: 'unanimous', round: 3, roundTick: 0, totalTicks: 3 * 180 * 60, cards: [], ...p };
}
const fresh = () => sanitize(freshSave());

describe('achievement list', () => {
  it('has about 20 unique, permanent-looking ids, all listed for Play Games', () => {
    expect(A.ACHIEVEMENTS.length).toBeGreaterThanOrEqual(18);
    expect(new Set(A.ACHIEVEMENT_IDS).size).toBe(A.ACHIEVEMENT_IDS.length);
    for (const id of A.ACHIEVEMENT_IDS) {
      expect(id).toMatch(/^[a-zA-Z0-9]{1,40}$/);
      expect(CONFIG.games.achievements).toHaveProperty(id);
    }
  });

  it('pays at most 600 gems in all (docs/ECONOMY.md), with modest cash', () => {
    expect(A.ACHIEVEMENT_TOTALS.gems).toBeLessThanOrEqual(600);
    expect(A.ACHIEVEMENT_TOTALS.cash).toBeLessThanOrEqual(35000);
    expect(A.ACHIEVEMENT_TOTALS).toEqual({ cash: 32000, gems: 545, packs: 2 });
  });

  it('remote tuning scales the rewards, inside its safe range only', () => {
    const a = A.achievement('wins25')!;
    applyTuning({ achievementPct: 200 });
    expect(A.achievementReward(a)).toMatchObject({ cash: 3000, gems: 40 });
    applyTuning({ achievementPct: 5 }); // below the floor: ignored
    expect(A.achievementReward(a)).toMatchObject({ cash: 1500, gems: 20 });
    applyTuning({});
  });
});

describe('fight facts', () => {
  it('adds up the player side and spots flawless rounds and knockdowns taken', () => {
    const f = A.fightFacts(result(), [
      [rs({ landed: 12, takedowns: 1 }), rs({ landed: 0 })],
      [rs({ landed: 20, knockdowns: 1 }), rs({ landed: 3, headDmg: 40, knockdowns: 1 })],
    ], 'mLight', true);
    expect(f).toMatchObject({ won: true, landed: 32, takedowns: 1, knockdowns: 1, knockedDown: 1, flawlessRounds: 1, career: true });
    // too few strikes landed for a flawless round
    expect(A.fightFacts(result(), [[rs({ landed: 9 }), rs()]], 'mLight', false).flawlessRounds).toBe(0);
    // no round stats: nothing that needs them
    expect(A.fightFacts(result(), undefined, 'mLight', false)).toMatchObject({ landed: 0, flawlessRounds: 0 });
  });
});

describe('awarding', () => {
  it('is pure when checking, and awards and pays each achievement once only', () => {
    const s = fresh();
    s.wins = 1;
    s.fights = 1;
    const ids = A.checkAchievements(s);
    expect(ids).toContain('firstWin');
    expect(s.achievements).toEqual({});
    expect(s.cash).toBe(0);
    const got = A.awardAchievements(s, ids, NOW);
    expect(got.map(a => a.id)).toEqual(ids);
    expect(s.achievements.firstWin).toBe(NOW);
    const cash = s.cash;
    const gems = s.gems;
    expect(cash).toBeGreaterThan(0);
    // again, directly and through a check: nothing
    expect(A.awardAchievements(s, ['firstWin', 'firstWin', 'notAnAchievement'], NOW + 1)).toEqual([]);
    expect(A.checkAchievements(s)).not.toContain('firstWin');
    expect(A.earnAchievements(s, {}, NOW + 2)).toEqual([]);
    expect(s.cash).toBe(cash);
    expect(s.gems).toBe(gems);
    expect(s.achievements.firstWin).toBe(NOW);
  });

  it('fight achievements: head kick KO, comeback, flawless, decision', () => {
    const s = fresh();
    const ko = A.fightFacts(result({ method: 'KO', by: 'headKick', decision: null }), [[rs({ landed: 10 }), rs({ knockdowns: 1, landed: 5, bodyDmg: 30 })]], 'mLight', false);
    const ids = A.checkAchievements(s, { fight: ko });
    expect(ids).toEqual(expect.arrayContaining(['firstKo', 'headKickKo', 'comeback']));
    expect(ids).not.toContain('flawless');
    expect(ids).not.toContain('firstDecision');
    const clean = A.fightFacts(result(), [[rs({ landed: 15 }), rs()]], 'mLight', false);
    expect(A.checkAchievements(s, { fight: clean })).toEqual(expect.arrayContaining(['firstDecision', 'flawless']));
    // a loss earns none of the win ones
    const lost = A.fightFacts(result({ winner: 1, method: 'KO', by: 'headKick' }), [[rs(), rs({ landed: 10 })]], 'mLight', false);
    expect(A.checkAchievements(s, { fight: lost })).toEqual([]);
  });

  it('"Every Weight" needs a win in each division', () => {
    const s = fresh();
    const divs = ['mLight', 'mWelter', 'mMiddle', 'mHeavy', 'wStraw', 'wBantam'] as const;
    for (const d of divs.slice(0, 5)) A.earnAchievements(s, { fight: A.fightFacts(result(), [], d, false) }, NOW);
    expect(s.achievements.allDivisions).toBeUndefined();
    A.earnAchievements(s, { fight: A.fightFacts(result({ winner: 1 }), [], 'wBantam', false) }, NOW);
    expect(s.achievements.allDivisions).toBeUndefined();
    A.earnAchievements(s, { fight: A.fightFacts(result(), [], 'wBantam', false) }, NOW);
    expect(s.achievements.allDivisions).toBe(NOW);
  });

  it('a fighter only a paid bundle gave does not count toward the collection', () => {
    const s = fresh();
    const bundleFighter = BUNDLE_FIGHTERS.bundle_champion;
    const others = ROSTER.filter(r => r.id !== bundleFighter).slice(0, 9);
    for (const r of others) giveCard(s.progress.fighters, r.id);
    syncBundles(s.progress.fighters, ['bundle_champion']);
    expect(A.ownedCount(s)).toBe(9);
    expect(A.checkAchievements(s)).not.toContain('own10');
  });

  it('the hardest ones give a pack to open', () => {
    const s = fresh();
    s.fights = s.wins = 100;
    A.earnAchievements(s, {}, NOW);
    expect(s.achievements.wins100).toBe(NOW);
    expect(s.progress.packs.unopened.premium).toBe(1);
  });

  it('old saves without the achievement slot load, and the slot sanitiser is idempotent', () => {
    const old = sanitize({ v: 1, wins: 3, fights: 4, achievements: { firstWin: NOW, junk: 'x' } });
    expect(old.progress.feats).toEqual({ v: 1, divWins: [] });
    expect(old.achievements).toEqual({ firstWin: NOW });
    const bad = A.sanitizeFeats({ divWins: ['mLight', 'nope', 'mLight', 3] });
    expect(bad).toEqual({ v: 1, divWins: ['mLight'] });
    expect(A.sanitizeFeats(bad)).toEqual(bad);
    expect(A.sanitizeFeats('junk')).toEqual(A.freshFeats());
  });
});

describe('Game awards achievements', () => {
  beforeEach(() => store.clear());

  it('after a fight: paid once, returned for the result screen, and sent to listeners', () => {
    const g = new Game();
    const heard: string[] = [];
    g.onEarned(e => heard.push(...e.achievements.map(a => a.id)));
    const opp = g.spec(STARTER_ID)!;
    const r = g.finishFight(STARTER_ID, result({ method: 'KO', by: 'headKick', decision: null }), 90, null, opp, 300, [[rs({ landed: 12 }), rs()]]);
    const ids = r.earned.achievements.map(a => a.id);
    expect(ids).toEqual(expect.arrayContaining(['firstWin', 'firstKo', 'headKickKo', 'flawless']));
    expect(heard).toEqual(ids);
    const gems = g.gems;
    const r2 = g.finishFight(STARTER_ID, result({ method: 'KO', by: 'headKick', decision: null }), 90, null, opp, 300, [[rs({ landed: 12 }), rs()]]);
    expect(r2.earned.achievements.map(a => a.id)).not.toContain('firstWin');
    expect(r2.earned.achievements.map(a => a.id)).not.toContain('headKickKo');
    expect(g.gems).toBe(gems + r2.earned.achievements.reduce((n, a) => n + A.achievementReward(a).gems, 0) + (r2.earned.missions?.gems ?? 0));
    // saved: a new launch has them and pays nothing again
    g.flush();
    const again = new Game();
    expect(again.save.achievements.firstWin).toBeGreaterThan(0);
    expect(again.gems).toBe(g.gems);
  });

  it('progress from before achievements existed is awarded at launch and delivered to the first listener', () => {
    const g = new Game();
    g.save.wins = 5;
    g.save.fights = 5;
    g.save.achievements = {};
    g.flush();
    const next = new Game();
    expect(next.save.achievements.wins5).toBeGreaterThan(0);
    const heard: string[] = [];
    next.onEarned(e => heard.push(...e.achievements.map(a => a.id)));
    expect(heard).toEqual(expect.arrayContaining(['firstWin', 'wins5']));
  });
});
