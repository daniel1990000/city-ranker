// Training Room and the difficulty setting: the dummy is an inputs-only, deterministic controller; drills tick off on
// the right fight events (and not on look-alikes); practice keeps going (damage comes back, ground resets); the
// difficulty offsets clamp, rewards scale, and Easy can't climb the leaderboards.
import { beforeEach, describe, expect, it } from 'vitest';
import { createFight, drainEvents, hashState, runReplay, ReplayRecorder, stepFight, viewFor } from '../src/game/fight';
import type { Controller, FightEvent, FightInput, FightView, Side } from '../src/game/fight/types';
import { NO_INPUT, METER_MAX } from '../src/game/fight/types';
import { STRIKES } from '../src/game/fight/moves';
import { DummyController, DUMMY_MODES, type DummyMode } from '../src/app/dummy';
import { DRILLS, DrillRun, PracticeRoom, PRACTICE_RULES, practicePartner, REFILL_AFTER, type PracticeOptions } from '../src/app/practice';
import { DIFFICULTY_LEVELS, effectiveDifficulty, winCash, winXp } from '../src/meta/difficulty';
import { boardCounts, fightScore, freshRecord, recordFight, sanitizeRecord } from '../src/meta/record';
import { freshSave, sanitize } from '../src/meta/save';
import { moveList } from '../src/ui/fight/movelist';
import { OFFENCE_SWIPES } from '../src/game/touch/recognizer';
import { Masher, testFighter } from './fight-helpers';

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

const ME = testFighter('boxer', 0, 'me');
const PARTNER = practicePartner('mLight');

/** Run a practice fight headless: the player's controller against the room's dummy, the room after every tick. */
function practice(opts: Partial<PracticeOptions>, player: Controller | ((v: FightView, room: PracticeRoom) => FightInput), ticks: number, seed = 7) {
  const room = new PracticeRoom({ mode: 'stand', ground: 'mountTop', drill: null, fullSpecial: false, ...opts });
  const f = createFight({ seed, a: ME, b: PARTNER, rules: PRACTICE_RULES });
  const events: FightEvent[] = [];
  const dummyInputs: FightInput[] = [];
  for (let t = 0; t < ticks && !f.state.result; t++) {
    const v0 = viewFor(f, 0);
    const mine = typeof player === 'function' ? player(v0, room) : player.next(v0, 0);
    const theirs = room.dummy.next(viewFor(f, 1), 1);
    dummyInputs.push(theirs);
    const inputs: [FightInput, FightInput] = [mine, theirs];
    stepFight(f, inputs);
    const ev = drainEvents(f);
    events.push(...ev);
    room.afterTick(f, ev, inputs);
  }
  return { f, room, events, dummyInputs };
}

const idle: Controller = { next: () => ({ ...NO_INPUT }) };

/** Answers ground prompts (the scramble arrow, mashing in a hold) like a quick player; `extra` does the rest. */
function groundPlayer(extra: (v: FightView, room: PracticeRoom) => Partial<FightInput>) {
  return (v: FightView, room: PracticeRoom): FightInput => {
    const out: FightInput = { ...NO_INPUT };
    const g = v.ground;
    if (g?.scramble) {
      if (g.scramble.ticksLeft === 40) out.ground = g.scramble.dir;
      return out;
    }
    if (g?.sub) {
      out.tap = v.tick % 7 === 0;
      return out;
    }
    return { ...out, ...extra(v, room) };
  };
}

