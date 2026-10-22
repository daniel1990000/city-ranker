// The weekly tournament (src/meta/tournament.ts, Game.tournament...): the same bracket for everyone in a week, a
// deterministic score, limited entries, prizes once a week (a clock moved back can't pay them again), old saves load.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshSave, sanitize, type SaveData } from '../src/meta/save';
import {
  adEntryOffered, applyTourResult, bracket, claimTourTier, enterTournament, entriesLeft, grantAdEntry, loanerFor, markLive, nextTourStep, opponentSlot,
  ROUNDS, runActive, sanitizeTournament, syncTournament, tourFightScore, tourTiers, weekDivision, LOANER_LEVEL, type TourFightInput,
} from '../src/meta/tournament';
import { weekId } from '../src/meta/weekly';
import { overall, rosterFighter } from '../src/meta/roster';
import '../src/meta/career';
import '../src/meta/fighters';
import '../src/meta/packs';

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

const posted = vi.hoisted(() => [] as [string, number][]);
vi.mock('../src/platform/games', () => ({
  submitScore: (board: string, v: number) => void posted.push([board, v]),
  showBoards: () => Promise.resolve(false),
  gamesSignedIn: () => false,
  syncAchievements: () => {},
}));

/** Wednesday 21 October 2026 noon UTC: week 2026-W43. */
const NOW = Date.UTC(2026, 9, 21, 12);
const DAY = 86400000;
const TODAY = 20000;

function save(): SaveData {
  return sanitize(freshSave());
}

const win = (o: Partial<TourFightInput> = {}): TourFightInput => ({ won: true, method: 'DEC', ticks: 13500, maxTicks: 13500, damageTaken: 20000, round: 0, ...o });

describe('bracket', () => {
  it('is the same for everyone in a week, and changes with the week', () => {
    const w = weekId(NOW);
    expect(w).toBe('2026-W43');
    expect(bracket(w)).toEqual(bracket(w));
    expect(JSON.stringify(bracket(w))).toBe(JSON.stringify(bracket('2026-W43')));
    expect(bracket('2026-W44').field[0].name === bracket(w).field[0].name && bracket('2026-W44').div === bracket(w).div).toBe(false);
    const b = bracket(w);
    expect(b.field).toHaveLength(7);
    for (const f of b.field) {
      expect(f.division).toBe(b.div);
      expect(rosterFighter(f.id)).toBeUndefined(); // original generated fighters, never the player's own card
    }
    expect(loanerFor(w)).toEqual(loanerFor(w));
    expect(loanerFor(w).division).toBe(weekDivision(w));
  });

  it('opponents get stronger round by round and come from the bracket', () => {
    const b = bracket('2026-W43');
    const slots = [0, 1, 2].map(r => opponentSlot(b, r));
    expect(slots[0]).toBe(1);
    expect([2, 3]).toContain(slots[1]);
    expect([4, 5, 6, 7]).toContain(slots[2]);
    const ovr = slots.map(s => overall(b.field[s - 1].stats));
    expect(ovr[2]).toBeGreaterThanOrEqual(ovr[0]);
  });
});

describe('score', () => {
  it('is a whole number decided by the result only', () => {
    expect(tourFightScore(win())).toBe(tourFightScore(win()));
    expect(Number.isInteger(tourFightScore(win({ method: 'KO', ticks: 1234, damageTaken: 7777 })))).toBe(true);
    expect(tourFightScore(win({ won: false, method: 'KO' }))).toBe(0);
  });

  it('pays for finishes, speed, damage avoided and later rounds', () => {
    expect(tourFightScore(win({ method: 'KO', ticks: 9000 }))).toBeGreaterThan(tourFightScore(win()));
    expect(tourFightScore(win({ method: 'KO', ticks: 2000 }))).toBeGreaterThan(tourFightScore(win({ method: 'KO', ticks: 9000 })));
    expect(tourFightScore(win({ damageTaken: 1000 }))).toBeGreaterThan(tourFightScore(win({ damageTaken: 30000 })));
    expect(tourFightScore(win({ round: 2 }))).toBeGreaterThan(tourFightScore(win({ round: 0 })));
    // a decision's length doesn't matter; junk input stays in range
    expect(tourFightScore(win({ ticks: 100 }))).toBe(tourFightScore(win({ ticks: 13000 })));
    expect(tourFightScore(win({ ticks: -5, maxTicks: 0, damageTaken: -1, round: 99 }))).toBeGreaterThan(0);
  });
});

