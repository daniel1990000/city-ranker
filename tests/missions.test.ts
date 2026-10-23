// Daily missions: the same three for everyone on a day, a new set each day on the reward clock, each mission and the
// all-three bonus paid once, a clock moved back can't pay a day again, and old or broken saves load.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const M = await import('../src/meta/missions');
const { fightFacts } = await import('../src/meta/achievements');
const { freshSave, sanitize, exportCode, importCode } = await import('../src/meta/save');
const { bindClock, rewardTime, unlock } = await import('../src/meta/clock');
const { dayNumber, DAY_MS } = await import('../src/meta/days');
const { applyTuning } = await import('../src/meta/tuning');
const { STARTER_ID } = await import('../src/meta/fighters');

const NOW = new Date(2026, 9, 22, 12).getTime();
const fresh = () => sanitize(freshSave());

function rs(p: Partial<RoundStats> = {}): RoundStats {
  return { thrown: 0, landed: 0, power: 0, defended: 0, headDmg: 0, bodyDmg: 0, legDmg: 0, knockdowns: 0, takedowns: 0, tdAttempts: 0, controlTicks: 0, subAttempts: 0, ...p };
}
function result(p: Partial<FightResult> = {}): FightResult {
  return { winner: 0, method: 'DEC', by: null, stoppage: null, sub: null, decision: 'unanimous', round: 3, roundTick: 0, totalTicks: 10800, cards: [], ...p };
}

/** An event that finishes the given mission. */
function finisher(id: string): import('../src/meta/missions').MissionEvent {
  switch (id) {
    case 'openPack':
      return { kind: 'pack', count: 1 };
    case 'train':
      return { kind: 'train' };
    default: {
      const method = id === 'winSub' ? 'SUB' : id === 'winKo' ? 'KO' : 'DEC';
      return { kind: 'fight', fight: fightFacts(result({ method }), [[rs({ landed: 60, takedowns: 3, knockdowns: 2 }), rs()]], 'mLight', true) };
    }
  }
}

afterEach(() => bindClock(null));

describe('the day\'s missions', () => {
  it('are the same for everyone on a day, three from different groups, and change from day to day', () => {
    const day = dayNumber(NOW);
    expect(M.missionsForDay(day)).toEqual(M.missionsForDay(day));
    const sets = new Set<string>();
    for (let d = day; d < day + 30; d++) {
      const ids = M.missionsForDay(d);
      expect(ids).toHaveLength(M.MISSIONS_PER_DAY);
      const groups = ids.map(id => M.missionDef(id)!.group);
      expect(new Set(groups).size).toBe(M.MISSIONS_PER_DAY);
      sets.add(ids.join());
    }
    expect(sets.size).toBeGreaterThan(10);
    // every mission comes up now and then
    const seen = new Set<string>();
    for (let d = day; d < day + 400; d++) for (const id of M.missionsForDay(d)) seen.add(id);
    expect(seen.size).toBe(M.MISSIONS.length);
  });

  it('a new set starts on the next day, not again on the same day', () => {
    const s = fresh();
    const a = M.ensureMissions(s, NOW);
    expect(a.day).toBe(dayNumber(NOW));
    M.progressMissions(s, { kind: 'train' }, NOW);
    const same = JSON.stringify(s.progress.missions);
    M.ensureMissions(s, NOW + 3600_000);
    expect(JSON.stringify(s.progress.missions)).toBe(same);
    const b = M.ensureMissions(s, NOW + DAY_MS);
    expect(b.day).toBe(dayNumber(NOW) + 1);
    expect(b.paid).toEqual([]);
    expect(b.prog).toEqual([0, 0, 0]);
  });
});

describe('paying', () => {
  it('pays each mission once and the all-three bonus once', () => {
    const s = fresh();
    const ids = M.ensureMissions(s, NOW).ids;
    let cash = 0;
    let bonuses = 0;
    const done: string[] = [];
    for (const [i, id] of ids.entries()) {
      for (let n = 0; n < 5 && !s.progress.missions.paid.includes(i); n++) {
        const p = M.progressMissions(s, finisher(id), NOW);
        done.push(...p.done.map(d => d.id));
        cash += p.cash;
        if (p.bonus) {
          bonuses++;
          expect(p.gems).toBe(10);
        }
      }
    }
    expect(done.sort()).toEqual([...ids].sort());
    expect(bonuses).toBe(1);
    expect(s.cash).toBe(cash);
    expect(s.gems).toBe(10);
    const xp = s.season.xp;
    expect(xp).toBe(3 * 50 + 100);
    // everything again: nothing more
    for (const id of ids) expect(M.progressMissions(s, finisher(id), NOW)).toEqual({ done: [], bonus: false, cash: 0, gems: 0, xp: 0 });
    expect(s.cash).toBe(cash);
    expect(s.gems).toBe(10);
    expect(s.season.xp).toBe(xp);
  });

  it('counts progress across events and caps it at the target', () => {
    const s = fresh();
    s.progress.missions = { v: 1, day: dayNumber(NOW), ids: ['land50', 'win2', 'openPack'], prog: [0, 0, 0], paid: [], bonus: false };
    const hits = (n: number) => ({ kind: 'fight' as const, fight: fightFacts(result({ winner: 1 }), [[rs({ landed: n }), rs()]], 'mLight', false) });
    expect(M.progressMissions(s, hits(30), NOW).done).toEqual([]);
    expect(s.progress.missions.prog[0]).toBe(30);
    expect(M.progressMissions(s, hits(30), NOW).done.map(d => d.id)).toEqual(['land50']);
    expect(s.progress.missions.prog[0]).toBe(50);
    expect(s.cash).toBe(300);
    // a loss doesn't move "Win 2 fights"
    expect(s.progress.missions.prog[1]).toBe(0);
  });

  it('remote tuning changes the amounts within safe ranges', () => {
    applyTuning({ missionCashPct: 200, missionBonusGems: 25 });
    expect(M.missionCash(M.missionDef('land50')!)).toBe(600);
    expect(M.MISSION_TUNING.missionBonusGems).toBe(25);
    applyTuning({ missionCashPct: 0, missionBonusGems: 5000 });
    expect(M.missionCash(M.missionDef('land50')!)).toBe(300);
    expect(M.MISSION_TUNING.missionBonusGems).toBe(10);
    applyTuning({});
  });
});