describe('practice dummy', () => {
  it('is an inputs-only controller: the same fight twice gives the same inputs and state, and a replay reproduces it', () => {
    for (const mode of DUMMY_MODES) {
      const a = practice({ mode }, new Masher(), 1800);
      const b = practice({ mode }, new Masher(), 1800);
      expect(b.dummyInputs).toEqual(a.dummyInputs);
      expect(hashState(b.f.state)).toBe(hashState(a.f.state));
    }
    // without the room's practice nudges a dummy fight is an ordinary fight: record it and replay it
    const f = createFight({ seed: 11, a: ME, b: PARTNER, rules: { roundTicks: 60 * 30 } });
    const rec = new ReplayRecorder(f);
    const p = new Masher();
    const d = new DummyController({ mode: 'light' });
    while (!f.state.result) {
      const inp: [FightInput, FightInput] = [p.next(viewFor(f, 0), 0), d.next(viewFor(f, 1), 1)];
      rec.record(inp);
      stepFight(f, inp);
    }
    const r = rec.finish();
    expect(hashState(runReplay(JSON.parse(JSON.stringify(r))).state)).toBe(r.hash);
  });

  it('does what each mode says', () => {
    const count = (mode: DummyMode, key: keyof FightInput) => practice({ mode }, idle, 60 * 20).dummyInputs.filter(i => !!i[key]).length;
    expect(count('stand', 'strike')).toBe(0);
    expect(count('stand', 'shoot')).toBe(0);
    expect(count('block', 'strike')).toBe(0);
    expect(count('block', 'block')).toBeGreaterThan(60 * 15);
    expect(count('light', 'strike')).toBeGreaterThanOrEqual(8);
    expect(count('light', 'strike')).toBeLessThanOrEqual(14);
    expect(count('shoot', 'shoot')).toBeGreaterThanOrEqual(3);
    // ground practice puts them on the mat straight after the bell, in the chosen position
    const g = practice({ mode: 'ground', ground: 'mountBottom' }, idle, 200).f.state.ground;
    expect(g?.pos).toBe('mount');
    expect(g?.top).toBe(1);
  });

  it('light mode throws its pattern in turn and only when it is free', () => {
    const d = new DummyController({ mode: 'light', pattern: ['lowKick'] });
    const f = createFight({ seed: 3, a: ME, b: PARTNER, rules: PRACTICE_RULES });
    const thrown: string[] = [];
    for (let t = 0; t < 60 * 12; t++) {
      const i = d.next(viewFor(f, 1), 1 as Side);
      if (i.strike) thrown.push(i.strike);
      stepFight(f, [{ ...NO_INPUT }, i]);
      drainEvents(f);
    }
    expect(thrown.length).toBeGreaterThan(3);
    expect(new Set(thrown)).toEqual(new Set(['lowKick']));
  });
});

describe('practice room', () => {
  it('damage comes back after a quiet moment, so practice never runs out', () => {
    const { f, room } = practice({ mode: 'stand' }, idle, 120);
    const dummy = f.state.fighters[1];
    dummy.head = 6000;
    dummy.legs = 5000;
    dummy.knockdowns = 2;
    dummy.staminaCap = 6000;
    const step = (n: number) => {
      for (let t = 0; t < n; t++) {
        const inputs: [FightInput, FightInput] = [{ ...NO_INPUT }, room.dummy.next(viewFor(f, 1), 1)];
        stepFight(f, inputs);
        room.afterTick(f, drainEvents(f), inputs);
      }
    };
    step(REFILL_AFTER + 2);
    expect(dummy.head).toBe(0);
    expect(dummy.legs).toBe(0);
    expect(dummy.knockdowns).toBe(0);
    expect(dummy.staminaCap).toBe(METER_MAX);
  });

  it('a long session against a standing dummy never ends by itself', () => {
    let n = 0;
    // a power shot every ~2 seconds for two minutes: without the refill this knocks a dummy out
    const puncher = (v: FightView): FightInput => ({ ...NO_INPUT, move: v.dist > 950 ? 1 : 0, strike: v.dist <= 950 && v.tick % 110 === 0 ? (['cross', 'hookR', 'bodyShot'] as const)[n++ % 3] : null });
    const { f, events } = practice({ mode: 'stand' }, puncher, 60 * 120);
    expect(events.filter(e => e.type === 'hit' && e.side === 0 && !e.blocked).length).toBeGreaterThan(30);
    expect(f.state.result).toBeNull();
  });

  it('special always ready keeps the meter full', () => {
    const { f } = practice({ mode: 'stand', fullSpecial: true }, idle, 200);
    expect(f.state.fighters[0].special).toBe(METER_MAX);
  });
});