describe('entries', () => {
  it('one free entry a day, one more for an ad, never two runs at once', () => {
    const s = save();
    const t = syncTournament(s, TODAY, NOW);
    expect(t.week).toBe('2026-W43');
    expect(entriesLeft(t)).toBe(1);
    expect(adEntryOffered(t)).toBe(false);
    expect(enterTournament(s, 'x', true)).toBe(true);
    expect(s.weekly.entries).toBe(1);
    expect(runActive(t)).toBe(true);
    expect(enterTournament(s, 'x', true)).toBe(false);
    // knocked out in the quarter-final
    const step = nextTourStep(t)!;
    applyTourResult(s, step, { won: false, method: 'KO', ticks: 600, maxTicks: 13500, damageTaken: 9000 });
    expect(runActive(t)).toBe(false);
    expect(enterTournament(s, 'x', true)).toBe(false);
    expect(adEntryOffered(t)).toBe(true);
    expect(grantAdEntry(t)).toBe(true);
    expect(grantAdEntry(t)).toBe(false);
    expect(enterTournament(s, 'x', true)).toBe(true);
    applyTourResult(s, nextTourStep(t)!, { won: false, method: 'DEC', ticks: 13500, maxTicks: 13500, damageTaken: 9000 });
    expect(entriesLeft(t)).toBe(0);
    expect(adEntryOffered(t)).toBe(false);
    expect(enterTournament(s, 'x', true)).toBe(false);
    // a clock moved back a day gives nothing back; the next day does
    syncTournament(s, TODAY - 1, NOW);
    expect(entriesLeft(t)).toBe(0);
    syncTournament(s, TODAY + 1, NOW + DAY);
    expect(entriesLeft(t)).toBe(1);
  });

  it('a run: three wins make a champion, points add up, the week keeps the best', () => {
    const s = save();
    const t = syncTournament(s, TODAY, NOW);
    enterTournament(s, 'x', true);
    let total = 0;
    for (let r = 0; r < ROUNDS; r++) {
      const st = nextTourStep(t)!;
      expect(st.round).toBe(r);
      const o = applyTourResult(s, st, { won: true, method: 'TKO', ticks: 3000, maxTicks: 13500, damageTaken: 5000 })!;
      total += o.score;
      // the same result twice (a stale step) records nothing
      expect(applyTourResult(s, st, { won: true, method: 'TKO', ticks: 3000, maxTicks: 13500, damageTaken: 5000 })).toBeNull();
      if (r === ROUNDS - 1) {
        expect(o.champion).toBe(true);
        expect(o.total).toBeGreaterThan(total);
      }
    }
    expect(nextTourStep(t)).toBeNull();
    expect(t.bestRound).toBe(ROUNDS);
    expect(s.weekly.best).toBe(t.run!.score);
  });

  it('closing the app during a fight counts as a loss', () => {
    const s = save();
    const t = syncTournament(s, TODAY, NOW);
    enterTournament(s, 'x', true);
    markLive(t);
    const back = sanitize(JSON.parse(JSON.stringify(s)));
    const t2 = syncTournament(back, TODAY, NOW);
    expect(runActive(t2)).toBe(false);
    expect(t2.run!.fights.map(f => f.r)).toEqual(['L']);
  });

  it('a new week starts a new bracket and clears the run', () => {
    const s = save();
    const t = syncTournament(s, TODAY, NOW);
    enterTournament(s, 'x', true);
    syncTournament(s, TODAY + 7, NOW + 7 * DAY);
    expect(t.week).toBe('2026-W44');
    expect(t.run).toBeNull();
    expect(s.weekly.entries).toBe(0);
  });
});