describe('the reward clock', () => {
  it('a phone clock moved back can\'t reopen a day or pay twice', () => {
    const s = fresh();
    bindClock(s);
    rewardTime(NOW);
    const ids = M.ensureMissions(s, NOW).ids;
    for (const id of ids) for (let n = 0; n < 5; n++) M.progressMissions(s, finisher(id), NOW);
    expect(s.progress.missions.bonus).toBe(true);
    const cash = s.cash;
    // forward a day: a new set
    expect(M.ensureMissions(s, NOW + DAY_MS).day).toBe(dayNumber(NOW) + 1);
    const day2 = M.ensureMissions(s, NOW + DAY_MS).ids;
    M.progressMissions(s, finisher(day2[0]), NOW + DAY_MS);
    const cash2 = s.cash;
    const gems = s.gems;
    // back two days: still day 2, its finished mission stays paid, and day 1 doesn't come back
    expect(M.ensureMissions(s, NOW - DAY_MS).day).toBe(dayNumber(NOW) + 1);
    M.progressMissions(s, finisher(day2[0]), NOW - DAY_MS);
    expect(s.cash).toBe(cash2);
    expect(cash2).toBeGreaterThan(cash);
    expect(s.gems).toBe(gems);
  });

  it('missions dated ahead (a save from a phone set ahead) become today\'s when the clock lets go, keeping what was paid', () => {
    const s = fresh();
    const ahead = NOW + 30 * DAY_MS;
    const ids = M.ensureMissions(s, ahead).ids;
    M.progressMissions(s, finisher(ids[0]), ahead);
    const cash = s.cash;
    unlock(s, NOW, dayNumber);
    expect(s.progress.missions.day).toBe(dayNumber(NOW));
    expect(M.ensureMissions(s, NOW).ids).toEqual(ids);
    M.progressMissions(s, finisher(ids[0]), NOW);
    expect(s.cash).toBe(cash);
  });
});

describe('saves', () => {
  it('a save from before missions existed loads with none, and a set starts on the next check', () => {
    const old = sanitize({ v: 1, cash: 100, progress: { career: {} } });
    expect(old.progress.missions).toEqual(M.freshMissions());
    expect(M.ensureMissions(old, NOW).ids).toHaveLength(3);
  });

  it('missions survive a save code, and the sanitiser is idempotent and strict', () => {
    const s = fresh();
    M.ensureMissions(s, NOW);
    M.progressMissions(s, { kind: 'train' }, NOW);
    const back = importCode(exportCode(s))!;
    expect(back.progress.missions).toEqual(s.progress.missions);
    for (const raw of [undefined, 'x', { day: 5 }, { day: 5, ids: ['a', 3], prog: [1, 1] }, { day: 5, ids: ['a', 'b'], prog: [1] }, { day: 7, ids: ['a', 'b'], prog: [1, 2], paid: [0, 9, 0], bonus: 'yes' }]) {
      const once = M.sanitizeMissions(raw);
      expect(M.sanitizeMissions(once)).toEqual(once);
    }
    expect(M.sanitizeMissions({ day: 7, ids: ['a', 'b'], prog: [1, 2], paid: [0, 9, 0], bonus: 'yes' })).toEqual({ v: 1, day: 7, ids: ['a', 'b'], prog: [1, 2], paid: [0], bonus: false });
  });

  it('a broken set keeps its day with nothing to pay, so that day can\'t pay again', () => {
    const s = fresh();
    s.progress.missions = M.sanitizeMissions({ day: dayNumber(NOW), ids: ['land50', 7], prog: [0, 0] });
    expect(M.ensureMissions(s, NOW).ids).toEqual([]);
    expect(M.progressMissions(s, { kind: 'train' }, NOW).cash).toBe(0);
    expect(M.ensureMissions(s, NOW + DAY_MS).ids).toHaveLength(3);
  });
});

describe('Game wiring', () => {
  beforeEach(() => store.clear());

  it('fights, packs and training move the missions on', () => {
    const g = new Game();
    const today = g.missions();
    expect(today.list).toHaveLength(3);
    g.save.progress.missions = { v: 1, day: g.save.progress.missions.day, ids: ['fights3', 'openPack', 'train'], prog: [0, 0, 0], paid: [], bonus: false };
    const opp = g.spec(STARTER_ID)!;
    for (let i = 0; i < 3; i++) g.finishFight(STARTER_ID, result({ winner: 1 }), 300, null, opp, 300, [[rs(), rs({ landed: 5 })]]);
    expect(g.missions().list[0].done).toBe(true);
    const pack = g.openEarned('standard');
    expect(pack.ok && pack.earned.missions?.done.map(d => d.id)).toEqual(['openPack']);
    g.save.cash = 100000;
    expect(g.train(STARTER_ID, 'power').ok).toBe(true);
    const v = g.missions();
    expect(v.list.every(m => m.done)).toBe(true);
    expect(v.bonus).toBe(true);
  });
});