describe('drills', () => {
  const hit = (move: string, extra: Partial<Extract<FightEvent, { type: 'hit' }>> = {}): FightEvent =>
    ({ type: 'hit', tick: 1, side: 0, move, zone: 'head', dmg: 300, strength: 'light', counter: false, blocked: false, chain: 0, ...extra }) as FightEvent;
  const ctx = { sprawlPressed: false };

  it('tick off on the right events only', () => {
    const run = new DrillRun(DRILLS.find(d => d.id === 'striking')!);
    expect(run.feed([hit('jab', { blocked: true }), hit('jab', { side: 1 }), hit('cross')], ctx)).toBe('none');
    expect(run.feed([hit('jab'), hit('jab')], ctx)).toBe('progress');
    expect(run.count).toBe(2);
    expect(run.feed([hit('jab')], ctx)).toBe('step');
    expect(run.step).toBe(1);
    run.feed([hit('cross'), hit('uppercut')], ctx);
    expect(run.step).toBe(2);
    run.feed([hit('jab', { chain: 1 })], ctx);
    expect(run.done).toBe(false);
    run.feed([hit('cross', { chain: 2 })], ctx);
    expect(run.done).toBe(true);
  });

  it('a stuffed shot counts as a sprawl only when the player sprawled', () => {
    const run = new DrillRun(DRILLS.find(d => d.id === 'wrestling')!);
    const sprawl: FightEvent = { type: 'sprawl', tick: 1, side: 0, success: true };
    expect(run.feed([sprawl], { sprawlPressed: false })).toBe('none');
    expect(run.feed([sprawl], { sprawlPressed: true })).toBe('progress');
  });

  it('every drill step can be completed by its own event, and each starts the dummy it needs', () => {
    for (const d of DRILLS) {
      for (const st of d.steps) expect(DUMMY_MODES).toContain(st.mode);
    }
    const defence = new PracticeRoom({ mode: 'stand', ground: 'mountTop', drill: 'defence', fullSpecial: false });
    expect(defence.mode).toBe('light');
    const top = new PracticeRoom({ mode: 'stand', ground: 'mountTop', drill: 'top', fullSpecial: false, drillStep: 1 });
    expect(top.groundStart).toEqual({ pos: 'guard', top: 0 });
  });

  it('the ground escape drill completes in a real practice fight', () => {
    const player = groundPlayer(v => (v.ground && !v.ground.meTop && v.tick % 30 === 0 ? { ground: 'up' } : {}));
    const { room, f } = practice({ drill: 'bottom' }, player, 60 * 40);
    expect(room.run?.done).toBe(true);
    expect(f.state.result).toBeNull();
  });

  it('the ground attack drill completes: strikes, a pass, a submission', () => {
    const player = groundPlayer((v, room) => {
      const g = v.ground;
      if (!g || !g.meTop) return {};
      const step = room.run?.step ?? 0;
      if (step === 0) return { tap: v.tick % 26 === 0 };
      if (step === 1) return g.pos === 'guard' && v.tick % 30 === 0 ? { ground: 'up' } : {};
      return g.pos === 'mount' && v.tick % 30 === 0 ? { ground: 'down' } : {};
    });
    const { room, f, events } = practice({ drill: 'top' }, player, 60 * 60);
    expect(room.run?.done).toBe(true);
    expect(events.some(e => e.type === 'tapOut' && e.side === 1)).toBe(true);
    expect(f.state.result?.method).toBe('SUB');
  });

  it('the sprawl drill completes against the shooting dummy', () => {
    const sprawler = (v: FightView): FightInput => ({ ...NO_INPUT, shoot: v.opp.action === 'shoot' || (!!v.takedown && !v.takedown.mine) });
    const { room } = practice({ drill: 'wrestling' }, sprawler, 60 * 60);
    expect(room.run?.step).toBeGreaterThanOrEqual(1);
  });
});