describe('prizes', () => {
  it('each tier pays once a week, only when reached', () => {
    const s = save();
    syncTournament(s, TODAY, NOW);
    expect(claimTourTier(s, 0, NOW)).toBeNull(); // not entered yet
    enterTournament(s, 'x', true);
    expect(claimTourTier(s, 0, NOW)?.cash).toBeGreaterThan(0);
    expect(claimTourTier(s, 0, NOW)).toBeNull();
    expect(claimTourTier(s, 1, NOW)).toBeNull();
    s.weekly.best = 99999;
    for (const t of tourTiers().slice(1)) expect(claimTourTier(s, t.tier, NOW)).not.toBeNull();
    for (const t of tourTiers()) expect(claimTourTier(s, t.tier, NOW)).toBeNull();
    expect(claimTourTier(s, 42, NOW)).toBeNull();
    // next week: again
    syncTournament(s, TODAY + 7, NOW + 7 * DAY);
    s.weekly.entries = 1;
    expect(claimTourTier(s, 0, NOW + 7 * DAY)).not.toBeNull();
  });

  it('a clock moved back can not pay a week again', () => {
    const s = save();
    syncTournament(s, TODAY, NOW + 7 * DAY); // week 44 first (a clock set ahead)
    enterTournament(s, 'x', true);
    s.weekly.best = 99999;
    for (const t of tourTiers()) expect(claimTourTier(s, t.tier, NOW + 7 * DAY)).not.toBeNull();
    // back to week 43: the save stays on week 44 and its claims
    syncTournament(s, TODAY, NOW);
    expect(s.weekly.id).toBe('2026-W44');
    for (const t of tourTiers()) expect(claimTourTier(s, t.tier, NOW)).toBeNull();
  });

  it('prize tiers rise and include cash, gems and packs', () => {
    const t = tourTiers();
    for (let i = 2; i < t.length; i++) expect(t[i].points).toBeGreaterThan(t[i - 1].points);
    expect(t.some(x => x.pack === 'standard')).toBe(true);
    expect(t.some(x => x.pack === 'premium')).toBe(true);
    expect(t.some(x => x.gems > 0)).toBe(true);
  });
});

describe('saves', () => {
  it('an old save without the tournament slot loads, and junk is cleaned', () => {
    const old = JSON.parse(JSON.stringify(save())) as Record<string, unknown>;
    delete (old.progress as Record<string, unknown>).tournament;
    const s = sanitize(old);
    expect(s.progress.tournament).toEqual({ v: 1, week: '', day: -1, used: 0, extra: 0, run: null, bestRound: 0 });
    const junk = sanitizeTournament({ week: 'nope', used: 99, extra: -4, run: { fighter: 5 } });
    expect(junk.week).toBe('');
    expect(junk.used).toBe(2);
    expect(junk.extra).toBe(0);
    expect(junk.run).toBeNull();
    const x = { v: 1, week: '2026-W43', day: 5, used: 1, extra: 1, bestRound: 2, run: { round: 9, score: -3, fighter: 'a', loaner: 'yes', out: false, live: true, fights: [{ r: 'Q', m: 'X', sc: 1.5 }] } };
    const a = sanitizeTournament(x);
    expect(a.run!.round).toBe(ROUNDS);
    expect(a.run!.live).toBe(false);
    expect(sanitizeTournament(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });
});

describe('Game', () => {
  beforeEach(() => {
    store.clear();
    posted.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  it('enters with a loaner when the player has no fighter in the week division, fights, posts the run', async () => {
    const { Game } = await import('../src/app/game');
    const g = new Game();
    const v = g.tournament();
    const owned = g.ownedIn(v.bracket.div);
    expect(v.loaner).toBe(owned.length === 0);
    if (v.loaner) {
      expect(rosterFighter(v.fighter.id)?.division).toBe(v.bracket.div);
      expect(overall(v.fighter.stats)).toBeGreaterThan(0);
      expect(LOANER_LEVEL).toBeGreaterThan(1);
    }
    expect(g.enterTournament()).toBe(true);
    const st = g.startTournamentFight()!;
    expect(st.step.round).toBe(0);
    const result = { winner: 0 as const, method: 'KO' as const, by: null, stoppage: null, sub: null, decision: null, round: 1, roundTick: 1800, totalTicks: 1800, cards: [] };
    const r = g.finishFight(st.me.id, result, 30, null, st.step.opponent, st.step.difficulty, { step: st.step, ticks: 1800, maxTicks: 13500, damageTaken: 2000 });
    expect(r.tournament?.score).toBeGreaterThan(1000);
    expect(g.save.weekly.best).toBe(r.tournament!.total);
    expect(g.save.progress.tournament.run!.live).toBe(false);
    expect(posted).toContainEqual(['tournament', r.tournament!.total]);
    expect(g.save.fightLog.at(-1)?.k).toBe('tournament');
    // the free entry is used, and the run is still going
    expect(g.tournament().entriesLeft).toBe(0);
    expect(g.tournament().step?.round).toBe(1);
    vi.useRealTimers();
  });
});