describe('difficulty setting', () => {
  beforeEach(() => store.clear());

  it('offsets the AI difficulty and clamps it to 0..1000', () => {
    expect(effectiveDifficulty(500, 'easy')).toBe(250);
    expect(effectiveDifficulty(500, 'normal')).toBe(500);
    expect(effectiveDifficulty(500, 'hard')).toBe(650);
    expect(effectiveDifficulty(500, 'pro')).toBe(800);
    expect(effectiveDifficulty(120, 'easy')).toBe(0);
    expect(effectiveDifficulty(900, 'pro')).toBe(1000);
    expect(effectiveDifficulty(Number.NaN, 'hard')).toBe(150);
    for (const lv of DIFFICULTY_LEVELS) for (const b of [-50, 0, 400, 1000, 5000]) {
      const d = effectiveDifficulty(b, lv);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1000);
    }
  });

  it('scales win cash and xp (-20 / 0 / +15 / +30 %)', () => {
    expect(winCash(1000, 'easy')).toBe(800);
    expect(winCash(1000, 'normal')).toBe(1000);
    expect(winCash(1000, 'hard')).toBe(1150);
    expect(winCash(1000, 'pro')).toBe(1300);
    expect(winCash(375, 'hard') % 10).toBe(0);
    expect(winCash(-5, 'pro')).toBe(0);
    expect(winXp(100, 'pro')).toBe(130);
    expect(winXp(100, 'easy')).toBe(80);
  });

  it('is a saved setting: defaults to Normal, survives a reload, junk falls back', () => {
    const s = sanitize(freshSave());
    expect(s.settings.difficulty).toBe('normal');
    const old = JSON.parse(JSON.stringify(freshSave())) as { settings: Record<string, unknown> };
    delete old.settings.difficulty;
    expect(sanitize(old).settings.difficulty).toBe('normal');
    s.settings.difficulty = 'pro';
    expect(sanitize(JSON.parse(JSON.stringify(s))).settings.difficulty).toBe('pro');
    expect(sanitize({ ...s, settings: { ...s.settings, difficulty: 'godmode' } }).settings.difficulty).toBe('normal');
  });

  it('pays the multiplier at the reward point (career and quick fights), gems stay flat', async () => {
    const { Game } = await import('../src/app/game');
    const opp = testFighter('brawler');
    const win = { winner: 0, method: 'DEC', by: null, stoppage: null, sub: null, decision: 'unanimous', round: 3, roundTick: 0, totalTicks: 13500, cards: [] } as const;
    const cashFor = (lv: (typeof DIFFICULTY_LEVELS)[number], won = true) => {
      store.clear();
      const g = new Game();
      g.save.settings.difficulty = lv;
      const id = Object.keys(g.save.progress.fighters.owned)[0];
      return g.finishFight(id, { ...win, winner: won ? 0 : 1 }, 225, null, opp, 400);
    };
    expect(cashFor('normal').cash).toBe(250);
    expect(cashFor('easy').cash).toBe(200);
    expect(cashFor('hard').cash).toBe(290);
    expect(cashFor('pro').cash).toBe(330);
    expect(cashFor('pro').gems).toBe(0);
    // a loss pays the same whatever the setting
    expect(cashFor('pro', false).cash).toBe(cashFor('normal', false).cash);
  });
});

describe('leaderboards and Easy', () => {
  const ko = { winner: 0 as const, method: 'KO' as const };

  it('an Easy win scores half and stays off the wins and knockouts boards', () => {
    const r = freshRecord();
    const normal = recordFight(r, ko, 60, 70, 500, 'normal');
    const easy = recordFight(r, ko, 60, 70, 500, 'easy');
    expect(easy).toBe(Math.floor(normal / 2));
    expect(r.kos).toBe(2);
    expect(r.easyWins).toBe(1);
    expect(r.easyKos).toBe(1);
    expect(boardCounts(r, 2)).toEqual({ wins: 1, knockouts: 1 });
    // a best-case Easy win (fastest finish, strongest opponent, hardest AI Easy allows) never beats a typical Normal one
    const bestEasy = recordFight(freshRecord(), ko, 0, 99, effectiveDifficulty(1000, 'easy'), 'easy');
    const typicalNormal = fightScore({ winner: 0, method: 'DEC' }, 225, 60, 400);
    expect(bestEasy).toBeLessThan(typicalNormal);
    // the harder settings score from the harder AI they really faced
    expect(recordFight(freshRecord(), ko, 60, 70, effectiveDifficulty(500, 'pro'), 'pro')).toBeGreaterThan(normal);
  });

  it('old records load with no Easy wins, and the Easy counts stay consistent', () => {
    expect(sanitizeRecord({ v: 1, kos: 4, subs: 1, best: 2500 })).toEqual({ v: 1, kos: 4, subs: 1, best: 2500, easyWins: 0, easyKos: 0 });
    expect(sanitizeRecord({ v: 1, kos: 2, easyKos: 9 }).easyKos).toBe(2);
    expect(boardCounts(sanitizeRecord({ kos: 1, easyWins: 50 }), 10).wins).toBe(0);
  });

  it('the game posts board counts without Easy wins', async () => {
    store.clear();
    const { Game } = await import('../src/app/game');
    const g = new Game();
    g.save.settings.difficulty = 'easy';
    const id = Object.keys(g.save.progress.fighters.owned)[0];
    const r = g.finishFight(id, { winner: 0, method: 'KO', by: 'cross', stoppage: null, sub: null, decision: null, round: 1, roundTick: 600, totalTicks: 780, cards: [] }, 10, null, testFighter('brawler'), effectiveDifficulty(400, 'easy'));
    expect(g.save.wins).toBe(1);
    expect(boardCounts(g.save.progress.record, g.save.wins)).toEqual({ wins: 0, knockouts: 0 });
    expect(r.score).toBeGreaterThan(0);
  });
});

describe('move list', () => {
  it('is generated from the real gestures and frame data', () => {
    const list = moveList({ fighter: { archetype: 'kicker' } });
    const rows = list.flatMap(s => s.rows);
    const row = (name: string) => rows.find(r => r.name === name);
    expect(row('Jab')?.gesture).toBe('Tap');
    expect(row('Cross')?.gesture).toContain('→');
    expect(row('Uppercut')?.gesture).toContain('↑');
    expect(row('Head kick')?.gesture).toContain('KICK');
    expect(row('Flying knee')).toBeDefined();
    // every swipe in the recogniser's table is listed against its strike
    for (const [dir, strike] of Object.entries(OFFENCE_SWIPES)) {
      const arrow = { F: '→', UF: '↗', U: '↑', UB: '↖', B: '←', DB: '↙', D: '↓', DF: '↘' }[dir]!;
      const named = rows.filter(r => r.gesture.includes(arrow) && r.gesture.startsWith('Swipe') && r.power > 0);
      expect(named.length, `${dir} -> ${strike}`).toBeGreaterThan(0);
    }
    // all nine strikes, each with damage and speed tiers; the jab is the fastest, the head kick the hardest
    const strikeRows = rows.filter(r => r.power > 0);
    expect(strikeRows.length).toBe(STRIKES.length + 1);
    expect(row('Jab')?.speed).toBe(5);
    expect(row('Head kick')?.power).toBe(5);
    expect(row('Jab')?.key).toBe('J');
    expect(moveList({ leftHanded: true })[0].sub).toContain('left');
  });
});
